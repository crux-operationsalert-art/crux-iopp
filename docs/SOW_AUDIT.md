# SOW and owner-request audit — 03 Nov 2026 (milestone 9)

Each SOW section and every owner request after it, checked against the live build. **Evidence** is a database test (`tests/*.test.ts`, 86 passing), the UI smoke test (`web/e2e/ui-smoke.mjs`, every screen on phone and desktop), or a live check. Status: ✅ done · ◐ partly done · ✗ not done · ⏸ waiting on an owner decision or owner action.

## SOW sections
| SOW | Requirement | Status | Where / evidence | Gap or note |
|---|---|---|---|---|
| 2.1 | Own and partner branches, zones, clients, locations, reporting lines, role-based access | ✅ | Admin → Locations & heads, Clients & rates, People; acceptance tests on scope and RLS | |
| 2.1 | Onboarding, profile completeness, access provisioning | ✅ | Activation code + agreement + profile gate (D-13, D-29); tests "48-working-hour activation", gate tests | |
| 2.1 / 5.1 | Daily Entry, Closure, Cancelled per client × location; pending by age | ✅ | My day; acceptance tests 1, 5, 13 | |
| 2.1 / 6.4–6.5 | Collections and bills raised | ✅ | My day → Collections; Performance → Collections (D-43, D-44); milestone5 collections test | Per-transaction reconciliation **status** (Pending / Partial / Mismatch / Reopened) is not kept: the owner chose bucket totals per day (received vs reconciled), and the unreconciled amount is shown as the difference |
| 3.1–3.5 | Operations and parallel Collections lines, effective-dated reporting, leadership roles | ✅ | `reporting_lines` per function, as-at dates (D-T3); tests S3, transfer, cycle | |
| 4.1–4.3 | Masters, multi-client / multi-location working, allocation controls | ✅ | Self-service client ticks (D-47 fixes same-day untick); test "rejects a client/location not allocated" | |
| 5.2–5.5 | Calculations, MTD movement, roll-up once, manager own figures and mismatch reason | ✅ | Acceptance tests 2, 13; certification with reason | |
| 6.1–6.2 | Effective-dated rate cards, revenue at the work-date rate, overlap rejected | ✅ | Acceptance tests 11, 12 | |
| 6.3 | Partner commercial details: agreement signed / received, security cheque, ratio, versioned | ✅ | Admin → Clients & rates → BA ratios & agreements (D-49); milestone6 test; ratio is bookkeeping only (D-04) | Partner share and CRUX net share are not shown as separate revenue measures (D-04: ratio not used in revenue until an accounting definition is approved) |
| 7.1–7.4 | Submission workflow, window 11:59 PM + grace to 10:00 AM, absence vs zero, on-behalf entry | ✅ | Acceptance tests 5–9 | |
| 7.5 | Penalty ledger | ✅ record only | Missed-report proposals ₹5,000 with financial effect off (D-36); person is notified (D-50) | No deduction until a policy is approved — by design |
| 8.1–8.5 | Top-down targets, dimensions, 5th-working-day lock, allocation check, analytics | ✅ | Targets page: money targets three ways (D-48), team roll-up, "passed to their team", org/zone/branch allocation check; tests "locks at the end of the 5th working day", "My day shows the target…" | |
| 9.1–9.5 | Resource creation, mandatory profile, activation, profile gate, offboarding / transfer history | ✅ | Tests: activation, exited user, transfer | Documents (agreement scans, ID) are not uploaded: last-4 digits only and drive links (by design, no private storage bucket yet) |
| 10.1–10.4 | Schedule, attendance (auto from reporting + manager confirmation), leave, holidays | ✅ | Attendance; Admin → Leave, holidays & policies (empty until the owner sets policy, D-46) | |
| 10.5 | Sunday / holiday work: hours, approval, compensation export | ✅ | Attendance → Sunday / holiday work: start, end, break, hours, manager / HR approval, month Excel (D-55); milestone6 test | Counting rule (full day / hours) is a setting for the HR report; no pay change until HR / Legal approve |
| 10.6 | Shrinkage and attrition; unplanned absence beyond 3 working days → explanation task | ✅ | Attendance shrinkage; Reports → Attrition; absence-streak task to the manager (D-51, milestone6 test) | |
| 11.1–11.5 | Employee, manager, ZM / OH and Collections Head dashboards, in scope | ✅ | Home performance dashboard, now revenue-first (₹), with team target vs actual and collections | |
| 11.6 | BI dashboard reference (month, stakeholder, region, zone, location, client family) | ✅ | History Oct 2024 – Oct 2026 matches the BI dashboard to the rupee; stakeholder / location / people / client views | |
| 11.7 | Cancellation impact and data-quality alerts with owner and action | ✅ | Tasks & misses: missing rate, behind target, missed report, unplanned streak, uncertified team, collections not reported | |
| 12.1–12.5 | Navigation, entry screen, manager review, visual and accessibility standards | ✅ | Grouped menu, phone drawer, one-tap fixes in Tasks; smoke test phone + desktop | No formal accessibility audit (screen reader) yet |
| 12.6 | Installable app (PWA) | ✅ | Install link in invitations, Notifications page | Phone push has not yet been confirmed on a real phone by a user |
| 13.1–13.2, 13.4 | RLS on every table, sensitive data separated, append-only audit | ✅ | Acceptance tests 4, 21; "audit records are append-only" | |
| 13.3 | MFA for Admin / HR / privileged roles | ✅ ready | My profile → Two-step sign-in; Admin → Settings → Sign-in switch (D-54); milestone6 test | Switch it on after the Admin account has set up its code |
| 13.5 | Privacy and legal review | ⏸ | User agreement v1 reviewed by the owner | Formal legal review is the owner's |
| 14 | Low-cost architecture, no-lag, scale | ✅ | GitHub Pages + free Supabase; hourly server refresh; Excel built in the browser | |
| 15 | Data model and integrity constraints | ✅ | `docs/DATA_DICTIONARY.md`; exclusion constraints on effective dates | |
| 16.1 | Notifications for deadline, grace, blocked manager, reopen, penalty, target lock, rate missing, absence, invites, mismatch | ✅ | In app + phone push (D-42, D-50); milestone6 reminders test | Reconciliation-mismatch alert is not separate (no per-transaction status — see 6.4). Email / SMS / WhatsApp not needed (owner) |
| 16.2 | Bulk import with preview, templates; exports to Excel / CSV / PDF with stamp | ✅ | Bulk upload (all-or-nothing), targets template; Excel downloads; **Print / PDF** on Performance and Zonal Tracker with printed-by / time / filters stamp | |
| 17 | Non-functional: uptime, p95 < 2 s, MFA, backups, browsers, accessibility, maintainability | ◐ | Backup + tested restore (41 tables, 18,328 rows); TypeScript, migrations, CI tests | Single live project (no separate staging, D-18); RPO / RTO not agreed; no uptime monitor |
| 18 | 22 acceptance scenarios | ✅ 22 | `tests/acceptance.test.ts` and milestone tests cover 1–16 and 18–22 (16 = absence-streak task, D-51) | 17 covered by D-55 |
| 19–22 | Roadmap, decisions, risks, build discipline | ✅ | `docs/DECISIONS.md` D-01 – D-50, `docs/IMPLEMENTATION_STATUS.md` | |

