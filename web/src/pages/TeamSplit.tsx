import { Me, rpc } from '../lib/api';
import { money, num } from '../lib/format';
import { Bar, C } from '../components/Charts';
import { Card, ErrorBox, Kpi, Loading, Progress, useLoad } from '../components/ui';

type Ops = { received: number; logged: number; logged_known: boolean; closed: number; cancelled: number; billable: number; pending: number;
  buckets: Record<string, number>; avg_age: number | null; median_bucket: string | null };
type Mon = { bills: number; billed: number; received: number; reconciled: number; received_by_age: Record<string, number> };
type B = { month: string; as_of: string; hours_per_day: number; scope: Ops & { money: Mon };
  receivables: { start: number; pairs: number; pairs_with_receivables: number; billed: number; received: number; outstanding: number };
  people: { person_id: string; self: boolean; ops: Ops; money: Mon; headcount: number }[];
  hr: { headcount: number; own: number; partner: number; by_designation: { designation: string; n: number }[]; by_location: { location: string; type: string; n: number }[];
    locations_own: number; locations_partner: number; man_days: number; man_hours: number; revenue: number; revenue_per_head: number | null; revenue_per_man_hour: number | null } };
type TeamRow = { person_id: string; person: string; self: boolean; revenue_target: number | null; revenue: number; collection_target: number | null; collection: number };

const n = (v: unknown) => Number(v ?? 0) || 0;
const pc = (a: number, t: number | null | undefined) => (t ? `${Math.round((a / Number(t)) * 100)}%` : '—');
const AGE = ['0-1', '1-2', '2-4', '4-7', '7-15', '15+'];
const AGE_L: Record<string, string> = { '0-1': '0–1 d', '1-2': '1–2 d', '2-4': '2–4 d', '4-7': '4–7 d', '7-15': '7–15 d', '15+': '15+ d' };

/** The split behind "Me and my team": what was received, completed, cancelled and is pending (with its age), the collections
 *  flow, and the people behind it — all the sum of what is entered daily. Each person row = that person and everyone under them. */
