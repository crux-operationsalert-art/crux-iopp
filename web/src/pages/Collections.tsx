import { useState } from 'react';
import { has, Me, rpc } from '../lib/api';
import { label, money, monthStart, nice, num } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, Pill, useLoad } from '../components/ui';

export default function Collections({ me }: { me: Me }) {
  const leader = has(me, 'collections_head', 'ops_head', 'admin', 'auditor', 'leadership', 'zm', 'bm', 'ba') || me.manages_collections || !!me.heads_locations;
  const [tab, setTab] = useState<'board' | 'overview'>('board');
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Collections</h1><div className="muted">Location heads enter bills raised, received, reconciled, follow-ups, promises and outstanding for each client every day in My day, next to their operations figures.</div></div>
        {leader && <div className="chips">{(['board', 'overview'] as const).map((t) => <button key={t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t === 'board' ? 'By location & client' : 'Totals by group'}</button>)}</div>}
      </div>
      {tab === 'board' || !leader ? <Board me={me} /> : <Overview me={me} />}
    </div>
  );
}

/** Daily collections reported by location heads: billed, received, reconciled, follow-ups, promises and outstanding by age. */
function Board({ me }: { me: Me }) {
  const [from, setFrom] = useState(monthStart(me.today));
  const [to, setTo] = useState(me.today);
  const r = useLoad(() => rpc<any>('collections_board', { p_from: from, p_to: to }), [from, to]);
  const mgr = me.manages_operations || me.manages_collections || has(me, 'admin', 'ops_head', 'collections_head', 'zm', 'bm', 'ba', 'auditor', 'leadership');
  const rows: any[] = r.data?.rows ?? [];
  const s = rows.reduce((a, x) => ({ cs: a.cs + +(x.cases ?? 0), ba: a.ba + +x.bill_amount, rc: a.rc + +x.received, rn: a.rn + +x.reconciled, fu: a.fu + +x.followups, pa: a.pa + +x.promised,
    o1: a.o1 + +(x.out_0_30 ?? 0), o2: a.o2 + +(x.out_31_60 ?? 0), o3: a.o3 + +(x.out_61_90 ?? 0), o4: a.o4 + +(x.out_90p ?? 0) }), { cs: 0, ba: 0, rc: 0, rn: 0, fu: 0, pa: 0, o1: 0, o2: 0, o3: 0, o4: 0 });
  const out = s.o1 + s.o2 + s.o3 + s.o4;
  async function excel() {
    const { utils, writeFile } = await import('xlsx');
    const ws = utils.json_to_sheet(rows.map((x) => ({ Zone: x.zone, Location: x.location, Client: x.client, 'Reported by': x.head, 'Days reported': x.days, 'Bills raised': x.bill_count,
      'Billed ₹': +x.bill_amount, ...(mgr ? { 'Cases actioned': +x.cases, 'Billed per case ₹': +x.cases > 0 ? Math.round(+x.bill_amount / +x.cases) : null } : {}), 'Received ₹': +x.received, 'Reconciled ₹': +x.reconciled, 'Follow-ups': x.followups, 'Promised ₹': +x.promised,
      'Outstanding 0-30 ₹': x.out_0_30, '31-60 ₹': x.out_31_60, '61-90 ₹': x.out_61_90, '90+ ₹': x.out_90p, 'Outstanding as on': x.as_of })));
    const wb = utils.book_new(); utils.book_append_sheet(wb, ws, 'Collections'); writeFile(wb, `Collections_${from}_${to}.xlsx`);
  }
  return (
    <>
      <div className="row">
        <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} max={me.today} onChange={(e) => setTo(e.target.value)} /></label>
        <span className="spacer" /><button className="btn" onClick={excel} disabled={!rows.length}>Download Excel</button>
      </div>
      {r.loading ? <Loading /> : <ErrorBox error={r.error} retry={r.reload} />}
      {r.data && <>
        <div className="grid kpis">
          <Kpi label="Billed" value={money(s.ba)} sub={mgr && s.cs ? `${money(s.ba / s.cs)} per case · ${num(s.cs)} cases` : `${nice(from)} – ${nice(to)}`} />
          <Kpi label="Received" value={money(s.rc)} sub={s.ba ? `${((s.rc / s.ba) * 100).toFixed(1)}% of billed` : undefined} />
          <Kpi label="Received, not matched to bills" value={money(s.rc - s.rn)} sub={`Reconciled ${money(s.rn)}`} />
          <Kpi label="Outstanding now" value={money(out)} sub={`Over 90 days ${money(s.o4)} · 61–90 ${money(s.o3)}`} />
          <Kpi label="Promised" value={money(s.pa)} sub={`${num(s.fu)} follow-ups`} />
        </div>
        {(r.data.missing ?? []).length > 0 && <div className="banner warn">Not reported: {(r.data.missing as any[]).slice(0, 8).map((m) => `${m.person} (${nice(m.date)})`).join(', ')}{r.data.missing.length > 8 ? ` and ${r.data.missing.length - 8} more` : ''}.</div>}
        <Card title="By location and client">
          {rows.length === 0 ? <Empty>No collections reported in this period within your scope yet.</Empty> : <div className="tablewrap"><table>
            <thead><tr><th>Location · client</th><th>Reported by</th><th className="num">Billed</th>{mgr && <th className="num" title="Bills raised ÷ cases actioned (incoming − cancelled) in the period">Billed per case</th>}<th className="num">Received</th><th className="num">Reconciled</th><th className="num">Follow-ups</th>
              <th className="num">Promised</th><th className="num">0–30</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">90+</th></tr></thead>
            <tbody>{rows.map((x) => <tr key={x.location + x.client}><td><b>{x.client}</b> <span className="muted">· {x.location}</span></td><td className="small">{x.head ?? '—'}</td>
              <td className="num">{money(x.bill_amount)}</td>{mgr && <td className="num">{+x.cases > 0 ? money(+x.bill_amount / +x.cases) : '—'}<div className="small muted">{num(x.cases)} cases</div></td>}<td className="num">{money(x.received)}</td><td className="num">{money(x.reconciled)}</td><td className="num">{num(x.followups)}</td>
              <td className="num">{money(x.promised)}</td><td className="num">{money(x.out_0_30)}</td><td className="num">{money(x.out_31_60)}</td><td className="num">{money(x.out_61_90)}</td>
              <td className="num">{+(x.out_90p ?? 0) > 0 ? <b>{money(x.out_90p)}</b> : money(x.out_90p)}</td></tr>)}</tbody></table></div>}
        </Card>
        <Card title="Promises due (from the start of the period to two weeks ahead)">
          {(r.data.promises_due ?? []).length === 0 ? <Empty>No promised payments in this window.</Empty> : <table><tbody>{(r.data.promises_due as any[]).map((p, i) =>
            <tr key={i}><td>{nice(p.date)}</td><td><b>{p.client}</b> · {p.location}</td><td className="num">{money(p.amount)}</td><td className="small muted">{p.by}, noted {nice(p.entered)}</td>
              <td>{p.date < me.today ? <Pill status="overdue" /> : null}</td></tr>)}</tbody></table>}
        </Card>
      </>}
    </>
  );
}

