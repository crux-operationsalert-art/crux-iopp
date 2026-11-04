import { useState } from 'react';
import { Me, rpc } from '../lib/api';
import { money, num } from '../lib/format';
import { Chart, C } from '../components/Charts';
import { Card, Empty, ErrorBox, Kpi, Loading, Tabs, useLoad } from '../components/ui';
import { Modal } from './Tasks';

type Loc = { branch_id: string; client_id: string; location: string; client: string; zone: string | null; head: string | null;
  t: number | null; rt: number | null; colt: number | null; cases: number | null; rev: number | null; rcv: number | null; rec: number | null; ba: number | null };
type PD = { month: string; as_of: string; wd_done: number; wd_total: number; products: { product: string; client: string }[];
  by_location: Loc[]; by_person: { person: string; person_id: string; client: string; location: string; cases: number; revenue: number; entry: number; closure: number; cancelled: number }[];
  trend: { month: string; cases: number; revenue: number }[]; daily: { d: string; cases: number; revenue: number }[] };

const n = (v: unknown) => Number(v ?? 0) || 0;
const pc = (a: number, t: number) => (t ? `${Math.round((a / t) * 100)}%` : '—');
const mon = (m: string) => new Date(m + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

/** Product Head view: the whole product (every location and person, any team), revenue-first, with corrections. */
export function ProductView({ me }: { me: Me }) {
  const [month, setMonth] = useState(me.today.slice(0, 7) + '-01');
  const [product, setProduct] = useState('');
  const d = useLoad(() => rpc<PD>('product_dashboard', { p_month: month, p_product: product || null }), [month, product]);
  const [fix, setFix] = useState(false);
  const x = d.data;
  const names = [...new Set((x?.products ?? []).map((p) => p.product))];
  const L = x?.by_location ?? [];
  const tot = L.reduce((a, r) => ({ rev: a.rev + n(r.rev), rt: a.rt + n(r.rt), cases: a.cases + n(r.cases), t: a.t + n(r.t), rcv: a.rcv + n(r.rcv), colt: a.colt + n(r.colt), rec: a.rec + n(r.rec) }),
    { rev: 0, rt: 0, cases: 0, t: 0, rcv: 0, colt: 0, rec: 0 });
  const proRata = x && x.wd_total ? x.wd_done / x.wd_total : 0;
  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'end' }}>
        {names.length > 1 && <label className="field">Product<select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">All my products</option>{names.map((p) => <option key={p}>{p}</option>)}</select></label>}
        <label className="field">Month<input type="month" value={month.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value + '-01')} /></label>
        <span className="spacer" /><button className="btn" onClick={() => setFix(true)}>Correct figures</button>
      </div>
      {d.loading ? <Loading rows={4} /> : <ErrorBox error={d.error} retry={d.reload} />}
      {x && <>
        <div className="small muted">{(x.products ?? []).map((p) => `${p.product}: ${p.client}`).join(' · ')} · working day {x.wd_done} of {x.wd_total}</div>
        <div className="grid kpis">
          <Kpi label="Revenue MTD" value={money(tot.rev)} sub={tot.rt ? `${pc(tot.rev, tot.rt)} of ${money(tot.rt)} target (pro-rata ${pc(tot.rt * proRata, tot.rt)})` : 'No target set'} />
          <Kpi label="Cases MTD (entered − cancelled)" value={num(tot.cases)} sub={tot.t ? `${pc(tot.cases, tot.t)} of ${num(tot.t)}` : ''} />
          <Kpi label="Collected MTD" value={money(tot.rcv)} sub={tot.colt ? `${pc(tot.rcv, tot.colt)} of ${money(tot.colt)} target` : 'No target set'} />
          <Kpi label="Reconciled MTD" value={money(tot.rec)} sub={tot.rcv ? `${pc(tot.rec, tot.rcv)} of collected` : ''} />
        </div>
        {x.trend.length > 0 && <Card title="Revenue by month (last 12)"><Chart labels={x.trend.map((t) => mon(t.month))} series={[{ name: 'Revenue', values: x.trend.map((t) => n(t.revenue)), color: C.navy, bars: true }]} /></Card>}
        <Card title="By location">
          {L.length === 0 ? <Empty>No locations for this product yet.</Empty> :
            <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Client</th><th>Location</th><th>Head</th><th className="num">Revenue</th><th className="num">Target</th><th className="num">%</th><th className="num">Cases</th><th className="num">Collected</th><th className="num">Coll. target</th></tr></thead>
              <tbody>{L.map((r) => <tr key={r.branch_id + r.client_id}><td>{r.client}</td><td>{r.location}<div className="small muted">{r.zone ?? ''}</div></td><td>{r.head ?? '—'}</td>
                <td className="num">{money(r.rev)}</td><td className="num">{money(r.rt)}</td><td className="num">{pc(n(r.rev), n(r.rt))}</td><td className="num">{num(r.cases)}</td><td className="num">{money(r.rcv)}</td><td className="num">{money(r.colt)}</td></tr>)}
                <tr><th colSpan={3}>Total</th><th className="num">{money(tot.rev)}</th><th className="num">{money(tot.rt)}</th><th className="num">{pc(tot.rev, tot.rt)}</th><th className="num">{num(tot.cases)}</th><th className="num">{money(tot.rcv)}</th><th className="num">{money(tot.colt)}</th></tr></tbody></table></div>}
        </Card>
        <Card title="By person (any team)">
          {x.by_person.length === 0 ? <Empty>No figures yet this month.</Empty> :
            <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Client · location</th><th className="num">Revenue</th><th className="num">Entered</th><th className="num">Closed</th><th className="num">Cancelled</th></tr></thead>
              <tbody>{x.by_person.map((r, i) => <tr key={i}><td>{r.person}</td><td>{r.client} · {r.location}</td><td className="num">{money(r.revenue)}</td><td className="num">{num(r.entry)}</td><td className="num">{num(r.closure)}</td><td className="num">{num(r.cancelled)}</td></tr>)}</tbody></table></div>}
        </Card>
      </>}
      {fix && <Modal title="Correct figures for my products" onClose={() => { setFix(false); d.reload(); }}><ProductFix me={me} /></Modal>}
    </div>
  );
}

