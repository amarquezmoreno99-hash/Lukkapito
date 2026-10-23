# Project Assistant — Build Instructions for Claude Code

## 1. What we are building

A single-page web app (HTML + CSS + vanilla JavaScript) for the consultants of a CX/EX consulting firm. It helps them:

1. Register client projects (client, code, dates, budget, people).
2. Upload meeting transcripts or notes and get an AI-generated **meeting minutes document** (findings with verbatim quotes, decisions, open points, to-dos).
3. Generate a **client-facing summary email** for external meetings.
4. Track and manage **to-dos** per project.
5. Close projects with an AI-generated **closing summary**.
6. Ask free-form questions about a project, answered only from stored data.

The firm has low digital maturity. Favour simplicity and robustness over features. Follow an 80/20 approach.

**Hard constraints**
- The app must NOT connect to any company system (no SharePoint, no Microsoft 365, no Google Workspace, no company databases).
- **Shared knowledge:** every consultant must see the same projects, minutes and to-dos. Data cannot live only in the browser.
- **Architecture:**
  - **GitHub** hosts the code. The frontend is a static site on **GitHub Pages**, with no build step.
  - **Supabase** is the backend, a new and independent service created only for this app. It provides the Postgres database, authentication and Edge Functions.
  - **Anthropic API** provides the AI, through **one company API key** stored only as a Supabase secret. End users never need an Anthropic account or key.
- **All user-facing text is in Spanish (Spain).** Code, comments, commit messages and file names are in English.

## 2. Before writing any code

1. Read everything in `/design` (look-and-feel template, screenshots and font files). Extract a design system from it:
   - Colours, typography (font families, sizes, weights), spacing, border radius, shadows, button and input styles.
   - Put all of it in `css/tokens.css` as CSS custom properties. Every other stylesheet must use only these tokens, with no hard-coded colours or font sizes.
   - Load the fonts from the files in `/design/fonts` using `@font-face`. If a font is missing, ask me before substituting it.
   - **Status:** `/design` holds the Lukkap brand guide (`README.md`, `tokens.json`, `tokens.css`). `css/tokens.css` copies its brand values and maps them to app tokens. Century Gothic is commercial and is used only if installed; the guide's official web substitute, Questrial (OFL), is self-hosted in `/design/fonts`. The logo is `/design/logos/lukkap-logo-claim-color.png` (colour, with claim), so the header is white: the colour logo goes only on light backgrounds. Never redraw or recolour the logo.
   - Brand rules that override details below: no emojis (use an inline SVG warning icon instead of "⚠"); orange and blue are never used for small text (contrast); no shadows or gradients.
2. Summarise the extracted design system and the planned file structure, and **wait for my approval** before building screens.
3. If anything in this document is ambiguous or conflicts with the template, ask me. Do not guess.

## 3. Tech stack and structure

- Plain HTML, CSS and ES modules. No framework and no bundler.
- External libraries only if strictly needed, loaded from a CDN with **pinned exact versions**:
  - `docx` to generate Word files.
  - `mammoth` to read `.docx` uploads.
  - `@supabase/supabase-js` as the Supabase client.
- Suggested structure:

```
/index.html
/css/tokens.css        # design tokens from /design
/css/app.css
/js/config.js          # Supabase URL + anon (public) key only
/js/app.js             # router + menu + auth guard
/js/storage.js         # data access layer over Supabase (see §5)
/js/ai.js              # calls the AI Edge Function (see §6)
/js/views/             # one module per screen
/js/export/            # docx, csv, email
/supabase/migrations/  # SQL: tables, indexes, RLS policies
/supabase/functions/ai/  # Edge Function that calls Anthropic
/design/               # look & feel template + fonts (provided by me)
/README.md             # setup, deployment, usage (in Spanish)
```

## 4. Data model

One Postgres table per entity, created through SQL migrations in `/supabase/migrations`. Use UUID IDs; dates stored in ISO format (`YYYY-MM-DD`) and displayed as `DD/MM/YYYY`. Every table also has `created_by`, `updated_by` (user ID) and `updated_at`, so the UI can show "Última modificación por [name], [date]".

```
Project     { id, code (unique), client, name, startDate, endDate, budget (number, EUR),
              status: "active" | "closed", closedAt, createdAt }
Participant { id, projectId, name, role, type: "client" | "internal", createdAt }
Meeting     { id, projectId, date, type: "internal" | "external", participantIds[],
              sourceType: "transcript" | "notes", sourceFileName, sourceText,
              minutes: { summary, findings[{ text, quotes[{ quote, speaker, verified }] }],
                         decisions[], openPoints[] },
              createdAt }
Todo        { id, projectId, meetingId, task, owner, dueDate | null,
              status: "pending" | "done", doneAt }
```

## 5. Storage and access (Supabase)