function Overview({ me }: { me: Me }) {
  const [from, setFrom] = useState(monthStart(me.today));
  const [to, setTo] = useState(me.today);
  const [group, setGroup] = useState('zone');
  const r = useLoad(() => rpc<any[]>('collections_summary', { p_from: from, p_to: to, p_group: group }), [from, to, group]);
  const t = (r.data ?? []).reduce((a, x) => ({ rec: a.rec + Number(x.received), rc: a.rc + Number(x.reconciled), bc: a.bc + Number(x.bill_count), ba: a.ba + Number(x.bill_amount) }), { rec: 0, rc: 0, bc: 0, ba: 0 });
  const out = t.ba - t.rec;
  return (
    <>
      <div className="row">
        <label className="field">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field">To<input type="date" value={to} max={me.today} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="chips" style={{ alignSelf: 'end' }}>{['zone', 'branch', 'client', 'person', 'date'].map((g) => <button key={g} className={`chip ${group === g ? 'on' : ''}`} onClick={() => setGroup(g)}>By {g}</button>)}</div>
      </div>
      <div className="grid kpis">
        <Kpi label="Bills raised" value={money(t.ba)} sub={`${num(t.bc)} bills`} />
        <Kpi label="Collected" value={money(t.rec)} sub={t.ba ? `${((t.rec / t.ba) * 100).toFixed(1)}% of billed` : undefined} />
        <Kpi label="Outstanding (billed − collected)" value={money(out)} sub="For bills and collections in this period" />
        <Kpi label="Collected, not yet reconciled" value={money(t.rec - t.rc)} sub={`Reconciled ${money(t.rc)}`} />
      </div>
      <Card>
        {r.loading ? <Loading /> : <ErrorBox error={r.error} retry={r.reload} />}
        {r.data && (r.data.length === 0 ? <Empty>No collections or bills in this period within your scope.</Empty> :
          <div className="tablewrap"><table>
            <thead><tr><th>{label(group)}</th><th className="num">Bills</th><th className="num">Billed</th><th className="num">Collected</th><th className="num">Outstanding</th><th className="num">Unreconciled</th></tr></thead>
            <tbody>{r.data.map((x) => <tr key={x.key}><td>{group === 'date' ? nice(x.key) : x.label || '(not set)'}</td><td className="num">{num(x.bill_count)}</td><td className="num">{money(x.bill_amount)}</td>
              <td className="num">{money(x.received)}</td><td className="num">{Number(x.outstanding) > 0 ? <b>{money(x.outstanding)}</b> : money(x.outstanding)}</td>
              <td className="num">{money(x.unreconciled)}</td></tr>)}</tbody>
          </table></div>)}
      </Card>
    </>
  );
}
