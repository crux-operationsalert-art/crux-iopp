# CRUX IOPP — UX audit across all users (10 Nov 2026)

Walked the app as each kind of user. "Fixed now" = done and live this round. "Recommend" = needs your call or a later round.

## 1. Fresher / junior executive on a phone (often first job, basic English, low-end Android)
This is the highest-volume user and the one the app lives or dies on.
- **Daily entry felt like homework.** Fixed now: yesterday's pending is carried forward and aged automatically, "Nothing new" sets a client to zero in one tap, a sticky send bar shows how many are left and jumps to the first gap, and sending ends with a small reward (streak/points). Entry is now faster than the WhatsApp copy-paste it replaces.
- **Wrong details slipped in** (e.g. a bank typed as "bango bango"). Fixed now: the bank is taken from the IFSC, rubbish names are refused, and anything already wrong is flagged back to the person with a plain "please correct" message and a Fix button.
- **"What is this screen / what do I do?"** A small **?** now sits beside every page and section title with one line of plain guidance, and **Need help** answers common how-to questions instantly.
- **Recommend — language.** The app is English-only. A large share of field staff are more comfortable in Hindi or a regional language. This is the single biggest remaining barrier to adoption. It needs your decision on which languages (Hindi? Marathi? others?) before I build it, because translation has to be done properly, not machine-guessed.
- **Recommend — numbers-only keypad everywhere.** Most count fields already open the numeric keypad; I'd like to sweep the few that don't.

## 2. Manager — educated / qualified
- Team roll-up, drill-down, certification and the new per-figure **Ask** chat are in place.
- Fixed now: **Operational gaps this month** (Admin → Data quality, and for managers via the same data) lists who did not report and which figures were flagged as not tallying, so chasing is concrete rather than guesswork.

## 3. Manager — less formally educated / not very comfortable with apps
- Fixed now: line icons instead of emoji (consistent on every phone), bigger tap targets, the **?** tips, and the Need help desk routing (operations, HR and finance questions each go to the people set for that desk) so a stuck manager always has a person to ask inside the app.
- Recommend: a short one-time "how your team page works" walkthrough on first open. (Small, low-risk; next round.)

## 4. Stakeholders (Zonal Manager groups) and management / leadership
- Reports, Zonal Tracker, Revenue Status, performance and attrition are in place and scoped to what each role may see.
- Fixed now: **Admin → Data quality** gives leadership a single "X of N people have all details correct" view with a breakdown by problem and a one-click "remind everyone to fix", so the push to 100% correct data is visible and drivable from the top.
- Fixed now (Admin only): on each person's profile, **App usage** shows how much time they spend in CRUX and their most active hour — an honest adoption signal. (In-app only; see note below.)

## 5. Everyone — reliability / reach
- Fixed now: **notifications are compulsory.** The app does not go past the start screen until this phone has them on, with the install-then-allow path spelled out for iPhone. This closes the biggest reason people "miss" things — the app never reaching them.
- Reality to accept: a device that genuinely cannot do web notifications (an old phone, a locked-down work desktop) will be held at that screen. The screen tells them exactly what to do; if some staff are on such devices, tell me and we can define a narrow exception.

## On the phone-usage tracking you asked for
A web app cannot see other apps on a phone or how long someone spends in them — the phone's operating system does not expose that to any website or PWA, so a hidden version of this does not exist on our platform, and I would not build covert monitoring of staff's personal phones in any case. What is built instead is the honest, useful version: how much time and at which hours each person uses **CRUX itself**, visible to Admin on their profile, and noted in the user agreement. That is the data that actually tells you about adoption.

## Data correctness to 100% — how it works now
The tool cannot invent a correct value it was never told, so "100%" is reached by detecting what is wrong and chasing the right person to fix it:
- Every person's record is checked for missing or malformed Aadhaar, PAN, bank (account, IFSC, recognised bank name), date of birth, mobile, email, PIN, emergency contact, address, qualification and joining date.
- Each person sees their own issues on Home and in My profile with a Fix button, and gets a daily reminder until they are fixed.
- HR/Admin get the Data quality dashboard to drive it and a "remind everyone" button.
- Operational/collection gaps (days not reported, figures flagged as not tallying) are surfaced for managers to chase or reopen. The tool does not silently rewrite history; corrections go through the person with an audit trail.

Current live picture: only a handful of people have complete, valid HR/identity details — most are missing Aadhaar/PAN/bank entirely (never uploaded) or have not activated. The dashboard now makes that visible and the reminders will chase it.