- All data lives in **Supabase Postgres** and is shared by the whole team. `storage.js` exposes async functions (`listProjects`, `saveMeeting`, etc.), and no other module calls Supabase directly.
- **Authentication:** email magic link (Supabase Auth), with no passwords to manage. Only emails on an **allowlist** can sign in. Keep the allowlist in an `allowed_users` table (email, name, role: `admin` | `member`), managed by an admin.
- **Row Level Security** is enabled on every table. Signed-in allowlisted users can read and write all projects. Only admins can delete projects and manage the allowlist.
- The frontend contains only the Supabase URL and the **anon key** (which is public by design). The `service_role` key and the Anthropic key must never appear in the frontend or the repository.
- Concurrency: last write wins. Show who modified a record last and when.
- Admins get an **Exportar copia** button (a full JSON backup download) as an extra safety net.
- **Implementation notes (phase 2):**
  - Sign-up is blocked for non-allowlisted emails by the Postgres "Before User Created" hook `public.hook_before_user_created` (enabled in Dashboard > Authentication > Hooks). A user removed from the allowlist can still receive a link, but RLS returns no data and the app signs them out.
  - Magic links use supabase-js's **implicit** flow (works across browsers). Tokens/errors arrive in the URL hash, so `app.js` waits for `getSession()` before routing and reads `#error_code=...` itself.
  - `created_by` / `updated_by` / `updated_at` are set by a database trigger; never send them from the client. Map user IDs to names with the `member_directory()` RPC.
  - `supabase/tests/test_rls.py` checks the access rules against a local Postgres; extend it when adding tables or policies.

## 6. AI integration (Anthropic API via Supabase Edge Function)

- All AI calls go through one Supabase Edge Function (`/supabase/functions/ai`). The browser never calls Anthropic directly.
- The function:
  - Reads the company key from the Supabase secret `ANTHROPIC_API_KEY` and the model from the `ANTHROPIC_MODEL` secret (default `claude-sonnet-5-5`). Check the current official Anthropic docs before implementing.
  - Rejects requests without a valid signed-in user session from the allowlist.
  - Accepts a `task` parameter (`minutes` | `email` | `closing` | `qa`) and builds the prompts on the server. Do not accept arbitrary prompts from the client.
  - Logs usage (user, task, project, tokens, timestamp) to a `ai_usage` table so the company can see costs.
- `js/ai.js` is a thin client that calls this function and handles errors.
- Ask the model for **structured JSON output** matching the `minutes` + `todos` schema, validate it, and show a friendly Spanish error with a retry button if parsing fails.
- **Verbatim quotes are critical.** After the model responds, check each quote against `sourceText` (normalise whitespace and quote characters). Set `verified: true/false`. Show unverified quotes with a visible warning (for example "⚠ Cita no encontrada literalmente en el documento") so the consultant can fix or remove them. Never silently keep an unverified quote.
- The model must never invent information. If the owner or due date of a to-do is not in the document, it returns `null`, and the UI shows "Por definir" for the user to fill in.
- Long transcripts: if the text exceeds a safe size, warn the user and process it in chunks, then merge. Keep it simple.
- Show a loading state with progress text in Spanish while the AI works.

## 7. Screens and flows

### 7.0 Login and Home (main menu)
A login screen asks for the user's email and sends a magic link; unauthorised emails get a clear Spanish message. After login, the header shows the user's name and a **Cerrar sesión** button. Admins also see **Administración** (allowlist management and backup).

The home screen shows four large action cards:
- **a) Abrir un proyecto**
- **b) Subir transcript o notas de reunión**
- **c) Consultar to-do's**
- **d) Finalizar un proyecto**
- A fifth entry: **Preguntar sobre un proyecto** (free-form Q&A).

Below the cards, show a compact list of active projects, with their pending and overdue to-do counts.

### 7.1 Project selection (shared step for b, c, d and Q&A)
1. Select the **client** from a dropdown of clients with active projects.
2. If that client has more than one active project, select the **project code** (show code + name). If there is only one, select it automatically and show it.

### 7.2 a) Open project
A form with the fields: client (free text with autocomplete from existing clients), project code (must be unique: validate it), project name, start date, end date (≥ start date), budget sold (EUR), client participants (repeatable rows: name + role), internal team (repeatable rows: name + role).
- On save, show the **Ficha de proyecto** card. Status = active.
- The project card can be viewed and edited later from the project page.

### 7.3 b) Upload meeting
A form, after selecting the project:
1. **Fecha:** defaults to today, editable.
2. **Tipo:** Interna / Externa (radio buttons).
3. **Participantes:** multi-select of the project's participants, shown as "Name – Role (Cliente/Interno)". Include an **"+ Añadir participante"** option that opens an inline mini-form (name, role, type). The new participant is saved to the project and immediately available here and in the project card.
4. **Tipo de documento:** Transcript / Notas.
5. **Archivo:** upload `.txt`, `.vtt`, `.docx`, or paste the text directly in a textarea. Audio files are not supported in v1: show a message explaining this.

Then **Generar acta** runs the AI step and shows an **editable preview** of the minutes:
- Header: project (code + client), date, type, participants, source document.
- **Resumen ejecutivo** (3–5 lines).
- **Findings principales** (max 7). Each one has at least one verbatim quote in quotation marks with the speaker's name. If the source is notes and there are no quotes, show that.
- **Decisiones**.
- **Puntos abiertos y riesgos**.
- **To-do's** table: #, task, owner, due date. Every field is editable, and rows can be added or removed.

