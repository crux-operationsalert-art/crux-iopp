# CRUX Integrated Operations Productivity Platform

Productivity flows up, targets flow down, accountability both ways. React PWA + Supabase (Postgres, Auth, RLS). No AI at runtime.

Start with `docs/PROJECT_CONTEXT.md` → `docs/DECISIONS.md` → `docs/DATA_DICTIONARY.md` → `docs/IMPLEMENTATION_STATUS.md`.

## Layout
```
supabase/migrations/   schema, business rules (SQL functions), RLS — the source of truth
supabase/seed/         staging-only synthetic data + purge
tests/                 PGlite test harness, fixtures, SOW §18 acceptance tests
web/                   Vite + React + TypeScript app (PWA)
docs/                  context, decisions, metric dictionary, status, sources
```

## Deploy
1. **Database:** apply `supabase/migrations/*.sql` in filename order (Supabase CLI `supabase db push`, or the SQL editor). Never edit an applied migration. Add a new one instead.
2. **Settings check:** `select value from settings where key='allow_fake_clock'` must return `false`.
3. **Auth:** Supabase → Authentication. Enable Email OTP; set custom SMTP; set Site URL and Redirect URLs to the hosted app URL. Keep sign-ups open (unmatched emails get no access) or disable them and invite via the dashboard.
4. **Web:** set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (browser-safe), `cd web && npm ci && npm run build`, then upload `web/dist` to any static host. Never put a service-role / secret key in the web app.
5. **First admin:** insert a `persons` row (status `invited`, their email) plus a `role_assignments` row with role `admin`. They sign in with that email and are linked automatically. Then add the Operations Head and Collections Head from Admin → People, and the hierarchy builds downward (SOW 3.5).

## Rollback
- Web: redeploy the previous `dist` build.
- Database: migrations are forward-only. To roll back, write a new migration that reverses the change, then run the tests. For data, use Supabase backups (plan-dependent). Run a restore test before go-live.

## Environment checklist
| Variable | Where | Secret? |
|---|---|---|
| VITE_SUPABASE_URL | web build | no |
| VITE_SUPABASE_PUBLISHABLE_KEY | web build | no (publishable) |
| SMTP credentials | Supabase dashboard only | yes |
| Service-role key | never in this repo or browser | yes |
