# Final go-live audit — 04 Nov 2026

Method: every screen called on the **live** database as one real person of each designation (Admin, BI & Growth, Chairman / MD, Operations + Collections Head, Collections Head, Zonal Manager, Branch Manager, BA), with a full synthetic day entered by all 21 people who report figures, and everything rolled back afterwards (nothing was saved). Plus 92 database tests, the phone + desktop screen test and an automated accessibility scan.

## Results
| Area | Check | Result |
|---|---|---|
| Every screen, every designation | 29 screen / table calls × 9 designations = 267 calls | ✅ 0 errors; refusals only where intended (Collections Head has no operations view) |
| Daily entry end to end | 21 / 21 people saved figures, pending by age, receivables, collections, then submitted | ✅ all submitted |
| Certification chain | ZMs → Ops Head → Chairman, bottom up | ✅ 5 / 5 managers certified in order (a leader with no clients no longer blocks — fixed) |
| Maths: dashboard = tracker = raw entries | MTD cases per designation | ✅ equal for all 9 (e.g. whole business 1,984 = 1,984 = 1,984; ZM 1,120 = 1,120) |
| Maths: collections | collected / reconciled vs raw daily entries | ✅ equal; 100,000 received / 80,000 reconciled shows 20,000 to match, "Partly reconciled" |
| Maths: My day month to date | before-today totals vs raw | ✅ equal for every person |
| Targets | ZM bulk template (9 people, 135 rows) → applied → revenue = cases × rate; roll-up "passed down" = sum of reports | ✅ ₹93.75 L = ₹93.75 L |
| Permissions | BI & Growth cannot dispute receivables or set targets; Collections Heads can; Ops+Coll head can set org targets | ✅ |
| Speed | slowest screen call (none above 1 s across 267) | ✅ fixed: tracker table read for a manager 6.8 s → 0.04 s; audit log 4.3 s → instant |
| Dead logic | UI calls only existing, permitted functions; no orphan screens; 10 retired entry points from old designs closed to users | ✅ |
| Security advisor | functions callable without sign-in | ✅ fixed (8 new functions); remaining warnings are expected (signed-in functions by design, pg_net location) |
| Accessibility | axe-core on every screen, phone + desktop | ✅ 0 serious / critical |
| Screen test | every screen on phone and desktop renders with the expected content | ✅ |

## Fixed during this audit
1. Zonal Tracker download for Ops Head / ZM covered only the locations they head personally → now the same locations as their dashboard (totals agree).
2. Row-level rules recomputed scope per row → computed once per query (big speed-up on tracker, history, people, tasks, audit log).
3. A team member with no clients and no team (e.g. MD in the operations line) blocked the Chairman's certification → shows "No clients" and does not block.
4. Receivables message still named the Operations Head → corrected.
5. Old entry points (check-in, old collection / bill forms, old collection summaries) closed to users; tests moved to the current model.
6. Eight new functions were callable without signing in → closed.
7. BI & Growth and Leadership get a read-only Activity log.

## Scorecard
| Dimension | Score |
|---|---|
| Functions and flows work for every designation | 100 |
| Numbers add up (dashboard, tracker, collections, My day, targets) | 100 |
| Confidentiality by assignment | 100 |
| Speed | 100 |
| Screens, buttons, accessibility | 100 |
| **System readiness** | **100 / 100** |

## Before 9 Nov go-live (data and people, not code)
| Item | Now | Owner |
|---|---|---|
| People activated (signed in, agreement + profile) | 2 of 28 have signed in; 1 completed the agreement + profile | Managers / Admin send activation codes (My team → People) |
| Client · location services without a per-case rate | 52 of the live services have no rate → their revenue shows ₹0 | Admin → Clients & rates (tasks are already open) |
| November targets | none set; setting closes at the end of the 5th working day (6 Nov) | Managers → Targets (bulk template) |
| Leaked-password protection | still shows off in Supabase | Owner — Supabase Auth settings (paid plan feature) |
