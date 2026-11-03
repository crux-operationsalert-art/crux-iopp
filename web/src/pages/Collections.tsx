import { FormEvent, useState } from 'react';
import { has, Me, rpc, select } from '../lib/api';
import { label, money, monthStart, nice, num } from '../lib/format';
import { Card, Empty, ErrorBox, Kpi, Loading, Pill, useLoad } from '../components/ui';

export default function Collections({ me }: { me: Me }) {
  const leader = has(me, 'collections_head', 'ops_head', 'admin', 'auditor', 'zm', 'bm', 'ba') || me.manages_collections || !!me.heads_locations;
  const [tab, setTab] = useState<'mine' | 'overview'>(leader ? 'overview' : 'mine');
  return (
    <div className="stack">
      <div className="topbar"><div><h1>Collections & bills</h1><div className="muted">Location heads enter bills raised and money collected every day in My day; this page shows totals and outstanding for your scope. Separate from case revenue (targets only).</div></div>
        {leader && <div className="chips">{(['overview', 'mine'] as const).map((t) => <button key={t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t === 'mine' ? 'My entries' : 'Overview'}</button>)}</div>}
      </div>
      {tab === 'overview' ? <Overview me={me} /> : <Mine me={me} />}
    </div>
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

function Mine({ me }: { me: Me }) {
  const [date, setDate] = useState(me.today);
  const clients = useLoad(() => select('clients', 'id,name', (b) => b.eq('active', true).order('name')), []);
  const list = useLoad(() => select('collection_entries', '*,clients(name)', (b) => b.eq('person_id', me.person_id).order('collection_date', { ascending: false }).limit(30)), []);
  const bills = useLoad(() => select('bill_entries', '*,clients(name)', (b) => b.eq('person_id', me.person_id).order('bill_date', { ascending: false }).limit(20)), []);
  const ds = useLoad(() => select('day_status', '*', (b) => b.eq('person_id', me.person_id).eq('work_date', date).eq('function', 'collections')), [date]);
  const [f, setF] = useState({ client: '', received: '', reconciled: '', reference: '', remarks: '' });
  const [b, setB] = useState({ client: '', count: '', amount: '', reference: '' });
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function addCollection(e: FormEvent) {
    e.preventDefault(); setErr(null); setOk(null);
    try {
      await rpc('save_collection', { p_collection_date: date, p_client_id: f.client, p_amount_received: Number(f.received),
        p_amount_reconciled: Number(f.reconciled || 0), p_reference: f.reference || null, p_remarks: f.remarks || null });
      setF({ client: '', received: '', reconciled: '', reference: '', remarks: '' }); setOk('Collection saved.'); list.reload();
    } catch (x) { setErr(x); }
  }
  async function addBill(e: FormEvent) {
    e.preventDefault(); setErr(null); setOk(null);
    try {
      await rpc('save_bill', { p_bill_date: date, p_client_id: b.client, p_bill_count: Number(b.count), p_bill_amount: Number(b.amount), p_reference: b.reference || null });
      setB({ client: '', count: '', amount: '', reference: '' }); setOk('Bill saved.'); bills.reload();
    } catch (x) { setErr(x); }
  }
  async function reconcile(id: string, current: number) {
    const v = window.prompt('Total amount reconciled so far (₹)', String(current));
    if (v === null) return;
    try { await rpc('save_collection', { p_collection_date: date, p_client_id: null, p_amount_received: null, p_id: id, p_amount_reconciled: Number(v) }); list.reload(); }
    catch (x) { setErr(x); }
  }
  async function submitDay() {
    setErr(null);
    try { await rpc('submit_collections_day', { p_work_date: date }); setOk('Collections day submitted.'); ds.reload(); } catch (x) { setErr(x); }
  }
  const opts = <>{<option value="">Choose client…</option>}{(clients.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</>;
  const submitted = ds.data?.[0] && ds.data[0].status !== 'draft';

  return (
    <>
      <div className="row"><label className="field">Date<input type="date" value={date} max={me.today} onChange={(e) => setDate(e.target.value)} /></label>
        <span className="spacer" />{submitted ? <Pill status={ds.data![0].status} /> : <button className="btn primary" onClick={submitDay}>Submit collections for {nice(date)}</button>}</div>
      <ErrorBox error={err} />{ok && <div className="banner ok" role="status">{ok}</div>}
      <div className="grid two">
        <Card title="Record a collection">
          <form className="stack" onSubmit={addCollection}>
            <label className="field">Client<select required value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })}>{opts}</select></label>
            <div className="grid two">
              <label className="field">Amount received (₹)<input required type="number" inputMode="decimal" min={0} step="0.01" value={f.received} onChange={(e) => setF({ ...f, received: e.target.value })} /></label>
              <label className="field">Amount reconciled (₹)<input type="number" inputMode="decimal" min={0} step="0.01" value={f.reconciled} onChange={(e) => setF({ ...f, reconciled: e.target.value })} /></label>
            </div>
            <label className="field">Receipt / reference<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
            <label className="field">Remarks<input value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
            <button className="btn primary">Save collection</button>
          </form>
        </Card>
        <Card title="Record bills raised">
          <form className="stack" onSubmit={addBill}>
            <label className="field">Client<select required value={b.client} onChange={(e) => setB({ ...b, client: e.target.value })}>{opts}</select></label>
            <div className="grid two">
              <label className="field">Number of bills<input required type="number" inputMode="numeric" min={0} step={1} value={b.count} onChange={(e) => setB({ ...b, count: e.target.value })} /></label>
              <label className="field">Total bill amount (₹)<input required type="number" inputMode="decimal" min={0} step="0.01" value={b.amount} onChange={(e) => setB({ ...b, amount: e.target.value })} /></label>
            </div>
            <label className="field">Bill / invoice reference<input value={b.reference} onChange={(e) => setB({ ...b, reference: e.target.value })} /></label>
            <button className="btn primary">Save bills</button>
          </form>
        </Card>
      </div>
      <Card title="My recent collections">
        {list.loading ? <Loading /> : <ErrorBox error={list.error} />}
        {list.data && (list.data.length === 0 ? <Empty>No collections recorded yet.</Empty> : <div className="tablewrap"><table>
          <thead><tr><th>Date</th><th>Client</th><th className="num">Received</th><th className="num">Reconciled</th><th className="num">Unreconciled</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.data.map((c: any) => <tr key={c.id}><td>{nice(c.collection_date)}</td><td>{c.clients?.name}</td><td className="num">{money(c.amount_received)}</td>
            <td className="num">{money(c.amount_reconciled)}</td><td className="num">{money(c.amount_received - c.amount_reconciled)}</td><td><Pill status={c.recon_status} /></td>
            <td><button className="btn sm" onClick={() => reconcile(c.id, c.amount_reconciled)}>Update reconciliation</button></td></tr>)}</tbody></table></div>)}
      </Card>
      <Card title="My recent bills">
        {bills.data && (bills.data.length === 0 ? <Empty>No bills recorded yet.</Empty> : <table><tbody>{bills.data.map((x: any) =>
          <tr key={x.id}><td>{nice(x.bill_date)}</td><td>{x.clients?.name}</td><td className="num">{num(x.bill_count)} bills</td><td className="num">{money(x.bill_amount)}</td><td>{x.reference}</td></tr>)}</tbody></table>)}
      </Card>
    </>
  );
}
