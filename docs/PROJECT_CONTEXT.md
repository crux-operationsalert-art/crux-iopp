# CRUX Integrated Operations Productivity Platform (IOPP) — Project Context

This is the living Statement of Work. Read this file, `DECISIONS.md`, `DATA_DICTIONARY.md` and `IMPLEMENTATION_STATUS.md` first; do not re-read the full SOW unless a detail is missing.

## Objective
A secure, configurable web app / PWA for CRUX. Productivity flows bottom-up, targets flow top-down, and accountability flows both ways. The first release covers Operations and Collections, and later departments should be addable mainly through configuration.

## Governing inputs (in priority order)
1. **Master Instruction** (business owner, 03 Nov 2026). It authorises an end-to-end build without approval between stages.
2. **CRUX_Integrated_Operations_Productivity_Platform_SOW.docx** v1.0, 02 Nov 2026. This is the business source of truth for rules.
3. **Kickoff prompt.** Its "no coding before design approval" step is **superseded** by the Master Instruction (§20, §23.16–17). The design deliverables it asks for still exist, but as repository documents (this file, DATA_DICTIONARY, DECISIONS, schema), not as a gate. Logged as D-00.

## Scope
**In scope:**
- Org masters: zones, branches (own/partner), clients, locations, processes, client-location services.
- People and roles, held as effective-dated role, reporting-line and allocation records.
- Daily productivity: Entry / Closure / Cancelled per person × date × client-location, plus WIP.
- Submission windows, a manager gate, certification, own contribution, variance and on-behalf entry.
- Rate cards (effective-dated, no overlaps) feeding revenue, plus the partner share split.
- Collections received / reconciled and bills raised (count and amount), with a Collections Head scope.
- Targets: the cascade and the five-working-day lock. Admin reopen. Penalty ledger (no payroll effect).
- HR repository with restricted sensitive data, attendance, leave, holidays, Sunday work. *(Milestone 3)*
- Historical import through staging with reconciliation. *(Milestone 3)*
- Dashboards, drill-down, audit.

**Out of scope for release 1:** payroll processing, client portal, native apps, bank/CRM integrations, runtime AI.

## Boundaries
- The existing Supabase project `crux` (ref oxpwqfbtbxlvuqpztbwg) is a **separate live system** (PMS, escalation, perf_*, rate, business_record). It is **read-only reference**: never migrate into it.
- Existing GitHub repos (Crux_PMS_Managemnt, crux_escalationmanagement, crux_pms, internshipprogram) stay untouched.
- The Live Zonewise Tracker tool and the TAT Report artifact stay untouched. Only copies of their files are read.

## Architecture (decided — see D-T1..T6)
| Layer | Choice |
|---|---|
| Frontend | Vite + React 18 + TypeScript, hand-built design tokens, PWA manifest + service worker (static assets only) |
| Backend | Supabase Postgres 17. Business rules live in SQL functions. Writes go through `SECURITY DEFINER` RPCs; reads use RLS |
| Auth | Supabase Auth (email OTP / magic link now; phone OTP once an SMS provider is approved — D-13) |
| Identity → role | `persons.auth_user_id`, plus effective-dated `role_assignments` and `reporting_lines`. Never JWT metadata |
| Sensitive HR | Schema `hr`, not exposed through the API. Accessed via audited RPCs |
| Tests | Vitest + PGlite (in-process Postgres 17) runs every migration plus role-isolation tests |
| Hosting | Supabase (DB/Auth). Static frontend host is pending — see blockers |

## Deliverables
DB migrations (`supabase/migrations`), tests (`tests/`), web app (`web/`), docs (`docs/`), staging deployment.

## Acceptance
These SOW §18 scenarios are tracked in IMPLEMENTATION_STATUS.md, each with its test name.

## Status / next actions
See IMPLEMENTATION_STATUS.md.
