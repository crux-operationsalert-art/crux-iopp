/** In-app help (D-102): short "what is this / what do I do" notes behind every small ? and the answers the Need help chat gives.
 *  Plain words, the same names the screens use. No personal names here — desk people come from the database. */

export const SECTION_HELP: [string, string][] = [
  // pages
  ['my day', 'Your daily update. Type today\'s Received, Entry, Closed and Cancelled for each client. Yesterday\'s pending is carried forward and aged for you — change only what is different, then send. Due by midnight; a late window runs till 10 am next day.'],
  ['my plan', 'Checking in is your plan for the day — put the number you aim to do on each client and a note, then check in. Your actual output is your My day update; Commitment % is what you did out of what you planned.'],
  ['my kpis', 'The KPIs your department has assigned to you. For each period (daily, weekly or monthly) put what you plan and what you did; the % is done out of planned — the same plan-vs-done idea as operations. The target is per period, and the achievement on these KPIs over the month counts in the monthly score. Managers also see the KPIs of their team here.'],
  ['reviews', 'The monthly score out of 10: 75% from KPIs and 25% from attributes. A manager gives a base score, and the measured numbers (achievement, TAT, commitment, attendance; and self/team shrinkage, team performance and growth) automatically adjust it so it stays fair. HR/Admin lock the month to publish it, then each person sees their score and how it was worked out.'],
  ['chat', 'Message your manager, your team, colleagues under the same manager and HR. "Need help" answers questions about the app and passes operations, HR and finance questions to the right people.'],
  ['tasks & misses', 'Things waiting for you. A miss (for example a day not reported) needs your reason; Admin closes it after your request. A to-do closes by itself once it is done.'],
  ['notifications', 'Every alert the app sent you. Tap one to go straight to the place where you act on it. Turn on phone alerts and install the app from here.'],
  ['attendance & leave', 'Attendance is marked from your daily reporting; your manager confirms it. Ask for leave here and see what is left.'],
  ['my team', 'The people who report to you: their daily status, profiles, HR details and police verification. Add a team member from here.'],
  ['targets', 'Monthly targets for you and your team, by location and client. Managers pass targets down to their team before the lock date.'],
  ['payroll', 'Monthly pay worked out from salary, confirmed attendance, incentives and deductions. Managers review their team; HR approves and locks.'],
  ['penalty ledger', 'Penalties proposed under the approved policy, with the reason. They are applied only after review.'],
  ['zonal tracker history', 'Month-end cases, revenue and billing per location from October 2024, from the Zonal Tracker files.'],
  ['reports', 'The Zonal Tracker, Revenue Status, daily submissions and history, filtered to what you are allowed to see.'],
  ['zonal tracker', 'The same layout as the daily Zonal Tracker, built from the figures entered in the app. Download it from here.'],
  ['revenue status', 'Revenue month to date against target, by zone, location and client.'],
  ['admin', 'Set-up for Admin and HR: people, locations, clients and rates, targets, uploads, reopening days, month close, policies and settings. Every change is logged.'],
  // sections
  ['today', 'Today\'s one job: send your daily update before midnight. The ring shows your on-time streak.'],
  ['needs attention', 'Open misses and tasks for you or your team. Tap "Open tasks" to act on them.'],
  ['set up this phone', 'Allow notifications so reminders reach you even when the app is closed. If they are blocked, follow the steps shown to allow them in the phone settings.'],
  ['my team today', 'Who in your direct team has sent today\'s update. When everyone is resolved you can certify the team.'],
  ['alerts', 'Your latest unread alerts. Tap one to open it.'],
  ['performance', 'Revenue and cases month to date against target, the trend, and how the month is likely to end.'],
  ['trend', 'Day by day revenue and cases this month compared with earlier months.'],
  ['collections', 'Money side of each client and location: bills raised, money received and reconciled by age, and what is still outstanding. The location head fills it daily; 0 where nothing happened.'],
  ['certify my team', 'Once every person in your direct team has sent (or is marked absent / on leave), check the team roll-up and certify it. If your total differs from the calculated one, give the reason.'],
  ['daily message', 'A ready-made summary of the day to copy into WhatsApp, if your group still needs it.'],
  ['team figures on clients you don', 'Your team\'s figures for clients you do not enter yourself. Expand to see each person and correct with a note if needed.'],
  ['submit these figures', 'Check the totals. After sending, the figures are locked; your manager can correct them with a note and only Admin can reopen the day.'],
  ['my salary', 'Your salary on record. Declare your annual CTC or monthly in-hand pay; the full break-up (basic, HRA, PF, PT) is worked out and HR approves it. Only you, HR and Admin see it.'],
  ['salary declarations', 'Salaries people have declared, waiting for HR to approve or reject.'],
  ['salary history', 'Every salary change with the date it applies from. Visible to HR, Admin and the person only.'],
  ['employment details', 'Joining date, PF and other employment details kept by HR.'],
  ['police verification', 'Compulsory for everyone. Record the status and upload the certificate. Overdue alerts go one level higher every week.'],
  ['leave requests waiting for you', 'Leave asked for by your team. Approve or reject with a note.'],
  ['request leave', 'Choose the dates and type of leave and give a reason. Your manager is told.'],
  ['my leave requests', 'Your leave requests and their status.'],
  ['team attendance', 'Month calendar for your team. Tap a day to correct it; confirm the day when it is right. Unpaid days in payroll come only from confirmed attendance.'],
  ['holidays', 'National and regional holidays. Nobody is expected to report on these days.'],
  ['set targets for my team', 'Split your target across your team by location and client before the lock date.'],
  ['me and my team', 'Your figures and each team member\'s against target this month.'],
  ['monthly targets', 'Case targets per location and client for the month.'],
  ['reopen closed days', 'Admin only: reopen a closed day for chosen people, locations and dates so figures can be corrected and sent again.'],
  ['month close', 'Admin only: check the month is complete and take the month-end backup before closing it.'],
  ['bulk upload', 'Upload people, clients, rates or targets from the template. You see a check of every row before anything is saved.'],
  ['rate cards', 'Per-case rates by client and location, with the date each rate applies from.'],
  ['people', 'Everyone in the app, their roles, reporting line and status. Issue activation codes from here.'],
  ['roles', 'What each person can see and do.'],
  ['records', 'Change history for this record.'],
  ['audit log', 'Who changed what and when. Read only.'],
  ['two-step sign-in', 'A second check at sign-in with a code from an authenticator app, for accounts that see sensitive data.'],
  ['this device', 'Whether this phone or computer gets alerts and whether the app is installed.'],
  ['incentives, deductions', 'Extra pay or deductions proposed for the month. Managers propose; HR approves.'],
  ['how the pay sheet is worked out', 'The rules used to work out pay: basic, HRA, PF, ESI, professional tax and unpaid days.'],
  ['your team on payroll', 'Your team\'s pay for the month to review before HR locks it.'],
  ['penalty rules', 'The approved penalty policy. Nothing is deducted without an approved rule.'],
  ['attrition', 'People who joined and left in the last 12 months.'],
  ['missing submissions', 'People who have not sent their daily update for the day.'],
  ['by person', 'Each person\'s figures, with their team rolled up under them.'],
  ['by location', 'Figures by location.'],
  ['locations', 'Locations, their heads and type (own or partner).'],
  ['clients', 'Clients and the locations where they are served.'],
  ['revenue — what makes it up', 'How revenue is worked out: cases times the per-case rate for each client.'],
  ['collections — what makes it up', 'How collections are added up: received and reconciled by age, against receivables at the start of the month.'],
  ['people behind the numbers', 'How many people reported, were on leave or did not report.'],
  ['month to date', 'Totals from the 1st of the month up to the chosen day.'],
  ['my team', 'The people who report to you and their status today.'],
  ['client-wise collections', 'Collections by client for the month.'],
  ['stakeholder', 'Revenue grouped by Zonal Manager.'],
  ['business associate', 'Partner (BA) agreements, security cheques and their papers.'],
  ['partner agreements', 'Partner agreements and security cheques. Restricted to HR and Admin.'],
  ['details', 'The full break-up behind this row.'],
  ['done — view or change', 'Your completed profile. Open it to view or correct details.'],
  ['documents', 'ID and other papers. Upload a clear photo or PDF; HR verifies it. Only you, HR and Admin can open them.'],
  ['id and bank', 'Aadhaar, PAN and bank details read from the documents. HR checks each against the document.'],
];

