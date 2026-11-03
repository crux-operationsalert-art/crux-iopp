# Decision register

Status: **OPEN** = business must confirm (a configurable safe default is implemented). **TECH** = technical decision made under the Master Instruction's authority. **DONE** = confirmed.

## Business decisions (need CRUX confirmation)

| # | Decision | Why it matters | Default implemented (configurable) | Approver |
|---|---|---|---|---|
| D-01 ✅ DONE 03-Nov | Entry / Closure / Cancelled for WIP | Wrong WIP | **Confirmed by owner:** Entry = case received and entered in Force1, work starts; Closure = completed and submitted to client; Cancelled = entered but cancelled at client request without closure (never billed). `closing_wip = opening_wip + entry − closure − cancelled`; opening = prior closing | Owner |
| D-02 | Net Cases Actioned = Entry + Closure − Cancelled, for all periods and case types | Main productivity KPI | Implemented as stated by CRUX, kept separate from WIP | Operations Head |
| D-03 ✅ DONE 03-Nov | Revenue event and cancellation | Double revenue | **Confirmed:** revenue for performance/targets = cases × rate; WIP + closure earn (i.e. every entered case), cancellations are subtracted ⇒ default `billable_event = entry` with `reverse_cancellations = true`. Revenue ≠ bills raised ≠ collections: collections are money received against bills raised; outstanding = billed − collected | Owner |
| D-04 ✅ DONE 03-Nov | Partner ratio | Wrong share reporting | **Confirmed:** bookkeeping only, no calculation. 80:20 means partner/BA 80, CRUX 20. Stored per branch, effective-dated, shown as Partner : CRUX | Owner |
| D-05 | Collection-target owner | Who allocates / approves | Collections Head owns the collection targets. The Operations tree stays the line tree | OH + CH |
| D-06 | Manager certified figure: reconciliation only, or the official total? | Double counting | **Reconciliation only.** Official = team roll-up + own contribution. A variance ≠ 0 requires a reason | Leadership |
| D-07 | Is manager certification also due by midnight / 10 AM grace? | Gate timing | Yes: the same window applies to certification | Operations Head |
| D-08 | Net working hours, break, Saturday policy | Attendance, shrinkage | 10:00–19:00, 60-minute break (placeholder), Saturday working, Sunday off | HR |
| D-09 | Sunday-work compensation | Payroll exposure | Records hours and approval only. No amount is computed | HR / Legal |
| D-10 | ">3 days unplanned absence": calendar or scheduled working days | Escalation trigger | Scheduled working days, threshold 3 (configurable) | HR |
| D-11 | Penalty triggers, amounts, approval, appeal | Employment-law exposure | Ledger records events. `financial_enabled = false` on every rule, and payroll effect is blocked by a constraint. No amounts are seeded (the tracker's existing missing-report penalty is recorded as a *candidate*, not activated) | HR / Legal / Leadership |
| D-12 | Target split for people on several clients | Duplicated targets | Targets are set per person × client(optional). The person total = Σ client rows; a person-level row without a client must not coexist with client rows for the same metric | Leadership |
| D-13 ✅ revised 03-Nov | Login channel | Cost + security | **No email/SMS needed (owner wants zero-intervention, free):** login ID = mobile number (email if none); Admin/HR/manager issues a one-time activation code (bcrypt-hashed, 48 working hours, 5 attempts) and the person sets their own password via the `iopp-auth` Edge Function. First Admin is the business owner's account (contact details held only in the database; changeable, more admins can be created) | Owner |
| D-14 | Attendance evidence mechanism | Privacy | Self check-in / out + manager correction with audit. No GPS / biometric | HR / IT |
| D-15 | Shared client-location work between two people | Double counting | One attribution owner per line. The unique key person×date×client-location blocks duplicates within a person. Cross-person sharing needs an explicit split (not yet supported) | Operations |
| D-16 | Leave balances / entitlements | Invented balances | Requests and approvals only. No balances until a policy is supplied | HR |
| D-17 | Retention schedule for HR / identity / attendance / audit | DPDP compliance | No deletion jobs. Audit is append-only. PAN / Aadhaar are stored masked plus a verification flag only (full numbers not collected) | HR / Legal |
| D-18 ✅ DONE 03-Nov | Hosting | Availability | **Owner:** free, no intervention, public repo OK. Web on GitHub Pages from public repo `crux-operationsalert-art/crux-iopp`; database = the 2nd free Supabase project `crux-iopp-staging` used as the live instance. Free tier pauses after 7 idle days (daily use prevents it) | Owner |
| D-19 ✅ DONE 03-Nov | Tracker history | Migration accuracy | **Confirmed.** Imported as monthly figures exactly as recorded (cases, revenue, targets, billing) into `tracker_monthly`, not split into Entry/Closure. The tracker is MTD, so a daily figure = today's MTD − yesterday's MTD (rule for future daily imports) | Owner |

| D-20 | Tracker history Jan 2025 – Jan 2026 | Trend completeness | Not imported: location rows explain only 32–44% of the Pan India row and the Pan India billing repeats one identical value for Jan–Jun 2025. Needs the "Old Tracker till Feb 2026" sheet mapped | Ops |
| D-21 | 52 import exceptions (client labels differing between current and history columns on the same row; blended rates with no single per-case rate) | Rate gaps | Recorded in `import_rows` (kind = exception); no rate card created where the rate is blended — Admin enters those | Ops + Finance |

## Technical decisions (made)
| # | Decision |
|---|---|
| D-00 | The Master Instruction supersedes the kickoff "no code before approval" gate. Design artefacts live in the repo |
| D-T1 | Dedicated new Supabase project; the existing `crux` project is read-only reference |
| D-T2 | All writes go through `SECURITY DEFINER` RPCs that validate scope, window and allocation. Tables expose SELECT via RLS only (admins may maintain masters directly; this is audited) |
| D-T3 | Scope = recursive effective-dated `reporting_lines` per function, evaluated **as at the record's date**, so transfers never rewrite history |
| D-T4 | Corrections are audited row changes (generic `audit_events` with before / after / reason / source). Submitted lines are locked unless an Admin reopen grant is active |
| D-T5 | Revenue is computed from the rate whose validity contains the work date. Rate rows that touch a closed month cannot be altered; corrections are new versions with a reason |
| D-T6 | Money is `numeric(14,2)`; counts are `integer ≥ 0`; timestamps are `timestamptz`; the business timezone is a setting (Asia/Kolkata) |
| D-T7 | A test clock (`app.clock()`) is honoured only when the `allow_fake_clock` setting is true, which is never seeded in staging or production |

## Change log
- 2026-11-03 — Milestone 3: attendance & leave (D-08/D-10 defaults applied), manager roll-up beside own entry with reason-gated certification (D-06), leader team onboarding, bulk upload (new rate/ratio versions end the previous open version), daily tracker upload + Revenue Status.
- 2026-11-03 — Owner confirmed D-01, D-03, D-04, D-19; revised D-13 (activation codes) and D-18 (GitHub Pages + 2nd free Supabase project). Added D-20, D-21.
- 2026-11-03 — Register created from the SOW §20, Master §21 and source inspection.
