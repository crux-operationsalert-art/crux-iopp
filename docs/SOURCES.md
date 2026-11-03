# Source inventory (inspected once, 03 Nov 2026)

| Source | Access | What it contains / limitation |
|---|---|---|
| Drive "Zonal Daily" folder (1ANPZ30i…) | ✅ read | Daily `Live_Zonewise Monthly Business Tracker` xlsx files (Oct 2026: as on 9, 26, 28, 29, 30 Oct). Copies only, never written |
| Drive parent folder (1CWaxqeo…) | ✅ listed | Sub-folders Point Wise, Case Wise, BOM Testing Files, Zonal Daily; `Full Data-20260720….zip` (83 MB, not yet inspected) |
| Tracker 30 Oct 2026, sheet "Main Tracker" | ✅ parsed | Blocks per zone → location → client with target, actual, revenue target, actual revenue, billing and monthly history columns. No Entry / Closure / Cancelled split. Data-quality notes are recorded in the import batch (database), not here |
| Other sheets: Haque, 10 Days Analysis, June 2026 Target Sheet, Old Tracker till Feb 2026 | ✅ listed | Candidate history and target sources for the M3 import |
| Chat "Live zonewise tracker automation" | ⚠ share page renders no text; summary found via chat search | Branch counts arrive via a WhatsApp group; midnight deadline + 10 AM buffer; dated targets and reassignments |
| Chat "TAT Report" | ⚠ share page renders no text; summary only | Zone reports; Document vs Field TAT; location regroupings; age buckets; priority lists (UX ideas reused) |
| CRUX BI dashboard (github.io) | Not re-inspected (the SOW records only a UI shell with filters Month, Stakeholder, Region, Zone, Location, Client Family) | Filter concepts reused |
| Existing Supabase `crux` project | ✅ table list only (read-only) | Separate live system — never modified |