/** The ? note for a section or page title (longest matching start wins). */
export function sectionHelp(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const t = title.toLowerCase().replace(/[’']/g, "'").trim();
  let best: [string, string] | null = null;
  for (const e of SECTION_HELP) if ((t === e[0] || t.startsWith(e[0])) && (!best || e[0].length > best[0].length)) best = e;
  return best ? best[1] : null;
}

export type Desk = 'ops' | 'hr' | 'finance' | 'app';
export type Faq = { q: string; a: string; k: string[]; link?: [string, string] };

/** Questions about using the app, answered on the spot by "Need help". */
export const FAQ: Faq[] = [
  { q: 'How do I send my daily update?', k: ['daily', 'update', 'send', 'submit', 'enter', 'figures', 'numbers', 'report', 'my day'], link: ['/productivity', 'Open My day'],
    a: 'Open My day. For each client type Received, Entry, Closed and Cancelled (0 where nothing happened). Pending by age is carried forward from your last update — change only what is different. Then tap Review and send at the bottom.' },
  { q: 'Nothing happened on a client today', k: ['nothing', 'zero', 'no work', 'same', 'no change', 'nil'],
    a: 'Tap Nothing new on that client in My day — it puts 0 in every box and keeps the pending carried forward. If several clients had nothing, use "Nothing new on the untouched clients" at the top.' },
  { q: 'What is the deadline?', k: ['deadline', 'time', 'late', 'last time', 'midnight', 'when'],
    a: 'Send by midnight. A late window runs until 10 am the next day (it counts as late). After that the day is closed and only Admin can reopen it.' },
  { q: 'I made a mistake after sending', k: ['mistake', 'wrong', 'correct', 'edit', 'change', 'after submit', 'locked', 'reopen'],
    a: 'Sent figures are locked. Ask your manager to correct them (they add a note and you are told), or ask Admin to reopen the day — then correct and send again. Use Chat → Ask on that client to tell your manager what is wrong.' },
  { q: 'What do Rollover, Received, Entry, Closed and Cancelled mean?', k: ['rollover', 'received', 'entry', 'closed', 'cancelled', 'meaning', 'net pendency', 'logged'],
    a: 'Rollover is yesterday\'s pending, carried forward. Received is new cases from the client today. Entry is how many of today\'s received you logged in the client\'s portal (never more than Received). Closed and Cancelled are cases finished or withdrawn today. Net pendency = Rollover + Received − Closed − Cancelled.' },
  { q: 'Pending by age does not tally', k: ['tally', 'pending by age', 'bucket', 'age', 'match', 'mismatch', 'tat'],
    a: 'The six age groups must add up to Net pendency. Correct the age groups, or write why it does not tally in the box that appears (for example cases transferred) — your manager sees it.' },
  { q: 'How do I fill collections?', k: ['collection', 'bills', 'received today', 'reconciled', 'receivable', 'outstanding'],
    a: 'Only the location head must fill it, once a day per client: bills raised (number and amount), money received today by age and money reconciled by age — 0 where none. Receivables at the start of the month are entered once a month.' },
  { q: 'A client is missing or should not be in my list', k: ['client missing', 'add client', 'remove client', 'my clients', 'wrong client', 'inactive'],
    a: 'In My day open "My clients" and tick the clients you work on (untick the ones you do not). If a client is not in the list at all, ask your manager or Admin to add it.' },
  { q: 'How do I ask my manager about a figure?', k: ['ask', 'manager', 'question', 'clarify', 'doubt', 'message'],
    a: 'Tap Ask on that client in My day — a chat opens with your manager, linked to that client and date. Managers see Ask next to each person in the team breakdown.' },
  { q: 'How do I see my team\'s updates?', k: ['team', 'validate', 'who has not', 'pending people', 'roll up', 'drill'],
    a: 'On My day the client tiles show your team\'s figures. Tap a tile to expand it down to each person. If someone has not updated you can send a reminder or mark them absent. Validate when the figures are right, then certify the team.' },
  { q: 'How do I certify my team?', k: ['certify', 'certification'],
    a: 'When everyone in your direct team has sent (or is marked absent or on leave), open Certify my team on My day, check the totals and certify. If your total differs, give the reason.' },
  { q: 'How do I apply for leave?', k: ['leave', 'holiday', 'off', 'absent', 'sick'], link: ['/attendance', 'Open Attendance & leave'],
    a: 'Open Attendance & leave → Request leave, choose dates and type, give a reason. Your manager approves it. Days on approved leave do not count as misses.' },
  { q: 'How is my attendance marked?', k: ['attendance', 'present', 'marked'],
    a: 'From your daily reporting: sending your update marks you present for that day. Your manager confirms attendance; payroll uses only confirmed days.' },
  { q: 'How do I complete my profile?', k: ['profile', 'complete', 'aadhaar', 'pan', 'bank', 'cheque', 'upload document', 'scan'], link: ['/profile', 'Open My profile'],
    a: 'Open My profile. Only what is still pending is shown. Upload a clear photo of your Aadhaar, PAN and a cancelled cheque — the numbers are read from them; check and confirm. You have 3 days from first sign-in; after that the app stays locked until it is done.' },
  { q: 'The document could not be read', k: ['not read', 'blurred', 'blur', 'ocr', 'wrong document', 'scan failed'],
    a: 'Take the photo again in good light, flat, with the whole card in the frame and no glare. You can also upload the PDF. If it still fails, tap "Type it from this document instead" — HR checks it against the document.' },
  { q: 'How do I declare my salary?', k: ['salary', 'ctc', 'in hand', 'pf', 'plb', 'bonus', 'pay'],
    a: 'My profile → My salary → Declare. Give your annual CTC or your monthly in-hand pay, choose PF and PLB; the full break-up is shown. HR approves it. Only you, HR and Admin see it.' },
  { q: 'Where is my pay statement?', k: ['payslip', 'pay statement', 'salary slip', 'payroll'], link: ['/payroll', 'Open Payroll'],
    a: 'Open Payroll (My pay statement). It shows the month\'s break-up once HR has worked it out.' },
  { q: 'What is a miss and how do I close it?', k: ['miss', 'misses', 'task', 'resolve', 'reason'], link: ['/tasks', 'Open Tasks'],
    a: 'A miss is something not done on time (for example a day not reported). Open Tasks, give your reason and request resolution. Admin decides. To-dos close by themselves once done.' },
  { q: 'How do I install the app?', k: ['install', 'download', 'app', 'home screen', 'iphone', 'android'], link: ['/notifications', 'Open install steps'],
    a: 'Android: open the link in Chrome and tap Install the CRUX app (or menu ⋮ → Install app). iPhone: open it in Safari, tap Share → Add to Home Screen → Add.' },
  { q: 'I am not getting notifications', k: ['notification', 'alert', 'reminder', 'not getting', 'push'], link: ['/notifications', 'Open Notifications'],
    a: 'Open Notifications → Set up this phone → Turn on notifications and allow them. If they were blocked earlier, allow them in the phone settings for Chrome (or the CRUX app) as shown on the screen.' },
  { q: 'I forgot my password / cannot sign in', k: ['password', 'login', 'sign in', 'forgot', 'activation', 'code', 'locked out'],
    a: 'Ask your manager or Admin for a new activation code, then sign in with your mobile number and the code and set a new password. Never share your password in chat.' },
  { q: 'Where do I see targets?', k: ['target', 'targets'], link: ['/targets', 'Open Targets'],
    a: 'Open Targets for your monthly targets by location and client. My day also shows your target and month-to-date progress on each client.' },
  { q: 'Where are the reports and the Zonal Tracker?', k: ['tracker', 'zonal', 'revenue status', 'report', 'download'], link: ['/reports', 'Open Reports'],
    a: 'Open Reports: Zonal Tracker (downloadable), Revenue Status, daily submissions and history. You see what your role allows.' },
  { q: 'How do streaks, points and levels work?', k: ['streak', 'points', 'level', 'badge', 'gold', 'silver', 'platinum'],
    a: 'Each working day sent on time adds to your streak (holidays and leave do not break it). On time is 10 points, before 7 pm 5 more, late 4; a complete profile is 50 once. Levels: Silver 150, Gold 400, Platinum 800.' },
  { q: 'What does online / away / on leave mean in Chat?', k: ['online', 'available', 'away', 'status', 'presence'],
    a: 'Online: the app is open now. Gets alerts: not in the app, but alerts reach their phone or computer. On leave / Day off: not working today. Last seen shows when they last opened the app.' },
  { q: 'How do I add a team member?', k: ['add member', 'new joinee', 'new person', 'onboard', 'invite'], link: ['/team', 'Open My team'],
    a: 'Open My team → Add a team member. Share the activation message it gives you; they sign in with it.' },
  { q: 'Police verification', k: ['police', 'verification', 'certificate'],
    a: 'Compulsory for everyone. Managers record the status (applied / verified) and upload the certificate in My team → Police verification.' },
];

const STOP = new Set('a an the i my me to do how is are what where when can of in on for it this that and or with from please'.split(' '));
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));

