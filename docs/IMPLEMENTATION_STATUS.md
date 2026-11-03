# Implementation status — milestone 7 (03 Nov 2026)

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
| Everyone | **First sign-in** | Accept the user agreement (recorded) and complete **My profile**; the tool stays read-only until both are done |
| Everyone | **Home** | Open misses and tasks, then the performance dashboard (MTD, projection, trend, stakeholders, locations, people, clients) |
| Everyone | **Tasks** | Reply with a reason, ask Admin to mark resolved; managers see their team's; Admin resolves / denies / asks for details |
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

## Milestone 7 changes (owner feedback, 03 Nov, 20:50)
- **My day → Collections today**: same row layout as operations; totals only, every box compulsory. Separate Collections tab and the manual bill/receipt forms removed; **Reports → Collections** shows totals, outstanding by age, promises and **billed per case** (managers and above).
- **Tasks**: every task has one button that opens a pop-up to fix it on the spot (onboarding message, add a team member, salary, rate, certify team, reopen the day, reason / request, Admin resolve / ask / deny).
- **Menu**: hamburger with expandable categories and their tabs (desktop sidebar can be hidden; phone drawer).
- **Notifications** tab; phone notifications through the installed app (sent every 5 minutes by a scheduled job; keys kept in Supabase Vault). "Set up this phone" card on Home asks for permission; invitation messages include the install link.
- **Backup**: a real backup was restored into a scratch copy of the live database and compared — 41 tables, 18,328 rows, identical counts and totals; scratch copy removed. The restore script no longer needs superuser rights.

## Milestone 6 changes (owner feedback, 03 Nov, night)
- **Data**: the Admin test entry was removed. Monthly history Oct 2024 – Oct 2026 rebuilt to equal the BI dashboard to the rupee for every month (cases, revenue, billing); history stays with the person recorded at the time.
- **Leadership**: Chairman and MD see the whole business; VP Collections sees collections; Operations Head can see both.
- **Collections daily entry** on My day for location heads (D-33); Collections → Daily collections board with outstanding by age, promises due and who has not reported; Excel download.
- **Zonal Tracker** (D-35): screen and Excel in the tracker's layout and colours with live formulas (checked: all formulas recalculate identically in LibreOffice, and Zone A + Zone B = regions = client-wise = stakeholders = Pan India); a values-only copy for sending; layout (zone order and colours, Zone A / B) editable in Admin → Locations & heads.
- **Admin**: reopen many people / locations / dates at once; Month close & backup (checklist, close, full backup download, restore script `tools/restore_backup.sql`).
- **Reports → Attrition**; **Attendance → Leave taken**; missed-report penalty proposals (record only); hourly server-side refresh of misses and to-dos.

## Milestone 5 changes (owner feedback, 03 Nov, evening)
- **Misses & tasks** (D-27): shown on Home and in Tasks for the person and every manager above; replies recorded; misses close only by Admin decision. Live now: 23 onboarding, 25 "add your team" (bulk upload allowed), 9 salary and 3 profile tasks.
- **My day**: pending-case buckets with live tally (D-28); every field compulsory; heads enter daily bills and collections (D-30); team roll-up expands per person with Edit / Remove + note.
- **Onboarding gate** (D-29): agreement v1 + profile; Admin → Agreements & profiles lists who accepted when. Salary from Admin → People or the manager's task.
- **Performance dashboard** for everyone in their own scope, with history from the BI dashboard (D-31). Logo and company details on sign-in, header and agreement.
- Data: location heads corrected and extended per the owner's review (kept in the database only).

## Verified
- 81 database tests (incl. leadership and collections-only access, role-based tracker export, reopen many, penalty record, leave taken, attrition, month close, backup → restore into a fresh database)
- 67 database tests (incl. misses/tasks, Admin-only resolution, bucket tally, agreement & profile gate, salary, daily money, shared-location visibility)
- 58 earlier database tests (incl. location heads, client ticks, manager correction, automatic attendance, tool-built tracker, target copy, settings)
- 51 earlier database tests (SOW §18 scenarios, access isolation, decisions, activation lockout, imports, attendance/leave/shrinkage/streak, reason-gated certification, team list scope, every bulk-upload type).
- Browser parser on the 30-Oct tracker: all four Pan India totals reconcile to 0; stakeholder revenue equals the tracker's stakeholder block.
- UI smoke test (`web/e2e/ui-smoke.mjs`, all server calls mocked with synthetic data) on phone and desktop: every new screen renders with no page errors; add-member produces the onboarding message; tracker upload reconciles and imports.
- Security advisors: only the intended "signed-in users can call guarded functions" notices, plus leaked-password protection (dashboard setting).

## Not yet done (honest list against the SOW)
1. **Leave balances**: no leave policy yet (D-37). **Penalties** stay record-only (D-36).
2. **Phone notifications** are built and the sender is live, but delivery to a real phone is confirmed only once someone installs the app and turns them on (cannot be tested from the build environment).
3. **Live end-to-end run with real logins**: managers start once the tool is live; then the training manual.

## Pending owner action
1. Supabase dashboard (optional, 1 minute): Authentication → turn off "Allow new users to sign up"; turn on leaked-password protection if the plan offers it.
2. Admin → Masters: confirm branch types (own / partner); enter rates for the blended-rate exceptions (D-21).
3. Admin → Settings: `report_recipients` for the Revenue Status email.
4. Set **November targets** (Admin → Monthly targets → fill from October; preview 187 rows / 84,395 cases) before the lock at the end of 6 Nov.
5. Legal review of agreement v1; add the missing mobile number for one person (Admin → People) so they can sign in.
