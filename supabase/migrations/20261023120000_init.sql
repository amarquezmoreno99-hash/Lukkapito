-- Project Assistant: initial schema.
-- Tables, audit fields, allowlist-based access (RLS) and the sign-up hook.
-- Run once in the Supabase SQL Editor (or with `supabase db push`).

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------

create table public.allowed_users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email = lower(btrim(email)) and email like '%_@_%'),
  name       text not null check (btrim(name) <> ''),
  role       text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table public.projects (
  id         uuid primary key default gen_random_uuid(),
  code       text not null check (btrim(code) <> ''),
  client     text not null check (btrim(client) <> ''),
  name       text not null check (btrim(name) <> ''),
  start_date date not null,
  end_date   date not null,
  budget     numeric(14, 2) not null check (budget >= 0),
  status     text not null default 'active' check (status in ('active', 'closed')),
  closed_at  date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint projects_dates_check check (end_date >= start_date),
  constraint projects_closed_check check (status = 'closed' or closed_at is null)
);

-- Project codes are unique regardless of case ("ABC-01" = "abc-01").
create unique index projects_code_unique on public.projects (lower(code));
create index projects_client_idx on public.projects (client);

create table public.participants (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  role       text,
  type       text not null check (type in ('client', 'internal')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index participants_project_idx on public.participants (project_id);

create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  date             date not null,
  type             text not null check (type in ('internal', 'external')),
  participant_ids  uuid[] not null default '{}',
  source_type      text not null check (source_type in ('transcript', 'notes')),
  source_file_name text,
  source_text      text not null,
  minutes          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  updated_at       timestamptz not null default now(),
  updated_by       uuid
);

create index meetings_project_date_idx on public.meetings (project_id, date);

create table public.todos (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  meeting_id uuid references public.meetings (id) on delete set null,
  task       text not null check (btrim(task) <> ''),
  owner      text,
  due_date   date,
  status     text not null default 'pending' check (status in ('pending', 'done')),
  done_at    date,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint todos_done_check check (status = 'done' or done_at is null)
);

create index todos_project_idx on public.todos (project_id);
create index todos_meeting_idx on public.todos (meeting_id);

-- Written only by the AI Edge Function (service role); read by admins.
create table public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  user_email    text,
  task          text not null check (task in ('minutes', 'email', 'closing', 'qa')),
  project_id    uuid references public.projects (id) on delete set null,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  created_at    timestamptz not null default now()
);

create index ai_usage_created_idx on public.ai_usage (created_at);

-------------------------------------------------------------------------------
-- Audit fields: created_by / updated_by / updated_at are set by the database,
-- so the client cannot forge them.
-------------------------------------------------------------------------------

create function public.set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger set_audit_fields before insert or update on public.allowed_users
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.projects
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.participants
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.meetings
  for each row execute function public.set_audit_fields();
create trigger set_audit_fields before insert or update on public.todos
  for each row execute function public.set_audit_fields();

-------------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so they can read allowed_users without
-- recursing into its own RLS policies.
-------------------------------------------------------------------------------

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(auth.jwt() ->> 'email')
  );
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users
    where email = lower(auth.jwt() ->> 'email') and role = 'admin'
  );
$$;

-- Maps auth user IDs (created_by / updated_by) to names, for
-- "Última modificación por [name]". Members only.
create function public.member_directory()
returns table (user_id uuid, email text, name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, a.email, a.name, a.role
  from public.allowed_users a
  join auth.users u on lower(u.email) = a.email
  where public.is_member();
$$;

revoke execute on function public.is_member() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.member_directory() from public, anon;
grant execute on function public.is_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.member_directory() to authenticated;

-- Never leave the app without an admin.
create function public.keep_one_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     and not exists (
       select 1 from public.allowed_users where role = 'admin' and id <> old.id
     ) then
    raise exception 'Debe quedar al menos un administrador.';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger keep_one_admin before update or delete on public.allowed_users
  for each row execute function public.keep_one_admin();

-------------------------------------------------------------------------------
-- Row Level Security
-------------------------------------------------------------------------------

alter table public.allowed_users enable row level security;
alter table public.projects      enable row level security;
alter table public.participants  enable row level security;
alter table public.meetings      enable row level security;
alter table public.todos         enable row level security;
alter table public.ai_usage      enable row level security;

-- Explicit grants (RLS still decides which rows). Anonymous visitors get nothing.
revoke all on public.allowed_users, public.projects, public.participants,
              public.meetings, public.todos, public.ai_usage from anon;
grant select, insert, update, delete on public.allowed_users, public.projects,
      public.participants, public.meetings, public.todos to authenticated;
grant select on public.ai_usage to authenticated;
grant all on public.allowed_users, public.projects, public.participants,
      public.meetings, public.todos, public.ai_usage to service_role;

-- allowed_users: members can see the team; only admins manage it.
create policy "members read allowlist" on public.allowed_users
  for select to authenticated using ((select public.is_member()));
create policy "admins insert allowlist" on public.allowed_users
  for insert to authenticated with check ((select public.is_admin()));
create policy "admins update allowlist" on public.allowed_users
  for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "admins delete allowlist" on public.allowed_users
  for delete to authenticated using ((select public.is_admin()));

-- projects: members read and write; only admins delete.
create policy "members read projects" on public.projects
  for select to authenticated using ((select public.is_member()));
create policy "members insert projects" on public.projects
  for insert to authenticated with check ((select public.is_member()));
create policy "members update projects" on public.projects
  for update to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "admins delete projects" on public.projects
  for delete to authenticated using ((select public.is_admin()));

-- participants, meetings, todos: full access for members.
create policy "members manage participants" on public.participants
  for all to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "members manage meetings" on public.meetings
  for all to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));
create policy "members manage todos" on public.todos
  for all to authenticated
  using ((select public.is_member())) with check ((select public.is_member()));

-- ai_usage: admins read. Inserts come from the Edge Function (service role).
create policy "admins read ai usage" on public.ai_usage
  for select to authenticated using ((select public.is_admin()));

-------------------------------------------------------------------------------
-- Sign-up hook ("Before User Created"). Blocks account creation for emails
-- that are not on the allowlist, so no magic link is ever sent to them.
-- Enable it in Dashboard > Authentication > Hooks.
-------------------------------------------------------------------------------

create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.allowed_users
    where email = lower(event -> 'user' ->> 'email')
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Este email no tiene acceso a la aplicación. Pide a un administrador que te dé de alta.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

grant select on public.allowed_users to supabase_auth_admin;
create policy "auth server reads allowlist" on public.allowed_users
  for select to supabase_auth_admin using (true);