/** Best matching answers for a question (score > 0), most relevant first. */
export function findAnswers(question: string, n = 3): Faq[] {
  const q = question.toLowerCase(), ws = words(question);
  return FAQ.map((f) => {
    let s = 0;
    for (const k of f.k) if (k.includes(' ') ? q.includes(k) : new RegExp(`\\b${k}(s|es|ed|ing)?\\b`).test(q)) s += k.includes(' ') ? 3 : 2;
    const fw = new Set(words(f.q + ' ' + f.k.join(' ')));
    for (const w of ws) if (fw.has(w)) s += 1;
    return [s, f] as const;
  }).filter(([s]) => s >= 2).sort((a, b) => b[0] - a[0]).slice(0, n).map(([, f]) => f);
}

/** Which team a question is for, when it is not about using the app. */
export function guessDesk(question: string): Desk | null {
  const q = question.toLowerCase();
  const has = (ks: string[]) => ks.filter((k) => q.includes(k)).length;
  const score: [Desk, number][] = [
    ['finance', has(['bill', 'invoice', 'payment', 'paid', 'accounts', 'finance', 'gst', 'reimburse', 'expense', 'collection', 'receivable', 'outstanding', 'ledger', 'tds', 'advance'])],
    ['hr', has(['leave', 'salary', 'payslip', 'pf ', 'esi', 'appraisal', 'increment', 'joining', 'resign', 'notice period', 'hr', 'police', 'agreement', 'insurance', 'holiday', 'attendance', 'offer letter', 'documents'])],
    ['ops', has(['case', 'client', 'tat', 'pending', 'allocation', 'verification', 'field', 'visit', 'report', 'rate', 'target', 'branch', 'location', 'process', 'portal', 'cancel', 'closure'])],
  ];
  score.sort((a, b) => b[1] - a[1]);
  return score[0][1] > 0 ? score[0][0] : null;
}
/** True when the question is clearly for people, not about using the app (two or more team words, or a status / "my … is pending" question). */
export function forPeople(question: string): boolean {
  const q = question.toLowerCase();
  const d = guessDesk(q); if (!d) return false;
  const status = /\b(pending|not (yet )?(received|paid|credited|approved)|when will|delayed|stuck|status of|why (is|was|did))\b/.test(q);
  const hits = ['bill', 'invoice', 'payment', 'accounts', 'reimburse', 'expense', 'gst', 'tds', 'advance', 'appraisal', 'increment', 'resign', 'notice period', 'insurance', 'offer letter', 'allocation', 'field', 'visit', 'portal']
    .filter((k) => q.includes(k)).length;
  return status || hits >= 2;
}
