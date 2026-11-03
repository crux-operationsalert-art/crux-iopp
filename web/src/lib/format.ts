const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const n0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const money = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : inr.format(Number(v)));
export const num = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : n0.format(Number(v)));
export const pct = (v: unknown) => (v === null || v === undefined ? 'N/A' : `${Number(v).toFixed(1)}%`);
export const iso = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00+05:30'); d.setDate(d.getDate() + n); return iso(d); };
export const monthStart = (s: string) => s.slice(0, 8) + '01';
export const nice = (s: string) => new Date(s + 'T12:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
export const time = (s: string) => new Date(s).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function left(target: string, now = Date.now()) {
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return 'passed';
  const h = Math.floor(ms / 3.6e6), m = Math.floor((ms % 3.6e6) / 6e4);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}
export const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