Buttons:
- **Guardar** saves the meeting and to-dos (status pending).
- After saving:
  - **Descargar acta (Word)** creates a clean, generic Word document named `YYYY-MM-DD_[CODE]_Acta.docx`, using the template fonts where possible.
  - If the meeting is **external**, show **Generar email para cliente** (see §7.4). Never show it for internal meetings.

### 7.4 Client summary email
- Generated by the AI from the saved minutes. If there are several internal participants, first ask who sends it.
- Structure: subject `[Project name] - Resumen reunión [DD/MM/YYYY]`; greeting to the client participants; a short thank-you; summary (3–5 bullets); agreements; next steps (task – owner – date); a warm closing; signature with the sender's name.
- Rules: professional and friendly tone, **max 200 words**, **no verbatim quotes, no internal risks or comments, no budget or financial data**. Spanish by default, with a language selector (ES/EN).
- Show it in an editable box with **Copiar** (to the clipboard) and **Abrir en el correo** (`mailto:` with the subject and body prefilled) buttons.

### 7.5 c) To-dos
- A table of the selected project's to-dos: #, task, owner, due date, source meeting (date + type), status.
- Overdue pending to-dos are highlighted (a red marker and the text "Vencido").
- Header counters: pending / overdue / done.
- Filters: by owner, and by status (pending by default, "ver también hechos").
- Actions: mark as done (records `doneAt`), edit, delete (with confirmation), and **Descargar Excel** (`.csv` with UTF-8 BOM so Excel opens accents correctly).

### 7.6 d) Close project
- Show a summary: number of meetings (external / internal), and to-dos (done / pending). If any to-dos are pending, show a warning and list them.
- Ask for explicit confirmation ("Sí, finalizar proyecto").
- On confirmation, set status = closed and `closedAt` = today. Generate the **Resumen de cierre** with the AI: activity figures, main findings across all meetings, key decisions, and open to-dos. Show it on screen and offer it as Word (`[CODE]_Cierre.docx`).
- Closed projects are read-only. Allow reopening them only through an explicit "Reabrir proyecto" action.

### 7.7 Free-form Q&A
- After selecting a project, a simple chat box. The AI answers **only** from that project's stored data (project card including budget, minutes, to-dos) and always cites its source as "(Reunión DD/MM/YYYY, Externa)".
- If the answer is not in the data, it says so.

## 8. Business rules

- **Confidentiality:** the budget appears only on the project card. Never include it in the minutes, emails, closing summaries or exports, nor in AI prompts — with one exception: the Q&A prompt (§7.7) receives the full project card, budget included, so consultants can ask about it.
- Ask for confirmation before any destructive action (delete, overwrite on import, close project).
- Never invent data. Anything AI-generated must be reviewable and editable before it is saved.
- Validate forms with inline Spanish error messages.

## 9. UX and quality requirements

- Responsive layout. Desktop first, but usable on a tablet.
- Accessible: semantic HTML, labels on every input, keyboard navigation, visible focus states, and sufficient colour contrast within the template's palette.
- Empty states with helpful Spanish copy (for example "Todavía no hay proyectos. Empieza abriendo uno.").
- No console errors. Handle API and network errors gracefully.

## 10. Build plan (work in this order and stop after each phase for my review)

1. **Design system:** tokens, fonts, base layout, home menu (no logic yet).
2. **Supabase setup:** migrations (tables, RLS, allowlist), auth with magic link, login screen. Give me step-by-step instructions for what I must do in the Supabase dashboard (create the project, set secrets, configure the redirect URL to the GitHub Pages domain).
3. **Projects:** data layer, open project, project card, project selection.
4. **Meetings:** upload form, AI Edge Function, minutes generation, quote verification, save, Word export.
5. **Client email.**
6. **To-dos screen** and CSV export.
7. **Close project** and closing summary.
8. **Q&A.**
9. **Administration** (allowlist, backup, AI usage view) and **README** (in Spanish: Supabase setup, secrets, GitHub Pages deployment, how to add users, limitations), plus final polish.

After each phase, list what you built and how to test it manually, and commit with a clear message. Include a `/samples` folder with a fictional transcript (in Spanish, about 1,500 words, an external meeting with 3–4 speakers) so the flow can be tested end to end. It must contain no real client data.

## 11. Acceptance criteria

- I can create a project, add a meeting with a sample transcript, and get minutes whose quotes are all marked as verified, or are clearly flagged.
- A participant added during a meeting appears in the project card.
- External meetings offer the client email; internal meetings do not. The email has no quotes, no risks and no budget.
- The to-do list shows overdue items correctly and exports to a CSV that Excel opens with correct accents.
- Closing a project with pending to-dos shows a warning, and the project then becomes read-only.
- Two different users, on two different computers, see the same projects, minutes and to-dos. A change made by one appears for the other after a refresh.
- A user who is not on the allowlist cannot sign in or read any data, including through direct API calls (RLS verified).
- End users can generate minutes without any Anthropic account. The Anthropic key exists only as a Supabase secret.
- The site works from GitHub Pages with no build step, and there are no secrets in the repository.