## Owner requests after the SOW (03 Nov)
| Request | Status | Where |
|---|---|---|
| Remove test data; history must match the BI dashboard; history stays with the person recorded at the time | ✅ | Milestone 6; perf dashboard attributes history to the recorded head |
| Add Chairman, MD, VP Collections; reporting lines; leadership sees everything, VP Collections sees collections, Ops Head sees both | ✅ | Live people and reporting lines; leadership role |
| Reopen with several people, locations and dates at once | ✅ | Admin → Reopen days |
| Zonal Tracker in the exact format and colours, live formulas, role-based download | ✅ | Reports → Zonal Tracker; 371 formulas verified in LibreOffice |
| Collections: simple, in My day, monthly receivables by age, daily received / reconciled by age, bills count + value, target read-only, balance; reviewer can dispute and the head sees it | ✅ | My day → Collections; Performance → Collections |
| No separate collections tab; shown with operations; billed per case for managers | ✅ | Performance page |
| Notifications tab, phone notifications, ask for permissions; install link in invitations | ✅ | Notifications; Home "Set up this phone"; invitation text |
| Task pop-up that fixes the issue directly | ✅ | Tasks |
| Hamburger menu with expandable groups | ✅ | App menu |
| Leave / holiday / penalty policy screens, blank | ✅ | Admin → Leave, holidays & policies |
| Restore test | ✅ | Real backup restored and compared |
| BOM · Ahmedabad stuck after unticking | ✅ | D-47. The two stray same-day ticks (one person, one Admin) end automatically at midnight tonight; removing them sooner needs a one-off delete (`tools/cleanup_same_day_ticks.sql`) that the database tool will only run after your confirmation |
| All performance in money, not cases | ✅ | Performance KPIs, trend, stakeholders, locations, people and clients now in ₹ with cases as the secondary line; My day targets in ₹ |
| Targets: 1 monthly revenue + collection; 2 client-wise cases → revenue by rate + collection; 3 prefilled bulk template; feeding daily updates, MTD, roll-ups and collections | ✅ | Targets page (D-48); My day; Performance; Collections; Zonal Tracker |
| Rewrite git history to remove personal names from old commits | ⏸ | Prepared; the force-push was blocked by the session's safety check. Needs your approval in the permission prompt, or can be done from your own machine |
| Training manual | ⏸ | After go-live, as agreed |

## P1 confidentiality review (03 Nov, 23:11)
Every screen and table was checked for data shown by job title instead of assignment. Fixed (D-52): people, client assignments, attendance, leave, attrition, Zonal Tracker export and history, rates, location heads, partner ratios and agreements, location / zone targets and target progress, the bulk target template, collections screens, and self-ticking a client at someone else's location. Whole-business view: Admin account and Leadership only. Test: an Operations Head with no team sees only themselves.

## Open items in priority order
1. **Switch on two-step sign-in** after the Admin account sets up its code (D-54).
2. **Reporting lines for the Operations Head account** — it has nobody reporting to it, so it now sees only itself.
3. **RPO / RTO and uptime monitoring** (17) — owner to agree targets; free plan has daily backups only.
4. **Per-transaction reconciliation status** (6.4) — only if the Collections team wants transaction-level matching beyond daily bucket totals.
5. **Real-phone push check** — one user to install the app and turn notifications on.
6. **Git history clean-up** — approve the force-push.
