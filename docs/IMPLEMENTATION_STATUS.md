# Implementation status — milestone 1 (03 Nov 2026)

## Environments
| Env | Where | State |
|---|---|---|
| Test | PGlite (Postgres 17 in-process), `npm test` | ✅ 38/38 tests pass |
| Staging DB | Supabase `crux-iopp-staging`, ref `gizzonxfwsqfwgjyqzxc`, ap-south-1, free plan | ✅ 9 migrations applied; all 28 tables have RLS; synthetic data loaded; test clock off |
| Staging web | — | ⛔ needs a static host (see Blockers). The build is in `web/dist` |
| Production | — | Not created (D-18) |

## Built and verified
| Area | What works | Evidence |
|---|---|---|
| Masters | Zones, branches (own/partner), dated branch→zone, clients, locations, processes, dated client-location services, holidays | migrations 0200; Admin → Masters / Services |
| People & scope | Persons, dated roles, dated reporting lines per function (Ops / Collections overlay), dated allocations, cycle guard, transfer keeps history | tests S18, cycle; live: BM sees only own branch |
| Daily entry | Per client-location rows, whole-number validation, allocation check, autosave draft, zero submission, duplicate-submit no-op, lock after submit | tests S1/S5; live journey (phone) |
| Window | Open to 23:59 IST, grace to 10:00 D+1 (flagged late), closed after; future dates refused; Admin reopen by person/team/date with expiry and reason | tests S8/S9 |
| Manager gate | Blocks until each direct report is submitted / absent / on leave / non-operational / exception (reason required); sub-managers must certify first; manager's own figures required if they have allocations | tests S6, ZM chain; live journey |
| Certification | Snapshot of team roll-up (all levels, once) + own contribution; optional certified figure with variance requiring a reason (D-06) | test S2; live: 20 = 11+2+0+7 |
| On-behalf entry | Labelled source, actor, reason; employee notified | test S7; live |
| Revenue | Rate by date (closure/entry/net), no overlaps, closed-month protection, partner/CRUX share | tests S11/S12 |
| WIP | Opening = prior closing, closing = opening + E − C − X, seeded openings; shown as provisional | test S13 |
| Collections & bills | Received vs reconciled vs unreconciled; auto status; bills separate; collections day submission and CH gate | tests S14/S15/S3 |
| Collections Head scope | Sees collections and bills org-wide; no case lines, audit or penalties | test S4 |
| Targets | Org → zone → branch → person; authority by role; versioned; D-12 single style; 5th-working-day lock (Sundays and holidays excluded, Saturday working); Admin-only after lock with reason; allocation check; progress with N/A, remaining, run-rate, labelled projection | test S10, progress |
| Penalties | Configurable rules; direct report only; duplicate block; `payroll_effect` is constrained to false; acknowledge / dispute; Admin/HR decision | penalty tests |
| Audit | Generic before/after/actor/reason on 26 tables; append-only | audit tests |
| Access | No anon access; no direct table writes for transactional data; ID tampering refused; exited user loses access | tests S19/S21; live probes |
| Invitations | Email OTP sign-in; invite expires after 48 working hours; claim links a verified email | invite test |
| UI | Home, My day, My team (drill into sub-teams), Collections, Targets, Reports (zone→branch→person→client→day + CSV + missing submissions), Penalties, Admin (masters, services, rates, people, allocation, reopen, audit, settings); mobile bottom nav; light/dark | live Playwright journey + screenshots |

## Not built yet (next milestones)
| Milestone | Scope |
|---|---|
| M2 | Bulk CSV/Excel upload with preview for masters, rates and allocations; WIP opening upload; scheduled reminders (pg_cron) for deadline / grace / target lock; target reopen UI for non-admins; month close UI |
| M3 | HR repository (restricted `hr` schema, masked PAN/Aadhaar, payroll and bank fields for own staff, partner agreements and cheques in a private bucket), attendance check-in/out, leave, holiday calendars UI, Sunday work, shrinkage / attrition |
| M4 | Historical import from the Zonal Tracker (staging tables, mapping, reconciliation report). Needs D-03 / D-19 confirmed |
| M5 | Pilot: production project, custom SMTP, real masters, training, restore test |

## Known limitations
- Row visibility uses a recursive per-row check. It is fine for hundreds of people; add a closure table before 5,000+ people.
- Email OTP on Supabase's built-in mailer is rate-limited and is not for production. Custom SMTP is required (blocker B-2).
- WIP is provisional until D-01 is confirmed. Revenue assumes `closure` for the synthetic cards.

## Blockers needing the business owner
- **B-1 Hosting for the web app.** Pick one: (a) Cloudflare Pages / Vercel / Netlify free account connected to the repo, or (b) make a repo public for GitHub Pages (not recommended).
- **B-2 SMTP** (e.g. Workspace SMTP relay or a transactional mail service) for sign-in emails. After hosting exists, add the site URL to Supabase Auth → URL configuration.
- **B-3 GitHub.** A private repo, e.g. `crux-iopp`. The session's GitHub token is invalid, so a repo cannot be created from here. Once an empty repo exists, it can be attached and pushed.
- **B-4 Decisions** D-01…D-19 in DECISIONS.md. None blocks development; D-01, D-03, D-04 and D-19 block real data and the history import.
- Temporary QA logins `qa.exec@` / `qa.bm@example.invalid` in staging are banned and unlinked. Deleting them needs a confirmed destructive SQL run.

## Commands
```
npm ci && npm test                      # DB rules + access tests
cd web && npm ci && npm run build       # type-check + build
cd web && npx vite preview --port 4173  # serve build
QA_PASSWORD=… node web/e2e/staging-journey.mjs   # live staging journey (needs temporary QA logins)
```
