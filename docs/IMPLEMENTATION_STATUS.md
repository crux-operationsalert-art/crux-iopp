# Implementation status — milestone 2 (03 Nov 2026)

## Live
| What | Where |
|---|---|
| Web app (PWA) | https://crux-operationsalert-art.github.io/crux-iopp/ (GitHub Pages; redeploys on every push to `main` that touches `web/`) |
| Database / auth / functions | Supabase project `crux-iopp-staging` (ref `gizzonxfwsqfwgjyqzxc`, Mumbai, free plan) — the live instance per owner decision D-18 |
| Code | Public repo `crux-operationsalert-art/crux-iopp`; CI runs 43 tests + build on every push |
| Sign-in | Mobile number + own password, set via a one-time activation code (no email/SMS). Edge Function `iopp-auth` |

## Data loaded (real, from the Zonal Tracker as on 30 Oct 2026)
- 14 zones with region (North / South / East / West, derived uniquely from the tracker's region rows), 35 branches/locations (type **unconfirmed** — Admin → Masters → "Confirm branch type"), 22 clients, process "Verification".
- 192 rate cards from Oct 2026 Revenue Tgt ÷ Target (whole-rupee, consistent rates only), valid from 01-Oct-2026, earning on entered − cancelled.
- History Feb–Oct 2026: 1,218 location × client × month rows. Cases and revenue for Mar–Oct and targets for Feb and Oct equal the tracker's Pan India row exactly . Billing imported as recorded; per-month differences vs the Pan India row are stored in the batch reconciliation.
- 52 exceptions recorded (D-21). Jan 2025 – Jan 2026 not imported (D-20).

## Verified
- 43 automated tests (SOW §18 scenarios, access isolation, owner decisions, activation lockout, import token/commit).
- Live: activation (wrong code refused, right code works once, reuse refused), mobile sign-in, `whoami`; live site loads on phone and desktop with no page errors and reaches the server.
- Earlier live journey: executive entry → manager gate → absent / on-behalf → certification (17/17 checks).
- Security advisors: only the intended "signed-in users can call these guarded functions" notices remain.

## Pending owner action
1. **Synthetic test data**: it is fenced off (people exited, masters inactive, test logins banned) but still physically present because deletes need your confirmation. To remove: Supabase dashboard → SQL editor → run `supabase/seed/purge_synthetic.sql`, or reply "purge" and approve the prompt.
2. **Supabase dashboard (optional, 1 minute)**: Authentication → Sign In / Providers → turn **off** "Allow new users to sign up" (accounts are created only by activation) and turn on leaked-password protection if your plan offers it.
3. Confirm branch types (own / partner) and enter rates for the blended-rate exceptions.

## Next milestones
| | Scope |
|---|---|
| M3 | Daily import of the WhatsApp-fed tracker (daily = MTD − previous MTD) for continuity until branches enter directly; bulk upload screens; reminders |
| M4 | HR repository (restricted schema), attendance, leave, holidays UI, shrinkage / attrition |
| M5 | Old Tracker (≤ Jan 2026) mapping; month-close UI; restore test |
