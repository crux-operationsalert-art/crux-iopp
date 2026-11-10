import { HelpTip } from '../components/HelpTip';
import { useState } from 'react';
import { utils, writeFile } from 'xlsx';
import { Me, rpc, select } from '../lib/api';
import { nice } from '../lib/format';
import { Agg, compute, cr, emailHtml, emailText, pc, pp, StatusData } from '../lib/revstatus';
import { Card, CopyBox, Empty, ErrorBox, Kpi, Loading, Progress, Tabs, useLoad } from '../components/ui';

const tone = (s: string) => (s === 'Achieved' || s === 'On track' ? 'ok' : s === 'Watch' ? 'warn' : s === 'Behind' ? 'bad' : 'neutral');

function AggTable({ rows, label, owner, limit }: { rows: Agg[]; label: string; owner?: boolean; limit?: number }) {
  return (
    <div className="tablewrap" tabIndex={0}><table>
      <thead><tr><th>{label}</th>{owner && <th>Owner</th>}<th className="num">Target</th><th className="num">MTD</th><th className="num">Achieved</th><th className="num">vs pace</th>
        <th className="num">Added</th><th className="num">Need / day</th><th>Status</th></tr></thead>
      <tbody>{rows.slice(0, limit ?? rows.length).map((x) => (
        <tr key={x.key}><td><b>{x.key}</b><div className="small muted">{new Intl.NumberFormat('en-IN').format(x.cases)} of {new Intl.NumberFormat('en-IN').format(x.tcases)} cases</div></td>
          {owner && <td className="small">{x.owner ?? '—'}</td>}
          <td className="num">{cr(x.target)}</td><td className="num">{cr(x.revenue)}</td><td className="num"><b>{pc(x.ach)}</b></td>
          <td className="num">{x.vsPace == null ? '—' : pp(x.vsPace)}</td><td className="num">{cr(x.added)}</td><td className="num">{x.ach != null && x.ach < 1 ? cr(x.needPerDay) : '—'}</td>
          <td><span className={`pill ${tone(x.status)}`}>{x.status}</span></td></tr>))}</tbody>
    </table></div>
  );
}

