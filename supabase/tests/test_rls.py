"""Access-rule tests for the Supabase migrations, run against a plain local
Postgres with minimal stand-ins for Supabase's auth schema and roles.

Usage: python3 supabase/tests/test_rls.py "host=... port=... user=postgres"
Requires: psycopg 3. The target database is wiped (schemas public and auth).
"""

import json
import sys
import uuid
from pathlib import Path

import psycopg

MIGRATIONS = sorted((Path(__file__).parent.parent / "migrations").glob("*.sql"))

SUPABASE_STUBS = """
drop schema if exists public cascade;
drop schema if exists auth cascade;
create schema public;
create schema auth;

do $$ begin
  create role anon nologin;            exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;   exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin
  create role supabase_auth_admin nologin; exception when duplicate_object then null; end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;

create table auth.users (id uuid primary key, email text);

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
"""

USERS = {
    "ana": ("ana@lukkap.com", uuid.uuid4()),   # admin
    "bea": ("bea@lukkap.com", uuid.uuid4()),   # member
    "eve": ("eve@example.com", uuid.uuid4()),  # signed up, not on the allowlist
}

failures = []


def check(name, condition):
    print(("PASS " if condition else "FAIL ") + name)
    if not condition:
        failures.append(name)


def as_user(conn, who):
    """Start a transaction acting as a signed-in user (or anon/auth server)."""
    conn.execute("rollback")
    conn.execute("begin")
    if who == "anon":
        conn.execute("set local role anon")
    elif who == "auth_server":
        conn.execute("set local role supabase_auth_admin")
    elif who == "service":
        conn.execute("set local role service_role")
    else:
        email, uid = USERS[who]
        claims = json.dumps({"sub": str(uid), "email": email, "role": "authenticated"})
        conn.execute("set local role authenticated")
        conn.execute("select set_config('request.jwt.claims', %s, true)", (claims,))


def fails(conn, sql, params=None):
    conn.execute("savepoint s")
    try:
        conn.execute(sql, params)
    except psycopg.Error:
        conn.execute("rollback to savepoint s")
        return True
    conn.execute("release savepoint s")
    return False


def count(conn, sql, params=None):
    return conn.execute(sql, params).fetchone()[0]