export function TeamSplit({ month, team }: { me: Me; month: string; team: { wd_done: number; wd_total: number; people: TeamRow[] } }) {
  const d = useLoad(() => rpc<B>('team_breakdown', { p_month: month }), [month]);
  if (d.loading) return <Loading rows={3} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const b = d.data!;
  const s = b.scope, m = s.money, r = b.receivables;
  const me = team.people.find((p) => p.self);
  const pace = team.wd_total ? team.wd_done / team.wd_total : 0;
  const maxB = Math.max(1, ...AGE.map((k) => n(s.buckets[k])));
  const name = (id: string) => team.people.find((p) => p.person_id === id)?.person ?? '—';
  return (
    <div className="stack">
      <div className="grid two">
        <Card title="Revenue — what makes it up">
          <div className="row" style={{ alignItems: 'baseline' }}><b style={{ fontSize: '1.4rem' }}>{money(me?.revenue)}</b>
            <span className="muted">{me?.revenue_target ? `of ${money(me.revenue_target)} · ${pc(n(me.revenue), me.revenue_target)} achieved (pace ${Math.round(pace * 100)}%)` : 'no revenue target set'}</span></div>
          {me?.revenue_target ? <Progress value={(n(me.revenue) / n(me.revenue_target)) * 100} /> : null}
          <div className="split">
            <div><span>Received</span><b>{num(s.received)}</b></div>
            <div><span title="Logged in the client portal">Entry</span><b>{s.logged_known || n(s.logged) ? num(s.logged) : '—'}</b></div>
            <div><span>Completed</span><b>{num(s.closed)}</b></div>
            <div><span>Cancelled</span><b>{num(s.cancelled)}</b></div>
            <div><span>Pending now</span><b>{num(s.pending)}</b></div>
          </div>
          <div className="small muted">Billable = received − cancelled = <b>{num(s.billable)}</b> cases (revenue basis).</div>
          <div className="small" style={{ marginTop: 10 }}><b>Pending by age</b>{s.pending ? <> · average <b>{s.avg_age} days</b> · median in the <b>{AGE_L[s.median_bucket ?? ''] ?? '—'}</b> bucket</> : ' · nothing pending'}</div>
          <table className="small" style={{ marginTop: 4 }}><tbody>{AGE.map((k) => <tr key={k}><td style={{ width: 70 }}>{AGE_L[k]}</td>
            <td><Bar value={n(s.buckets[k])} max={maxB} color={k === '7-15' || k === '15+' ? C.red : k === '4-7' ? C.amber : C.navy} /></td>
            <td className="num" style={{ width: 60 }}>{num(s.buckets[k])}</td><td className="num muted" style={{ width: 50 }}>{s.pending ? `${Math.round((n(s.buckets[k]) / s.pending) * 100)}%` : ''}</td></tr>)}</tbody></table>
          <p className="small muted">Age comes from the buckets entered daily; the average counts each bucket at its middle (15+ as 20 days).</p>
        </Card>
        <Card title="Collections — what makes it up">
          <div className="row" style={{ alignItems: 'baseline' }}><b style={{ fontSize: '1.4rem' }}>{money(me?.collection)}</b>
            <span className="muted">{me?.collection_target ? `of ${money(me.collection_target)} · ${pc(n(me.collection), me.collection_target)} achieved` : 'no collection target set'}</span></div>
          {me?.collection_target ? <Progress value={(n(me.collection) / n(me.collection_target)) * 100} /> : null}
          <div className="split">
            <div><span>Receivables (start)</span><b>{money(r.start)}</b></div>
            <div><span>Bills raised</span><b>{money(m.billed)}</b><small>{num(m.bills)} bills</small></div>
            <div><span>Collected</span><b>{money(m.received)}</b></div>
            <div><span>Reconciled</span><b>{money(m.reconciled)}</b><small>{m.received ? pc(n(m.reconciled), m.received) : ''}</small></div>
            <div><span>Outstanding</span><b>{money(r.outstanding)}</b></div>
          </div>
          <div className="small muted">Outstanding = receivables + bills raised − collected, for the {num(r.pairs)} client · location(s) headed in this team{r.pairs_with_receivables < r.pairs ? ` (${r.pairs - r.pairs_with_receivables} without receivables entered this month)` : ''}.</div>
          <div className="small" style={{ marginTop: 10 }}><b>Collected by age</b></div>
          <table className="small" style={{ marginTop: 4 }}><tbody>{Object.entries(m.received_by_age).map(([k, v]) => <tr key={k}><td style={{ width: 84, whiteSpace: 'nowrap' }}>{k} d</td>
            <td><Bar value={n(v)} max={Math.max(1, ...Object.values(m.received_by_age).map(n))} color={C.green} /></td><td className="num" style={{ width: 90 }}>{money(v)}</td></tr>)}</tbody></table>
        </Card>
      </div>
      {b.people.length > 1 && <Card title="By person (each with their team)">
        <div className="tablewrap" tabIndex={0}><table>
          <thead><tr><th>Person</th><th className="num">People</th><th className="num">Received</th><th className="num">Completed</th><th className="num">Cancelled</th><th className="num">Pending</th>
            <th className="num">Avg age</th><th className="num">Bills raised</th><th className="num">Collected</th><th className="num">Reconciled</th></tr></thead>
          <tbody>{[...b.people].sort((x, y) => Number(y.self) - Number(x.self) || n(y.ops.received) - n(x.ops.received)).map((p) => <tr key={p.person_id} style={p.self ? { fontWeight: 700 } : undefined}>
            <td>{name(p.person_id)}{p.self ? ' (me + all)' : ''}</td><td className="num">{num(p.headcount)}</td>
            <td className="num">{num(p.ops.received)}</td><td className="num">{num(p.ops.closed)}</td><td className="num">{num(p.ops.cancelled)}</td><td className="num">{num(p.ops.pending)}</td>
            <td className="num">{p.ops.avg_age != null ? `${p.ops.avg_age} d` : '—'}</td><td className="num">{money(p.money.billed)}</td><td className="num">{money(p.money.received)}</td><td className="num">{money(p.money.reconciled)}</td></tr>)}</tbody></table></div>
      </Card>}
      <Card title="People behind the numbers">
        <div className="grid kpis">
          <Kpi label="People" value={num(b.hr.headcount)} sub={`${num(b.hr.own)} CRUX · ${num(b.hr.partner)} partner (BA)`} />
          <Kpi label="Locations worked" value={num(b.hr.locations_own + b.hr.locations_partner)} sub={`${num(b.hr.locations_own)} own branch · ${num(b.hr.locations_partner)} partner branch`} />
          <Kpi label="Revenue per head" value={money(b.hr.revenue_per_head)} sub={`${money(b.hr.revenue)} ÷ ${num(b.hr.headcount)} people, month to date`} />
          <Kpi label="Revenue per man-hour" value={money(b.hr.revenue_per_man_hour)} sub={`${num(b.hr.man_days)} man-days · ${num(b.hr.man_hours)} h at ${b.hours_per_day} h/day`} />
        </div>
        <div className="grid two" style={{ marginTop: 10 }}>
          <div><div className="small"><b>By designation</b></div>
            <table className="small"><tbody>{b.hr.by_designation.map((x) => <tr key={x.designation}><td>{x.designation}</td><td className="num">{num(x.n)}</td></tr>)}</tbody></table></div>
          <div><div className="small"><b>By location</b> <span className="muted">(a person working at two locations counts in both)</span></div>
            <table className="small"><tbody>{b.hr.by_location.slice(0, 15).map((x) => <tr key={x.location}><td>{x.location} <span className="muted">· {x.type === 'partner' ? 'partner' : 'own'}</span></td><td className="num">{num(x.n)}</td></tr>)}</tbody></table>
            {b.hr.by_location.length > 15 && <div className="small muted">+{b.hr.by_location.length - 15} more</div>}</div>
        </div>
        <p className="small muted">Man-days = days marked present (half days count half) plus days with figures submitted. Man-hours use the working hours in Settings.</p>
      </Card>
    </div>
  );
}