type Line = { person_id: string; person: string; client_location_id: string; client: string; location: string; entry: number; closure: number; cancelled: number; source: string; reason: string | null };
/** Change one person's figures for a day. The person and their manager are told; the change is in the activity log. */
function ProductFix({ me }: { me: Me }) {
  const [date, setDate] = useState(me.today);
  const d = useLoad(() => rpc<Line[]>('product_lines', { p_date: date }), [date]);
  const [ed, setEd] = useState<{ l: Line; e: string; c: string; x: string; note: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState('');
  return (
    <div className="stack">
      <label className="field">Date<input type="date" max={me.today} value={date} onChange={(e) => { setDate(e.target.value); setEd(null); }} /></label>
      {d.loading ? <Loading rows={2} /> : <ErrorBox error={d.error} />}
      {d.data && (d.data.length === 0 ? <Empty>No figures entered for your products on this date.</Empty> :
        <div className="tablewrap" tabIndex={0}><table><thead><tr><th>Person</th><th>Client · location</th><th className="num">E</th><th className="num">C</th><th className="num">X</th><th /></tr></thead>
          <tbody>{d.data.map((l) => <tr key={l.person_id + l.client_location_id}><td>{l.person}</td><td>{l.client} · {l.location}</td><td className="num">{l.entry}</td><td className="num">{l.closure}</td><td className="num">{l.cancelled}</td>
            <td><button className="btn sm" onClick={() => setEd({ l, e: String(l.entry), c: String(l.closure), x: String(l.cancelled), note: '' })}>Change</button></td></tr>)}</tbody></table></div>)}
      {ed && <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
        <b className="small">{ed.l.person} · {ed.l.client} · {ed.l.location}</b>
        <div className="row">
          <label className="field">Entered<input type="number" min={0} value={ed.e} onChange={(e) => setEd({ ...ed, e: e.target.value })} /></label>
          <label className="field">Closed<input type="number" min={0} value={ed.c} onChange={(e) => setEd({ ...ed, c: e.target.value })} /></label>
          <label className="field">Cancelled<input type="number" min={0} value={ed.x} onChange={(e) => setEd({ ...ed, x: e.target.value })} /></label></div>
        <label className="field">Reason (they are told)<input value={ed.note} onChange={(e) => setEd({ ...ed, note: e.target.value })} /></label>
        <button className="btn primary" disabled={!ed.note.trim()} onClick={async () => {
          setErr(null); setOk('');
          try { await rpc('correct_team_line', { p_person: ed.l.person_id, p_date: date, p_client_location: ed.l.client_location_id, p_entry: Number(ed.e || 0), p_closure: Number(ed.c || 0),
            p_cancelled: Number(ed.x || 0), p_note: ed.note.trim(), p_remove: false }); setOk(`Changed. ${ed.l.person} has been notified.`); setEd(null); d.reload(); }
          catch (e) { setErr(e); }
        }}>Save change</button></div>}
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
    </div>
  );
}

/** Home toggle for Product Heads: their own team's performance or the whole product. */
export function PerfOrProduct({ me, team }: { me: Me; team: React.ReactNode }) {
  const [v, setV] = useState<'team' | 'product'>('team');
  if (!me.products?.length) return <>{team}</>;
  return (
    <div className="stack">
      <Tabs tabs={[['team', 'My team'], ['product', `My products (${me.products.join(', ')})`]]} value={v} onChange={setV} />
      {v === 'team' ? team : <ProductView me={me} />}
    </div>
  );
}
