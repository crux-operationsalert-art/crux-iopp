# Metric dictionary

All metrics are computed in Postgres (`app.*` functions and the `v_*` views). Dates are business dates in Asia/Kolkata. "Line" = one `productivity_lines` row (person × work_date × client_location).

| Metric | Formula | Unit | Date rule | Source | Worked example |
|---|---|---|---|---|---|
| Entry / Closure / Cancelled | as entered | cases (int ≥ 0) | work_date | productivity_lines | E=12, C=9, X=2 |
| Net Cases Actioned (D-02) | Entry + Closure − Cancelled | cases | daily; MTD = Σ month to date | v_line_metrics | 12+9−2 = **19** |
| Gross actions | Entry + Closure | cases | same | v_line_metrics | 21 |
| Cancellation rate | Cancelled ÷ (Entry+Closure); N/A when 0 | % | same | v_line_metrics | 2/21 = 9.5% |
| Opening WIP (D-01) | prior day's closing WIP for the same person×client_location; seed = wip_openings | cases | calendar day | v_wip | seed 40 |
| Closing WIP (D-01) | Opening + Entry − Closure − Cancelled | cases | same | v_wip | 40+12−9−2 = **41** |
| Revenue (D-03) | billable qty × rate in effect on work_date; qty = Entry, Closure or Net according to `billable_event` | ₹ | work_date picks the rate | v_line_revenue | closure 9 × ₹750 = **₹6,750** |
| Partner share / CRUX share (D-04) | revenue × partner_share_pct / crux_share_pct from the branch's share rule in effect | ₹ | work_date | v_line_revenue | ₹6,750 at CRUX 80 / partner 20 → CRUX ₹5,400, partner ₹1,350 |
| Collections received | Σ amount_received | ₹ | collection_date | collection_entries | 100,000 |
| Collections reconciled | Σ amount_reconciled | ₹ | collection_date (recon date kept separately) | collection_entries | 80,000 |
| Unreconciled difference | received − reconciled | ₹ | same | v_collections | **20,000** (never shown as reconciled) |
| Bills raised | Σ bill_count, Σ bill_amount | count, ₹ | bill_date | bill_entries | 3 bills, ₹45,000 — independent of revenue and cash |
| Team roll-up | Σ lines of every person below the manager (all levels) on that date, excluding the manager | cases | reporting line in effect on work_date | app.team_rollup | 3 execs: 19+10+0 = 29 |
| Leader own contribution | Σ the manager's own lines | cases | same | same | 5 |
| Calculated leader total | team roll-up + own | cases | same | certifications | 34 |
| Certified figure / variance (D-06) | certified − calculated total; reason required if ≠ 0 | cases | same | certifications | certified 35 → variance +1, reason required |
| Target achievement % | actual ÷ target; "N/A" if target = 0 or missing | % | month | app.target_progress | 6,750 / 15,000 = 45% |
| Remaining | max(target − actual, 0) | unit of the metric | month | same | 8,250 |
| Required daily run-rate | remaining ÷ remaining working days (incl. today if the day is still open) | unit/day | working calendar | same | 8,250 / 11 = 750 |
| Projection (labelled) | actual ÷ elapsed working days × total working days | unit | same | same | 6,750/14×26 = 12,536 |
| Target lock | end of the 5th working day of the month (Sundays and holidays excluded), 23:59:59 IST | timestamp | — | app.target_lock_at | Nov 2026: working days 2,3,4,5,6 → lock 6 Nov 23:59 |
| Submission window | open until 23:59:59 D, grace until 10:00 D+1, then locked unless an Admin reopen grant is active | — | — | app.window_state | submit at 08:00 D+1 → accepted, flagged late |
| Shrinkage % (M3) | unavailable scheduled hours (leave + absence + late + early) ÷ scheduled hours | % | month | attendance | 18 h / 208 h = 8.7% |
| Attrition % (M3) | exits in period ÷ average active headcount × 100 | % | period | employment periods | 2 / 40 = 5% |

**Double-counting rules:** roll-ups are always computed from unique lines; certified figures never enter a sum; the manager's own lines are counted once (in "own", never in "team"); a person allocated to several clients has one line per client-location, and the person total is the sum of those lines.
