# Decision register

Status: **OPEN** = business must confirm (a configurable safe default is implemented). **TECH** = technical decision made under the Master Instruction's authority. **DONE** = confirmed.

## Business decisions (need CRUX confirmation)

| # | Decision | Why it matters | Default implemented (configurable) | Approver |
|---|---|---|---|---|
| D-01 | Meaning of Entry / Closure / Cancelled for WIP; can a cancellation follow a closure or be reversed? | Wrong WIP and disputes | `closing_wip = opening_wip + entry − closure − cancelled`; opening = prior closing; WIP is reported as **provisional** until confirmed | Operations Head |
| D-02 | Net Cases Actioned = Entry + Closure − Cancelled, for all periods and case types | Main productivity KPI | Implemented as stated by CRUX, kept separate from WIP | Operations Head |
| D-03 | Revenue-generating event per client / process (entry, closure or other) and cancellation reversal | Entry and closure both billing would double revenue | Each rate card names its `billable_event`. **Closure** is the default for new cards. The history tracker's single "Actual" count is mapped to closure on import (assumption) | Finance + Ops |
| D-04 | Partner ratio direction (80:20 — who gets 80?) and its base | Wrong share reporting | Stored as explicit `crux_share_pct` / `partner_share_pct` (must sum to 100). No default ratio is assumed | Business owner / Finance |
| D-05 | Collection-target owner | Who allocates / approves | Collections Head owns the collection targets. The Operations tree stays the line tree | OH + CH |
| D-06 | Manager certified figure: reconciliation only, or the official total? | Double counting | **Reconciliation only.** Official = team roll-up + own contribution. A variance ≠ 0 requires a reason | Leadership |
| D-07 | Is manager certification also due by midnight / 10 AM grace? | Gate timing | Yes: the same window applies to certification | Operations Head |
| D-08 | Net working hours, break, Saturday policy | Attendance, shrinkage | 10:00–19:00, 60-minute break (placeholder), Saturday working, Sunday off | HR |
| D-09 | Sunday-work compensation | Payroll exposure | Records hours and approval only. No amount is computed | HR / Legal |
| D-10 | ">3 days unplanned absence": calendar or scheduled working days | Escalation trigger | Scheduled working days, threshold 3 (configurable) | HR |
| D-11 | Penalty triggers, amounts, approval, appeal | Employment-law exposure | Ledger records events. `financial_enabled = false` on every rule, and payroll effect is blocked by a constraint. No amounts are seeded (the tracker's ₹5,000 missing-report rule is recorded as a *candidate*, not activated) | HR / Legal / Leadership |
| D-12 | Target split for people on several clients | Duplicated targets | Targets are set per person × client(optional). The person total = Σ client rows; a person-level row without a client must not coexist with client rows for the same metric | Leadership |
| D-13 | Login channel (phone OTP needs a paid SMS provider) and invite expiry | Cost + security | Email OTP / magic link via Supabase Auth. Invite expiry of 48 working hours enforced in the app (`invites`) | IT / HR |
| D-14 | Attendance evidence mechanism | Privacy | Self check-in / out + manager correction with audit. No GPS / biometric | HR / IT |
| D-15 | Shared client-location work between two people | Double counting | One attribution owner per line. The unique key person×date×client-location blocks duplicates within a person. Cross-person sharing needs an explicit split (not yet supported) | Operations |
| D-16 | Leave balances / entitlements | Invented balances | Requests and approvals only. No balances until a policy is supplied | HR |
| D-17 | Retention schedule for HR / identity / attendance / audit | DPDP compliance | No deletion jobs. Audit is append-only. PAN / Aadhaar are stored masked plus a verification flag only (full numbers not collected) | HR / Legal |
| D-18 | Production hosting plan and environments (Supabase free tier pauses after 7 idle days; 2-project limit) | Availability | Staging on a new free project. Production plan requires purchase approval | Business owner |
| D-19 | Historical tracker "Actual" = which event; rates per location vary (SBI ₹225–₹750) | Migration accuracy | Imported as monthly closure totals per location × client, flagged `source=tracker_import` | Ops + Finance |

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
- 2026-11-03 — Register created from the SOW §20, Master §21 and source inspection.