export default function RevenueStatus({ me }: { me: Me }) {
  const [asOf, setAsOf] = useState<string>(me.today);
  const d = useLoad(() => rpc<StatusData>('zonal_tracker', { p_date: asOf }), [asOf]);
  const rec = useLoad(() => select('settings', 'key,value', (b) => b.eq('key', 'report_recipients')), []);
  const [tab, setTab] = useState<'stakeholders' | 'regions' | 'zones' | 'locations' | 'clients'>('stakeholders');
  if (d.loading) return <Loading rows={5} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  if (!d.data?.rows?.length) return <Card title="Revenue Status"><div className="stack"><input type="date" value={asOf} max={me.today} onChange={(e) => e.target.value && setAsOf(e.target.value)} aria-label="As-on date" style={{ maxWidth: 200 }} /><Empty>No targets or figures yet for your locations in {asOf.slice(0, 7)}. Figures come from My day submissions; targets from Admin → Monthly targets.</Empty></div></Card>;
  const s = compute(d.data);
  const recipients = String(rec.data?.[0]?.value ?? '').replace(/^"|"$/g, '').split(/[\s,;]+|\\n/).filter((x) => x.includes('@')).join(',');
  function excel() {
    const wb = utils.book_new();
    const sheet = (rows: Agg[], name: string) => utils.book_append_sheet(wb, utils.json_to_sheet(rows.map((x) => ({ [name]: x.key, Owner: x.owner ?? '', 'Target ₹': Math.round(x.target),
      'MTD ₹': Math.round(x.revenue), 'Achieved %': x.ach == null ? null : +(x.ach * 100).toFixed(1), 'vs pace pp': x.vsPace == null ? null : +(x.vsPace * 100).toFixed(1),
      'Added ₹': Math.round(x.added), 'Target cases': x.tcases, 'MTD cases': x.cases, 'Need per day ₹': Math.round(x.needPerDay), Status: x.status }))), name.slice(0, 30));
    sheet(s.stakeholders, 'Stakeholders'); sheet(s.regions, 'Regions'); sheet(s.zones, 'Zones'); sheet(s.locations, 'Locations'); sheet(s.clients, 'Clients'); sheet(s.focus, 'Close-out focus');
    writeFile(wb, `Revenue_Status_${d.data!.as_of}.xlsx`);
  }
  return (
    <div className="stack">
      <div className="topbar">
        <div><div className="h1row"><h1>Revenue Status</h1><HelpTip k="Revenue Status" /></div><div className="muted">As on {nice(d.data.as_of)} · working day {s.wdDone} of {s.wdTotal}{d.data.prev_as_of ? ` · added = change since ${nice(d.data.prev_as_of)}` : ''}</div></div>
        <div className="row">
          <input type="date" value={asOf} max={me.today} onChange={(e) => e.target.value && setAsOf(e.target.value)} aria-label="As-on date" />
          <button className="btn" onClick={excel}>Download Excel</button>
        </div>
      </div>
      <div className={`banner ${s.tone}`}><b style={{ fontSize: '1.1rem' }}>{s.verdict}</b> · {pc(s.pan.ach)} achieved vs {pc(s.elapsed)} of the month elapsed ({pp((s.pan.ach ?? 0) - s.elapsed)}) · {s.phase === 'final' ? 'final stretch' : `${s.phase} phase`}</div>
      <div className="grid kpis">
        <Kpi label="MTD revenue" value={cr(s.pan.revenue)} sub={`of ${cr(s.pan.target)} · ${pc(s.pan.ach)}`} />
        <Kpi label="Added today" value={cr(s.pan.added)} sub={`${new Intl.NumberFormat('en-IN').format(s.pan.added_cases)} cases · avg ${cr(s.avg)}/day`} />
        <Kpi label="Projected close" value={cr(s.projected)} sub={`${pc(s.pan.target ? s.projected / s.pan.target : null)} of target at current average`} />
        <Kpi label="Needed per working day" value={s.left > 0 && (s.pan.ach ?? 0) < 1 ? cr(s.required) : '—'} sub={s.stepUp ? `${s.stepUp.toFixed(2)}× current average · ${s.left} day(s) left` : ''} />
      </div>
      <Progress value={(s.pan.ach ?? 0) * 100} />
      <Card title="Key points">
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>{s.pts.map((p, i) => <li key={i}><span className={`pill ${p.kind === 'praise' ? 'ok' : p.kind === 'concern' || p.kind === 'zero' ? 'warn' : p.kind === 'reporting' ? 'info' : 'neutral'}`} style={{ marginRight: 6 }}>{p.kind}</span>{p.text}</li>)}</ul>
      </Card>
      <Tabs tabs={[['stakeholders', 'Stakeholder scorecard'], ['regions', 'Regions'], ['zones', 'Zones'], ['locations', 'Locations (by gap)'], ['clients', 'Clients']]} value={tab} onChange={setTab} />
      <Card>
        {tab === 'stakeholders' && <AggTable rows={s.stakeholders} label="Stakeholder" />}
        {tab === 'regions' && <AggTable rows={s.regions} label="Region" />}
        {tab === 'zones' && <AggTable rows={s.zones} label="Zone" owner />}
        {tab === 'locations' && <AggTable rows={s.locations} label="Location" owner />}
        {tab === 'clients' && <AggTable rows={s.clients} label="Client" />}
      </Card>
      <Card title="Close-out focus — largest gaps to pro-rata">
        {s.focus.length === 0 ? <Empty>Every location × client is at or above pro-rata.</Empty> : <AggTable rows={s.focus} label="Location · client" owner />}
      </Card>
      {me && <Card title="Email / WhatsApp">
        <div className="stack">
          <div className="small"><b>Subject:</b> {s.subject}</div>
          <CopyBox text={emailText(s, d.data.as_of)} html={emailHtml(s, d.data.as_of)} email={recipients} subject={s.subject} />
          <p className="small muted">“Copy formatted email” keeps the coloured verdict band and tables when pasted into Gmail or Outlook. Recipients come from Admin → Settings → report_recipients.</p>
        </div>
      </Card>}
    </div>
  );
}
