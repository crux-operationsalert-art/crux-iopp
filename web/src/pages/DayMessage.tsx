import { Me, rpc, select } from '../lib/api';
import { monthStart } from '../lib/format';
import { dailyMessage, DayLine } from '../lib/messages';
import { Card, CopyBox, ErrorBox, Loading, useLoad } from '../components/ui';

type Rep = DayLine & { client_location_id: string };
const merge = (a: Rep[], b: Rep[]) => {
  const m = new Map<string, Rep>();
  for (const r of [...a, ...b]) {
    const x = m.get(r.client_location_id);
    if (!x) { m.set(r.client_location_id, { ...r }); continue; }
    (['entry', 'closure', 'cancelled', 'mtd_entry', 'mtd_closure', 'mtd_cancelled'] as const).forEach((k) => { x[k] = Number(x[k]) + Number(r[k]); });
  }
  return [...m.values()];
};

/** Copy-paste daily summary (own, and team + own for managers) in the WhatsApp format the zones use. */
export default function DayMessage({ me, date, wip }: { me: Me; date: string; wip: Record<string, number> }) {
  const from = monthStart(date);
  const d = useLoad(async () => {
    const [own, sum] = await Promise.all([
      rpc<Rep[]>('day_report', { p_date: date, p_scope: 'me' }),
      rpc<any[]>('attendance_board', { p_from: from, p_to: date }),
    ]);
    let money = null;
    if (me.has_collections) {
      const [c, b] = await Promise.all([
        select('collection_entries', 'collection_date,amount_received', (q) => q.eq('person_id', me.person_id).gte('collection_date', from).lte('collection_date', date)),
        select('bill_entries', 'bill_date,bill_amount,status', (q) => q.eq('person_id', me.person_id).gte('bill_date', from).lte('bill_date', date).neq('status', 'cancelled')),
      ]);
      const s = (rs: any[], k: string, dk: string, only?: string) => rs.filter((r) => !only || r[dk] === only).reduce((a, r) => a + Number(r[k]), 0);
      money = { collected_today: s(c, 'amount_received', 'collection_date', date), collected_mtd: s(c, 'amount_received', 'collection_date'),
        billed_today: s(b, 'bill_amount', 'bill_date', date), billed_mtd: s(b, 'bill_amount', 'bill_date') };
    }
    let team = null;
    if (me.manages_operations) {
      const [tr, ta, ts] = await Promise.all([
        rpc<Rep[]>('day_report', { p_date: date, p_scope: 'team' }),
        rpc<any[]>('attendance_board', { p_from: from, p_to: date, p_manager: me.person_id }),
        rpc<any[]>('team_status', { p_work_date: date }),
      ]);
      team = { tr, ta, ts };
    }
    return { own, mine: sum[0], money, team };
  }, [date]);

  if (d.loading) return <Loading rows={2} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const x = d.data!;
  const own = dailyMessage({ date, name: me.full_name, lines: x.own.map((r) => ({ ...r, wip: wip[r.client_location_id] ?? null })),
    att: { status: x.mine ? `${x.mine.day_category} · ${x.mine.day_sub}` : null, shrinkage: x.mine?.shrinkage_pct == null ? null : Number(x.mine.shrinkage_pct) }, money: x.money });
  let team: string | null = null;
  if (x.team) {
    const ta = x.team.ta;
    const st = (s: string[]) => ta.filter((r: any) => s.includes(r.day_status)).length;
    const sch = ta.reduce((a: number, r: any) => a + r.scheduled - r.pending, 0);
    const lost = ta.reduce((a: number, r: any) => a + r.absent + r.planned_leave + r.unplanned_leave + r.half_day / 2, 0);
    team = dailyMessage({ date, name: `${me.full_name} — team (${ta.length} people) + own`, title: 'Team summary', lines: merge(x.team.tr, x.own),
      att: { team: { people: ta.length, present: st(['present', 'half_day', 'early_leave', 'sunday_work']), late: st(['late']),
        leave: st(['planned_leave', 'unplanned_leave']), absent: st(['absent']), not_marked: st(['pending']) },
        shrinkage: sch ? lost / sch * 100 : null },
      submitted: { done: x.team.ts.filter((r: any) => r.resolved).length, of: x.team.ts.length } });
  }
  return (
    <Card title="Daily message — copy and post on WhatsApp">
      <div className="stack">
        <CopyBox title="My figures" text={own} />
        {team && <CopyBox title="My team's figures (roll-up + mine)" text={team} />}
        <p className="small muted">Line format: <b>Client: received today</b>, then R = received, C = closed, X = cancelled, Pending = net pendency, and month-to-date (MTD) figures. Billable = received − cancelled.</p>
      </div>
    </Card>
  );
}