def main(dsn):
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute(SUPABASE_STUBS)
        for path in MIGRATIONS:
            conn.execute(path.read_text())
        for email, uid in USERS.values():
            conn.execute("insert into auth.users values (%s, %s)", (uid, email))
        # Bootstrap: first admin is inserted from the SQL editor.
        conn.execute("insert into allowed_users (email, name, role) values ('ana@lukkap.com', 'Ana Admin', 'admin')")

        # Sign-up hook
        as_user(conn, "auth_server")
        hook = "select public.hook_before_user_created(%s::jsonb)"
        ok = conn.execute(hook, (json.dumps({"user": {"email": "ANA@lukkap.com"}}),)).fetchone()[0]
        ko = conn.execute(hook, (json.dumps({"user": {"email": "eve@example.com"}}),)).fetchone()[0]
        check("hook allows allowlisted email (case-insensitive)", ok == {})
        check("hook rejects unknown email with 403", ko.get("error", {}).get("http_code") == 403)
        as_user(conn, "eve")
        check("users cannot call the hook", fails(conn, hook, (json.dumps({"user": {"email": "x@y.z"}}),)))

        # Admin adds a member
        as_user(conn, "ana")
        conn.execute("insert into allowed_users (email, name) values ('bea@lukkap.com', 'Bea Miembro')")
        row = conn.execute("select created_by, role from allowed_users where email = 'bea@lukkap.com'").fetchone()
        check("admin adds member; created_by is set by the database", row == (USERS["ana"][1], "member"))
        check("only admin cannot demote themselves", fails(conn, "update allowed_users set role = 'member' where email = 'ana@lukkap.com'"))
        conn.execute("commit")

        # Member works with projects
        as_user(conn, "bea")
        pid = conn.execute(
            "insert into projects (code, client, name, start_date, end_date, budget) "
            "values ('LK-001', 'Cliente Demo', 'Proyecto Demo', '2026-01-01', '2026-06-30', 10000) returning id"
        ).fetchone()[0]
        conn.execute("insert into participants (project_id, name, role, type) values (%s, 'Luis', 'CEO', 'client')", (pid,))
        conn.execute(
            "insert into meetings (project_id, date, type, source_type, source_text) values (%s, '2026-02-01', 'external', 'transcript', 'texto')",
            (pid,),
        )
        conn.execute("insert into todos (project_id, task) values (%s, 'Enviar propuesta')", (pid,))
        check("member creates project, participant, meeting and to-do", count(conn, "select count(*) from todos") == 1)
        forged = conn.execute(
            "insert into projects (code, client, name, start_date, end_date, budget, created_by, updated_by) "
            "values ('LK-009', 'X', 'Y', '2026-01-01', '2026-01-02', 0, %s, %s) returning created_by, updated_by",
            (USERS["ana"][1], USERS["ana"][1]),
        ).fetchone()
        check("member cannot forge created_by / updated_by", forged == (USERS["bea"][1], USERS["bea"][1]))
        check("duplicate project code (other case) is rejected", fails(conn,
              "insert into projects (code, client, name, start_date, end_date, budget) values ('lk-001', 'X', 'Y', '2026-01-01', '2026-01-02', 0)"))
        check("end date before start date is rejected", fails(conn,
              "insert into projects (code, client, name, start_date, end_date, budget) values ('LK-002', 'X', 'Y', '2026-02-01', '2026-01-01', 0)"))
        check("member cannot delete a project", count(conn, "with d as (delete from projects returning 1) select count(*) from d") == 0)
        check("member cannot add users", fails(conn, "insert into allowed_users (email, name) values ('x@lukkap.com', 'X')"))
        check("member cannot promote themselves", count(conn,
              "with u as (update allowed_users set role = 'admin' where email = 'bea@lukkap.com' returning 1) select count(*) from u") == 0)
        directory = conn.execute("select name from member_directory() order by name").fetchall()
        check("member directory maps user IDs to names", [r[0] for r in directory] == ["Ana Admin", "Bea Miembro"])
        conn.execute("commit")

        # Not on the allowlist: sees and writes nothing
        as_user(conn, "eve")
        for table in ("allowed_users", "projects", "participants", "meetings", "todos", "ai_usage"):
            check(f"non-allowlisted user reads 0 rows from {table}", count(conn, f"select count(*) from {table}") == 0)
        check("non-allowlisted user cannot insert projects", fails(conn,
              "insert into projects (code, client, name, start_date, end_date, budget) values ('EV-1', 'X', 'Y', '2026-01-01', '2026-01-02', 0)"))
        check("non-allowlisted user cannot update", count(conn,
              "with u as (update todos set task = 'hack' returning 1) select count(*) from u") == 0)
        check("non-allowlisted user gets empty directory", count(conn, "select count(*) from member_directory()") == 0)

        # Anonymous: no table access at all
        as_user(conn, "anon")
        for table in ("allowed_users", "projects", "todos"):
            check(f"anon has no access to {table}", fails(conn, f"select * from {table}"))

        # AI usage: written by service role, read by admins only
        as_user(conn, "service")
        conn.execute("insert into ai_usage (user_id, task, project_id, input_tokens, output_tokens) values (%s, 'minutes', %s, 100, 50)",
                     (USERS["bea"][1], pid))
        conn.execute("commit")
        as_user(conn, "bea")
        check("member cannot read AI usage", count(conn, "select count(*) from ai_usage") == 0)
        check("member cannot write AI usage", fails(conn, "insert into ai_usage (task) values ('qa')"))
        as_user(conn, "ana")
        check("admin reads AI usage", count(conn, "select count(*) from ai_usage") == 1)

        # Admin deletes a project; children cascade
        conn.execute("delete from projects where id = %s", (pid,))
        check("admin deletes project with its meetings and to-dos", count(conn, "select count(*) from todos") == 0)
        conn.execute("rollback")

    print(f"\n{'All tests passed' if not failures else f'{len(failures)} test(s) failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
