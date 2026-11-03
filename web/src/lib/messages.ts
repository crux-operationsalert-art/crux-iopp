// Copy-paste message builders (WhatsApp / email). Plain text, WhatsApp *bold* markers, no personal data beyond
// what the sender already has on screen.
import { label } from './format';

export const appUrl = () => window.location.href.split('#')[0];
const longDate = (s: string) => new Date(s + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const n = (v: unknown) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Number(v ?? 0));
const inr = (v: unknown) => '₹' + n(v);

export const ROLE_NAMES: Record<string, string> = {
  executive: 'Executive', manager: 'Team Manager', bm: 'Branch Manager', ba: 'Business Associate (partner)', zm: 'Zonal Manager',
  ops_head: 'Operations Head', collections_head: 'Collections Head', admin: 'Admin', hr_admin: 'HR Admin', auditor: 'BI & Growth (sees all, read only)', leadership: 'Leadership',
};

export type Activation = { full_name: string; code: string; login_id: string; expires_at: string };

export function onboardingMessage(a: Activation, o: { sender: string; role?: string; place?: string; reset?: boolean }) {
  const first = a.full_name.split(' ')[0];
  const isBA = o.role === 'ba';
  const leader = o.role && !['executive', 'ba'].includes(o.role);
  const lines = [
    o.reset ? `Hi ${first}, here is your new CRUX app activation code.` : `Hi ${first}, welcome to CRUX! 👋`,
    '',
    o.reset ? '' : `You have been added to the *CRUX Productivity app* by ${o.sender}${o.role ? ` as *${ROLE_NAMES[o.role] ?? label(o.role)}*` : ''}${o.place ? ` (${o.place})` : ''}.`,
    '',
    `🔗 App: ${appUrl()}`,
    `📲 Install the mobile app: ${appUrl()}#/install`,
    `👤 Login ID: *${a.login_id}*`,
    `🔑 One-time activation code: *${a.code}*`,
    `⏳ Valid till ${new Date(a.expires_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · works only once`,
    '',
    '*First-time setup (2 minutes)*',
    '1. Open the app link on your phone (Chrome or Safari).',
    '2. Tap *First time / reset password*.',
    '3. Enter your Login ID and the activation code, then choose your own password (at least 10 characters).',
    '4. Sign in with your mobile number and the new password.',
    '5. Install the app from the 📲 link (Android: *Install the CRUX app*; iPhone: Safari → Share → *Add to Home Screen*) and tap *Turn on notifications* so reminders reach your phone.',
    '',
    '*Every working day*',
    '• *My day* → under *My clients*, tick the clients you work on (untick ones you don\'t). Only ticked clients appear for entry.',
    `• *My day* → enter Entry / Closure / Cancelled for each client & location → *Submit* before midnight (late window till 10:00 next morning).`,
    '• Submitting your figures also marks your attendance (no check-in needed). After submitting, tap *Copy message* and paste it in your WhatsApp group.',
    ...(isBA ? ['• As a Business Associate, enter your branch\'s figures the same way; your CRUX manager reviews and certifies them.'] : []),
    ...(leader ? ['• *My team* → see who has submitted, correct or remove a wrong entry with a note, add team members, and certify the team total (a reason is needed if your total differs from the team roll-up). *Attendance* → confirm your team\'s attendance and approve leave.'] : []),
    '',
    'Never share your password or this code with anyone. If the code expires, ask me for a new one.',
    `— ${o.sender}`,
  ];
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n').trim();
}

export type DayLine = { zone: string; location: string; client: string; entry: number; closure: number; cancelled: number;
  mtd_entry: number; mtd_closure: number; mtd_cancelled: number; wip?: number | null; people?: number };
export type Att = { status?: string | null; in?: string | null; out?: string | null; shrinkage?: number | null;
  team?: { people: number; present: number; late: number; leave: number; absent: number; not_marked: number } | null };
export type Money = { collected_today: number; collected_mtd: number; billed_today?: number; billed_mtd?: number } | null;

/** WhatsApp daily summary in the format the zones already post, with every captured number added. */
export function dailyMessage(o: { date: string; name: string; title?: string; lines: DayLine[]; att: Att; money?: Money;
  submitted?: { done: number; of: number } | null; note?: string | null }) {
  const out: string[] = [`*${longDate(o.date)}*${o.title ? ` — ${o.title}` : ''}`, o.name];
  const a = o.att;
  if (a.team) {
    const t = a.team;
    out.push(`Attendance: ${t.present + t.late}/${t.people} present${t.late ? ` (${t.late} late)` : ''}${t.leave ? ` · ${t.leave} leave` : ''}${t.absent ? ` · ${t.absent} absent` : ''}${t.not_marked ? ` · ${t.not_marked} not reported yet` : ''}`);
  } else {
    out.push(`Attendance: ${a.status ?? 'Not reported yet'}`);
  }
  out.push(`MTD Shrinkage: ${a.shrinkage == null ? '—' : a.shrinkage.toFixed(1) + '%'}`);
  if (o.submitted) out.push(`Submitted: ${o.submitted.done}/${o.submitted.of}`);
  const zones = [...new Set(o.lines.map((l) => l.zone))];
  const tot = { e: 0, c: 0, x: 0, me: 0, mc: 0, mx: 0 };
  for (const z of zones) {
    const zl = o.lines.filter((l) => l.zone === z);
    for (const loc of [...new Set(zl.map((l) => l.location))]) {
      out.push('', `*${loc === z ? z : `${z} · ${loc}`}*`);
      for (const l of zl.filter((x) => x.location === loc)) {
        tot.e += +l.entry; tot.c += +l.closure; tot.x += +l.cancelled; tot.me += +l.mtd_entry; tot.mc += +l.mtd_closure; tot.mx += +l.mtd_cancelled;
        out.push(`${l.client}: ${n(l.entry)}`);
        out.push(`   E ${n(l.entry)} · C ${n(l.closure)} · X ${n(l.cancelled)}${l.wip != null ? ` · WIP ${n(l.wip)}` : ''} | MTD E ${n(l.mtd_entry)} · C ${n(l.mtd_closure)} · X ${n(l.mtd_cancelled)}`);
      }
    }
  }
  if (!o.lines.length) out.push('', 'No client rows today.');
  else out.push('', `*Total today*: Entry ${n(tot.e)} · Closure ${n(tot.c)} · Cancelled ${n(tot.x)} · Net ${n(tot.e + tot.c - tot.x)}`,
    `*MTD*: Entry ${n(tot.me)} · Closure ${n(tot.mc)} · Cancelled ${n(tot.mx)} · Net ${n(tot.me + tot.mc - tot.mx)}`);
  if (o.money) out.push(`Collections: today ${inr(o.money.collected_today)} · MTD ${inr(o.money.collected_mtd)}` +
    (o.money.billed_mtd != null ? ` | Bills raised: today ${inr(o.money.billed_today)} · MTD ${inr(o.money.billed_mtd)}` : ''));
  if (o.note) out.push(`Note: ${o.note}`);
  return out.join('\n');
}

export const waLink = (text: string, mobile?: string | null) => {
  const d = (mobile ?? '').replace(/\D/g, '').slice(-10);
  return `https://wa.me/${d.length === 10 ? '91' + d : ''}?text=${encodeURIComponent(text)}`;
};
export const mailLink = (to: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
