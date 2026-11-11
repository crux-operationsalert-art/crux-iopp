# Performance scoring & cross-department KPIs — design for sign-off (11 Nov 2026)

Two big pieces from the 11 Nov request. Both affect reviews (and potentially pay), so they are written here for your approval before I build them. Nothing below is live yet.

---

## A. Weekly review + monthly score out of 10

### The shape you asked for
`Final /10 = 0.75 × KPI score + 0.25 × Attributes score`, with automatic fairness adjustments so a hand-given score can still move.

### KPI score (out of 10) — objective, auto-adjusted
The manager can give a base KPI score, but the system adjusts it from the measured numbers so it stays fair:

| Signal (measured) | Effect on the KPI score |
|---|---|
| **Achievement vs target** (cases/revenue done ÷ target) | ≥110% → +1 · 100–110% → +0.5 · 80–100% → 0 · 60–80% → −1 · <60% → −2 |
| **TAT / ageing** (share of work closed within TAT, or avg ageing vs threshold) | on/under TAT → +0.5 · mild breach → −0.5 · heavy breach (15 d+ piling up) → −1.5 |
| **Commitment %** (new — plan vs done, D-113) | ≥90% → +0.5 · <60% → −0.5 |
| **Attendance / discipline** | clean → 0 · repeated late/absent → −0.5 |

Final KPI score is clamped to 0–10. (So even a generous 9 drops if achievement and TAT are poor; a modest 6 rises if the numbers are strong.)

### Attributes score (out of 10) — manager-given, auto-adjusted
Manager rates behaviour/ownership/teamwork, then default factors add or subtract — so **even 10/10 moves**:

| Default factor | Effect |
|---|---|
| **Self shrinkage** (own unplanned absence / low availability) | − up to 2 |
| **Team shrinkage** (attrition in their team this period) | − up to 2 |
| **Team performance** (their team's avg achievement) | +1 strong · −1 weak |
| **Growth** (month-on-month improvement in their numbers) | +1 improving · −1 declining |

Attributes final clamped to 0–10. (Non-managers get the self-shrinkage and growth factors; team factors apply to managers.)

### Weekly review & planning
A weekly screen per report: last week's commitment %, achievement and TAT, the manager's short review note, and next week's focus. These roll into the monthly score so the month isn't scored cold.

### Flow & control
Manager scores → HR/Admin review and **lock** the month → the person sees their score and the breakdown. Everything audited. Weights and the bands above live in **settings** (company-owned), not hardcoded.

### Decisions I need from you (in the questions that follow)
1. KPI score: **manager gives a base and the system adjusts** (recommended, matches your words), or **purely computed from the numbers**?
2. The adjustment bands above — **use these defaults** and you tune later, or you want to set them now?
3. The attribute default factors — is the list above right (self shrinkage, team shrinkage, team performance, growth), or add/remove?
4. Who scores and approves: **direct manager scores → HR/Admin locks** — correct?

---

## B. Assigning different KPIs per department (beyond operations & collections)

### Where we are
Operations and collections are **hardcoded** — their own tables (`productivity_lines`, money rows), their own entry screens. That is why only those two work today. To give HR, Finance, Sales, IT, Audit, BE, etc. their own KPIs, we add a **generic KPI engine** alongside the two fast paths.

### The model (generic KPI engine)
- **KPI catalogue** — `kpi(id, department, name, unit, direction [higher-better / lower-better], cadence [daily/weekly/monthly], target_basis, weight)`. e.g. Finance: "Invoices processed" (daily, higher-better); "Collection ageing" (monthly, lower-better). HR: "Positions closed", "Time-to-hire".
- **Assignment** — `kpi_assignment(person_id, kpi_id, target, valid)` — like allocations, but for any KPI.
- **Entries** — `kpi_entry(person_id, kpi_id, period, planned, actual, note)` — the same **plan → do → commitment %** flow D-113 already introduced, but for any KPI and any cadence.
- **Scoring reads one place** — the monthly score (part A) reads achievement/commitment from this engine uniformly, so operations, collections and every new department are scored the same way.

### How a new department gets set up
1. Admin defines that department's KPIs in the catalogue (name, unit, cadence, higher/lower-better, weight).
2. Admin assigns KPIs + targets to each person (bulk upload supported, like allocations).
3. People get a daily/weekly/monthly entry screen generated from their assigned KPIs (plan, actual, note) — the same shape as My day / My plan.
4. Managers see roll-ups; the monthly score picks it up automatically.

### Phasing (suggested)
- **Phase 1:** catalogue + assignment + a generic monthly/weekly entry screen; migrate one new department (say Finance or HR) as the pilot.
- **Phase 2:** daily cadence + plan/commitment for generic KPIs; roll-ups and dashboards per department.
- **Phase 3:** fold operations & collections onto the same engine (optional; they can stay as fast paths).

This keeps the two proven paths intact while making every other department first-class.

---

## C. Fast-follow (bounded, already agreed)
- **Team vs individual tasks:** when assigning to several people, ask *individual* (separate tasks) or *team* (one shared task), pick a **lead**, and set an **update cadence** (e.g. daily/weekly progress note). Shared task shows all assignees + lead; cadence drives reminder nudges.
- **Attachments (multi-select) in chat and tasks:** reuse the existing secure document storage; attach several files to a chat message or a task, visible only to the thread/task members.

I'll build C right after you confirm the A decisions (so I'm not switching context twice).
