// Revenue Status logic, ported from the Zonal Tracker Builder used by the live tracker automation.
// Input: one row per zone × location × client for the as-on date (MTD), plus the previous upload for "added today".
export type TRow = { region: string | null; zone: string; location: string; client: string; stakeholder: string | null;
  target_cases: number; revenue_target: number; mtd_cases: number; mtd_revenue: number; reported_added: number | null;
  prev_cases: number | null; prev_revenue: number | null };
export type StatusData = { as_of: string; prev_as_of: string | null; wd_done: number; wd_total: number; rows: TRow[]; dates: string[] };

export const cr = (v: number) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  return `${s}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(a)}`;
};
export const pc = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(1)}%`);
export const pp = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)} pp`;
const nf = (v: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(v);

export type Agg = { key: string; owner?: string | null; target: number; revenue: number; tcases: number; cases: number; added: number; added_cases: number;
  ach: number | null; vsPace: number | null; gap: number; needPerDay: number; status: 'Achieved' | 'On track' | 'Watch' | 'Behind' | 'No target'; rows: number };

export function compute(d: StatusData) {
  const N = (v: unknown) => Number(v ?? 0) || 0;
  const rows = d.rows.map((r) => {
    const rate = N(r.target_cases) ? N(r.revenue_target) / N(r.target_cases) : N(r.mtd_cases) ? N(r.mtd_revenue) / N(r.mtd_cases) : 0;
    const added_cases = r.prev_cases != null ? N(r.mtd_cases) - N(r.prev_cases) : N(r.reported_added);
    const added = r.prev_revenue != null ? N(r.mtd_revenue) - N(r.prev_revenue) : N(r.reported_added) * rate;
    return { ...r, target_cases: N(r.target_cases), revenue_target: N(r.revenue_target), mtd_cases: N(r.mtd_cases), mtd_revenue: N(r.mtd_revenue), added, added_cases,
      count_mismatch: r.prev_cases != null && r.reported_added != null && Math.abs(N(r.reported_added) - added_cases) >= 1 };
  });
  const wdDone = Math.max(1, d.wd_done), wdTotal = Math.max(wdDone, d.wd_total), left = Math.max(0, wdTotal - wdDone);
  const elapsed = wdDone / wdTotal;
  const phase = left < 5 ? 'final' : wdDone <= 10 ? 'build' : wdDone <= 20 ? 'mid' : 'close';

  const agg = (key: string, rs: typeof rows, owner?: string | null): Agg => {
    const target = rs.reduce((a, r) => a + r.revenue_target, 0), revenue = rs.reduce((a, r) => a + r.mtd_revenue, 0);
    const ach = target > 0 ? revenue / target : null;
    const vsPace = ach == null ? null : ach - elapsed;
    const status = ach == null ? 'No target' : ach >= 1 ? 'Achieved' : ach >= elapsed ? 'On track' : ach >= 0.9 * elapsed ? 'Watch' : 'Behind';
    return { key, owner, target, revenue, tcases: rs.reduce((a, r) => a + r.target_cases, 0), cases: rs.reduce((a, r) => a + r.mtd_cases, 0),
      added: rs.reduce((a, r) => a + r.added, 0), added_cases: rs.reduce((a, r) => a + r.added_cases, 0), ach, vsPace,
      gap: Math.max(0, target * elapsed - revenue), needPerDay: left > 0 ? Math.max(0, target - revenue) / left : NaN, status, rows: rs.length };
  };
  const group = (f: (r: (typeof rows)[number]) => string, owner?: (r: (typeof rows)[number]) => string | null) => {
    const m = new Map<string, typeof rows>();
    rows.forEach((r) => { const k = f(r); m.set(k, [...(m.get(k) ?? []), r]); });
    return [...m.entries()].map(([k, rs]) => agg(k, rs, owner ? owner(rs[0]) : undefined));
  };
  const pan = agg('Pan India', rows);
  const avg = pan.revenue / wdDone;
  const projected = avg * wdTotal;
  const required = left > 0 ? Math.max(0, pan.target - pan.revenue) / left : 0;
  const stepUp = avg > 0 ? required / avg : null;
  const ach = pan.ach ?? 0;
  const verdict = ach >= 1 ? 'Target achieved' : ach >= elapsed ? 'Ahead of pace' : ach >= 0.9 * elapsed ? 'Slightly behind pace' : 'Behind pace';
  const tone = ach >= 1 || ach >= elapsed ? 'ok' : ach >= 0.9 * elapsed ? 'warn' : 'bad';

  const stakeholders = group((r) => r.stakeholder ?? 'Unassigned').sort((a, b) => b.revenue - a.revenue);
  const regions = group((r) => r.region ?? 'Unassigned').sort((a, b) => b.revenue - a.revenue);
  const zones = group((r) => r.zone, (r) => r.stakeholder).sort((a, b) => b.revenue - a.revenue);
  const locations = group((r) => r.zone === r.location ? r.location : `${r.zone} · ${r.location}`, (r) => r.stakeholder).sort((a, b) => b.gap - a.gap);
  const clients = group((r) => r.client).sort((a, b) => b.revenue - a.revenue);
  const focus = rows.filter((r) => r.revenue_target > 0).map((r) => agg(`${r.location} · ${r.client}`, [r], r.stakeholder)).filter((a) => a.gap > 0)
    .sort((a, b) => b.gap - a.gap).slice(0, 12);

  // Key points (plain sentences, highest value first).
  const pts: { kind: 'day' | 'pace' | 'praise' | 'concern' | 'zero' | 'reporting'; text: string }[] = [];
  const since = d.prev_as_of ? `since ${d.prev_as_of.slice(8, 10)}/${d.prev_as_of.slice(5, 7)}` : 'reported in the daily-count column';
  pts.push({ kind: 'day', text: `Added ${cr(pan.added)} (${nf(pan.added_cases)} cases) ${since}, ${pan.added >= avg ? 'above' : 'below'} the ${cr(avg)} average per working day.` });
  pts.push({ kind: 'pace', text: `${pc(ach)} of the ${cr(pan.target)} target achieved with ${pc(elapsed)} of working days gone (${pp(ach - elapsed)}). At the current average the month closes near ${cr(projected)} (${pc(pan.target ? projected / pan.target : null)}).` });
  if (left > 0 && ach < 1) pts.push({ kind: 'pace', text: `Need ${cr(required)} per working day for the remaining ${left} day(s)${stepUp ? ` — ${stepUp.toFixed(2)}× the current daily average` : ''}.` });
  const ranked = stakeholders.filter((s) => s.ach != null && s.key !== 'Unassigned').sort((a, b) => (b.ach ?? 0) - (a.ach ?? 0));
  if (ranked[0]) pts.push({ kind: 'praise', text: `${ranked[0].key} leads at ${pc(ranked[0].ach)} of target (${cr(ranked[0].revenue)}).` });
  const topAdd = [...zones].sort((a, b) => b.added - a.added)[0];
  if (topAdd && topAdd.added > 0) pts.push({ kind: 'praise', text: `Biggest addition today: ${topAdd.key} with ${cr(topAdd.added)} (${nf(topAdd.added_cases)} cases).` });
  const crossed = rows.filter((r) => r.revenue_target > 0 && r.prev_revenue != null && N(r.prev_revenue) < r.revenue_target && r.mtd_revenue >= r.revenue_target);
  if (crossed.length) pts.push({ kind: 'praise', text: `Crossed 100% of target today: ${crossed.slice(0, 6).map((r) => `${r.location} ${r.client}`).join(', ')}.` });
  locations.slice(0, 3).filter((l) => l.gap > 0).forEach((l) => pts.push({ kind: 'concern', text: `${l.key}${l.owner ? ` (${l.owner})` : ''} is ${cr(l.gap)} behind pro-rata at ${pc(l.ach)}; ${left > 0 ? `needs ${cr(l.needPerDay)} per day` : `short by ${cr(l.target - l.revenue)} at month end`}.` }));
  const zero = group((r) => r.zone === r.location ? r.location : `${r.zone} · ${r.location}`).filter((l) => l.target > 0 && l.added <= 0);
  if (zero.length) pts.push({ kind: 'zero', text: `No additions today at ${zero.length} location(s) with a target: ${zero.slice(0, 8).map((z) => z.key).join(', ')}${zero.length > 8 ? '…' : ''}.` });
  const mism = rows.filter((r) => r.count_mismatch);
  if (mism.length) pts.push({ kind: 'reporting', text: `Daily-count column differs from the MTD change at ${mism.length} row(s) (e.g. ${mism.slice(0, 3).map((r) => `${r.location} ${r.client}`).join(', ')}) — check the tracker entries.` });

  const dd = new Date(d.as_of + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  const subject = `Revenue Status ${dd} | MTD ${cr(pan.revenue)} · ${pc(ach)} of target | ${verdict}${left > 0 && ach < 1 ? ` · need ${cr(required)}/day` : ''}`;
  return { rows, pan, avg, projected, required, stepUp, elapsed, left, wdDone, wdTotal, phase, verdict, tone, stakeholders, regions, zones, locations, clients, focus, pts, subject, dd };
}
export type Status = ReturnType<typeof compute>;

export function emailText(s: Status, asOf: string) {
  const L = [s.subject, '', `Working day ${s.wdDone} of ${s.wdTotal} (${s.phase === 'final' ? 'final stretch' : s.phase + ' phase'}) · as on ${asOf}`, '',
    `MTD revenue ${cr(s.pan.revenue)} of ${cr(s.pan.target)} (${pc(s.pan.ach)}) · added ${cr(s.pan.added)} · projected close ${cr(s.projected)} · needed per working day ${s.left > 0 ? cr(s.required) : '— (month complete)'}`, '',
    'Key points', ...s.pts.map((p) => `• ${p.text}`), '', 'Stakeholder scorecard',
    ...s.stakeholders.map((x) => `• ${x.key}: ${cr(x.revenue)} of ${cr(x.target)} (${pc(x.ach)}, ${x.vsPace == null ? '—' : pp(x.vsPace)} vs pace) · added ${cr(x.added)}${s.left > 0 ? ` · need ${cr(x.needPerDay)}/day` : ''} · ${x.status}`),
    '', 'Close-out focus (largest gaps to pro-rata)', ...s.focus.slice(0, 8).map((x) => `• ${x.key}${x.owner ? ` (${x.owner})` : ''}: gap ${cr(x.gap)}${s.left > 0 ? `, need ${cr(x.needPerDay)}/day` : ''}`),
    '', 'Source: figures entered in CRUX IOPP. Revenue = cases × rate; it is not billing or collections.'];
  return L.join('\n');
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export function emailHtml(s: Status, asOf: string) {
  const band = { ok: '#1f7a4d', warn: '#a86400', bad: '#b42318' }[s.tone as 'ok' | 'warn' | 'bad'];
  const kpi = (l: string, v: string) => `<td style="padding:10px 14px;border:1px solid #e3e3e3"><div style="font-size:12px;color:#666">${l}</div><div style="font-size:18px;font-weight:700">${v}</div></td>`;
  const st = (x: string) => ({ Achieved: '#1f7a4d', 'On track': '#1f7a4d', Watch: '#a86400', Behind: '#b42318' } as Record<string, string>)[x] ?? '#555';
  const th = (t: string, r = false) => `<th style="text-align:${r ? 'right' : 'left'};padding:6px 8px;border-bottom:2px solid #ccc;font-size:12px">${t}</th>`;
  const td = (t: string, r = false) => `<td style="text-align:${r ? 'right' : 'left'};padding:6px 8px;border-bottom:1px solid #eee;font-size:13px">${t}</td>`;
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:760px">
<div style="background:${band};color:#fff;padding:12px 16px;border-radius:6px 6px 0 0"><b style="font-size:18px">${esc(s.verdict)}</b> · Revenue Status ${esc(s.dd)} · working day ${s.wdDone} of ${s.wdTotal}</div>
<table style="border-collapse:collapse;width:100%;margin-bottom:14px"><tr>${kpi('MTD revenue', `${cr(s.pan.revenue)} · ${pc(s.pan.ach)}`)}${kpi('Added today', cr(s.pan.added))}${kpi('Projected close', cr(s.projected))}${kpi('Needed per working day', s.left > 0 ? cr(s.required) : '—')}</tr></table>
<h3 style="margin:10px 0 6px">Key points</h3><ul>${s.pts.map((p) => `<li style="margin-bottom:4px">${esc(p.text)}</li>`).join('')}</ul>
<h3 style="margin:14px 0 6px">Stakeholder scorecard</h3><table style="border-collapse:collapse;width:100%">
<tr>${th('Stakeholder')}${th('Target', true)}${th('MTD', true)}${th('Achieved', true)}${th('vs pace', true)}${th('Added', true)}${th('Need/day', true)}${th('Status')}</tr>
${s.stakeholders.map((x) => `<tr>${td(esc(x.key))}${td(cr(x.target), true)}${td(cr(x.revenue), true)}${td(pc(x.ach), true)}${td(x.vsPace == null ? '—' : pp(x.vsPace), true)}${td(cr(x.added), true)}${td(cr(x.needPerDay), true)}${td(`<b style="color:${st(x.status)}">${x.status}</b>`)}</tr>`).join('')}</table>
<h3 style="margin:14px 0 6px">Regions</h3><table style="border-collapse:collapse;width:100%"><tr>${th('Region')}${th('Target', true)}${th('MTD', true)}${th('Achieved', true)}${th('Added', true)}${th('Status')}</tr>
${s.regions.map((x) => `<tr>${td(esc(x.key))}${td(cr(x.target), true)}${td(cr(x.revenue), true)}${td(pc(x.ach), true)}${td(cr(x.added), true)}${td(`<b style="color:${st(x.status)}">${x.status}</b>`)}</tr>`).join('')}</table>
<h3 style="margin:14px 0 6px">Close-out focus</h3><table style="border-collapse:collapse;width:100%"><tr>${th('Location · client')}${th('Owner')}${th('Gap to pro-rata', true)}${th('Need/day', true)}</tr>
${s.focus.slice(0, 10).map((x) => `<tr>${td(esc(x.key))}${td(esc(x.owner ?? '—'))}${td(cr(x.gap), true)}${td(cr(x.needPerDay), true)}</tr>`).join('')}</table>
<p style="font-size:11px;color:#777;margin-top:14px">As on ${esc(asOf)}. Source: figures entered in CRUX IOPP. Revenue = cases × rate (not billing or collections).</p></div>`;
}
