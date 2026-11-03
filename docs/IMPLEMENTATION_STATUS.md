# Implementation status — milestone 4 (03 Nov 2026)

## Live
| What | Where |
|---|---|
| Web app (PWA) | https://crux-operationsalert-art.github.io/crux-iopp/ (GitHub Pages; redeploys on every push to `main` that touches `web/`) |
| Database / auth / functions | Supabase project `crux-iopp-staging` (ref `gizzonxfwsqfwgjyqzxc`, Mumbai, free plan): the live instance per D-18 |
| Code | Public repo `crux-operationsalert-art/crux-iopp`; CI runs the database tests and the build on every push |
| Sign-in | Mobile number + own password, set through a one-time activation code (no email/SMS). Edge Function `iopp-auth` |

## Where people do what
| Who | Screen | What |
|---|---|---|
| Everyone | **Home** | Check in, then "Enter today's numbers" |
| Everyone | **My day** | Attendance at the top; Entry / Closure / Cancelled per client × location; Submit. After submitting, a copy-paste WhatsApp message with date, zone · location, attendance, MTD shrinkage, per-client today + MTD figures, WIP, and collections/bills where relevant |
| Managers | **My day** | Team roll-up shown under each of their own rows, plus team-only rows; **Certify my team** shows team roll-up + own = calculated per measure; any different figure needs a reason (recorded with the difference); a second message for the team roll-up (attendance x/y, shrinkage, submitted x/y) |
| Everyone | **Attendance** | Check in/out (late after grace; half day under 4.5 h), leave requests (planned/unplanned, short-notice flag), month summary and shrinkage |
| Managers | **Attendance → My team** | Who is in today, mark a direct report with a reason, approve/reject leave, shrinkage, unplanned-streak > 3 working days flag |
| Leaders (OH, CH, ZM, BM, BA, manager) | **My team → People** | Add a team member (role limited by the creator's role), choose clients/locations, then get the activation code and a ready WhatsApp/email onboarding message (link, login ID, code, expiry, steps, daily routine; extra lines for BAs and leaders). Reset codes, add allocations |
| Leaders | **Reports → Revenue Status** | Ported from the Zonal Tracker Builder: verdict, KPIs (MTD, added, projected close, needed per working day), key points (day vs average, pace, praise, concerns with owners, zero additions, daily-count mismatches), stakeholder scorecard, regions, zones, locations, clients, close-out focus, email subject/text/formatted HTML, Excel download |
| Admin | **Admin → Bulk upload** | Template download, .xlsx/.csv upload, preview, **Check** (runs every row, saves nothing), **Import** (all-or-nothing). Types: people, allocations, zones, branches, locations, clients, services, rates (new version ends the previous open rate), targets, holidays, partner ratios, opening WIP. HR can upload people, allocations and holidays |
| Admin | **Admin → Daily tracker** | Upload the day's Live Zonewise tracker; parsed in the browser, reconciled against the Pan India row (blocked if any of the four totals differs), stakeholders mapped from the tracker's own stakeholder block; feeds Revenue Status. The source file is never changed |

On phones the bottom bar shows Home, My day, Attendance, My team and **More** (all other screens + sign out).

## Milestone 4 changes (owner feedback, 03 Nov)
- **My day → My clients**: everyone sees all clients with an active / inactive tick, active first; ticking adds the client to their entry form from today.
- **My team → tap a person**: Edit or Remove an entry with a note (person notified; old figures in the audit log). **People → Add**: separate Location and Client tick lists.
- **Attendance**: no check-in. Auto Present / Absent from reporting; managers confirm category and sub-category, or "Confirm all as shown".
- **Reports → Zonal Tracker**: produced from entered figures (region → zone → location → client, location totals, Pan India, Operation stakeholders block, Excel download). Revenue Status uses the same data. Each person sees only locations they or their team head or work on.
- **Admin**: People (with a person editor for roles, reports-to, locations headed, clients, account), Locations & heads, Clients & rates, Monthly targets (with "fill from last month"), Bulk upload, Reopen a day, Settings (plain-language form), Activity log. The daily tracker upload was removed.
- People, heads and client assignments loaded from the owner's Locationwise names file (personal data kept in the database only, not in this repository).

## Verified
- 58 database tests (incl. location heads, client ticks, manager correction, automatic attendance, tool-built tracker, target copy, settings)
- 51 earlier database tests (SOW §18 scenarios, access isolation, decisions, activation lockout, imports, attendance/leave/shrinkage/streak, reason-gated certification, team list scope, every bulk-upload type).
- Browser parser on the 30-Oct tracker: all four Pan India totals reconcile to 0; stakeholder revenue equals the tracker's stakeholder block.
- UI smoke test (`web/e2e/ui-smoke.mjs`, all server calls mocked with synthetic data) on phone and desktop: every new screen renders with no page errors; add-member produces the onboarding message; tracker upload reconciles and imports.
- Security advisors: only the intended "signed-in users can call guarded functions" notices, plus leaked-password protection (dashboard setting).

## Not yet done (honest list against the SOW)
1. **HR repository** for restricted personal data (PAN/Aadhaar masked, bank, salary, documents): not built; waits for HR/legal policy (D-17).
2. **Old Tracker (≤ Jan 2026)** mapping for history before Feb 2026 (D-20).
3. **Automatic reminders** (pending submission, missing certification, leave pending) are in-app notifications only; no push/WhatsApp sending (no paid service).
4. **Month close** screen and **restore test** of a backup.
5. **Penalties** stay record-only until a policy is approved (D-11); **leave balances** wait for the leave policy (D-16); **Sunday-work** compensation is recorded only (D-09).
6. **Attrition** reporting and the dedicated **collections certification** view for the Collections Head need real usage data to tune.
7. Live end-to-end run with real logins: needs one manager to activate and walk through My day once (no test accounts are kept in the live database).

## Pending owner action
1. Supabase dashboard (optional, 1 minute): Authentication → turn off "Allow new users to sign up"; turn on leaked-password protection if the plan offers it.
2. Admin → Masters: confirm branch types (own / partner); enter rates for the blended-rate exceptions (D-21).
3. Admin → Settings: `report_recipients` for the Revenue Status email.
