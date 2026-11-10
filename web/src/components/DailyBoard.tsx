import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { label, money, num } from '../lib/format';
import { Card, Empty, ErrorBox, Loading, useLoad } from './ui';

type Mem = { person_id: string; status: string; resolved: boolean; recv: number; logged: number; closed: number; cancelled: number; rollover: number; pending: number;
  rev: number; tat: number[]; has_tat: boolean; mtd_recv: number; mtd_closed: number; mtd_cancelled: number; mtd_rev: number };
type Tile = { branch_id: string; branch: string; client_id: string; client: string; mine: boolean; self: any; team: any; members: Mem[]; coll: any; validated_at: string | null };
type Board = { date: string; window: string; manager: boolean; certified: boolean; people: Record<string, { name: string; designation: string | null; path: string[]; direct: boolean }>; tiles: Tile[] };
const AGES = ['<1d', '1–2d', '2–4d', '4–7d', '7–15d', '15d+'];
const n = (v: unknown) => Number(v ?? 0) || 0;
const SUMK = ['recv', 'logged', 'closed', 'cancelled', 'rollover', 'pending', 'rev', 'mtd_recv', 'mtd_closed', 'mtd_cancelled', 'mtd_rev'] as const;
type Agg = Record<(typeof SUMK)[number], number> & { tat: number[]; people: number; reported: number };
function agg(ms: Mem[]): Agg {
  const o = Object.fromEntries(SUMK.map((k) => [k, ms.reduce((a, m) => a + n(m[k]), 0)])) as Record<(typeof SUMK)[number], number>;
  return { ...o, tat: AGES.map((_, i) => ms.reduce((a, m) => a + n(m.tat?.[i]), 0)), people: ms.length, reported: ms.filter((m) => m.resolved).length };
}
const ST: Record<string, string> = { submitted: 'ok', manager_entered: 'ok', absent: 'bad', on_leave: 'info', non_operational: 'neutral', exception: 'warn', draft: 'warn', pending: 'warn' };

/** Daily updates as client tiles (D-91). Data comes only from daily_board, which returns the viewer and the people below
 *  them in the reporting line — nothing else (D-52). */
export function DailyBoard({ me, date, onEnter, onChanged }: { me: Me; date: string; onEnter?: (client: string) => void; onChanged?: () => void }) {
  const b = useLoad(() => rpc<Board>('daily_board', { p_date: date }), [date]);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'action' | 'mine'>('all');
  const [limit, setLimit] = useState(15);
  const d = b.data;
  const act = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); setErr(null); setMsg(''); try { await fn(); setMsg(ok); b.reload(); onChanged?.(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const name = (id: string) => (id === me.person_id ? 'You' : d?.people[id]?.name ?? '—');
  const remind = (ids: string[]) => act(async () => { const k = await rpc<number>('nudge_people', { p_people: ids, p_date: date }); if (!k) throw new Error('Already reminded in the last 30 minutes.'); }, `Reminder sent to ${ids.length} person(s).`);
  const absent = (ids: string[]) => { const r = window.prompt(`Reason for marking ${ids.map(name).join(', ')} absent on ${date}`); if (r && r.trim())
    act(async () => { for (const id of ids) await rpc('team_mark_absent', { p_person: id, p_date: date, p_reason: r.trim() }); }, `Marked absent: ${ids.map(name).join(', ')}.`); };
  const summary = useMemo(() => {
    if (!d) return null;
    const withTeam = d.tiles.filter((t) => t.members.some((m) => m.person_id !== me.person_id));
    return { clients: d.tiles.length, validated: withTeam.filter((t) => t.validated_at).length, toValidate: withTeam.length };
  }, [d, me.person_id]);
  if (b.loading) return <Loading rows={3} />;
  if (b.error) return <ErrorBox error={b.error} retry={b.reload} />;
  if (!d || d.tiles.length === 0) return <Card><Empty>No clients for you or your team on this day. Tick your clients under “My clients”.</Empty></Card>;
  return (
    <div className="stack">
      <div className="row"><h2 style={{ margin: 0, fontSize: '1.05rem' }}>Clients · {d.tiles.length}</h2>
        {d.manager && summary && <span className={`pill ${summary.validated === summary.toValidate ? 'ok' : 'warn'}`}>Validated {summary.validated} of {summary.toValidate}</span>}
        {d.certified && <span className="pill ok">Day certified</span>}<span className="spacer" />
        <button className="btn sm" onClick={b.reload}>Refresh</button></div>
      {d.tiles.length > 6 && <div className="row">
        <input placeholder="Search client or branch…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(15); }} aria-label="Search clients" style={{ maxWidth: 260 }} />
        <select value={only} onChange={(e) => { setOnly(e.target.value as any); setLimit(15); }} aria-label="Show" style={{ width: 'auto' }}>
          <option value="all">All clients</option><option value="action">Needs action (not reported / not validated)</option><option value="mine">Only mine</option></select></div>}
      <ErrorBox error={err} />{msg && <div className="banner ok" role="status">{msg}</div>}
      {(() => { const list = d.tiles.filter((t) => `${t.client} ${t.branch}`.toLowerCase().includes(q.toLowerCase())
          && (only === 'all' || (only === 'mine' ? t.mine : (t.members.some((m) => !m.resolved) || (!t.validated_at && t.members.some((m) => m.person_id !== me.person_id))))));
        return <>{list.length === 0 && <Empty>No clients match.</Empty>}{list.slice(0, limit).map((t) => {
        const key = t.branch_id + t.client_id; const team = t.members.filter((m) => m.person_id !== me.person_id);
        const all = agg(t.members); const waiting = team.filter((m) => !m.resolved);
        const selfDone = !t.self || ['submitted', 'manager_entered', 'absent', 'on_leave', 'non_operational', 'exception'].includes(t.self.status);
        const canValidate = d.manager && team.length > 0 && waiting.length === 0 && selfDone && !t.validated_at;
        // not reported, grouped by their own manager (my direct team first, then each sub-team)
        const byMgr = new Map<string, string[]>();
        for (const m of waiting) { const pth = d.people[m.person_id]?.path ?? []; const mgr = pth.length > 1 ? pth[pth.length - 2] : me.person_id; byMgr.set(mgr, [...(byMgr.get(mgr) ?? []), m.person_id]); }
        const c = t.coll ?? {}; const pct = c.target ? Math.round((n(c.collected_mtd) / n(c.target)) * 100) : null;
        const outstanding = c.receivables != null ? n(c.receivables) + n(c.billed_mtd) - n(c.collected_mtd) : null;
        return (
          <div key={key} className="card tile" style={{ padding: 12, borderLeft: `4px solid ${t.validated_at ? 'var(--ok, #1a7f37)' : waiting.length ? 'var(--warn, #b26a00)' : 'var(--border)'}` }}>
            <div className="row"><b>{t.client}</b><span className="muted">· {t.branch}</span>
              {d.manager && team.length > 0 && <span className={`pill ${waiting.length ? 'warn' : 'ok'} small`}>{all.reported} of {all.people} reported</span>}
              {t.validated_at && <span className="pill ok small">Validated</span>}
              {t.coll?.is_head && <span className="pill info small">You enter collections</span>}
              <span className="spacer" />
              {t.mine && onEnter && <button className="btn sm" onClick={() => onEnter(t.client)}>My entry ↓</button>}
              {(team.length > 0 || t.mine) && <button className={`btn sm${canValidate ? ' primary' : ''}`} onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                {canValidate ? 'Validate' : open === key ? 'Close' : 'Details'}</button>}
            </div>
            <div className="grid kpis" style={{ marginTop: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
              {t.self && <div className="small"><div className="muted">Me today</div><b>{num(t.self.recv)}</b> recd · <b>{num(t.self.closed)}</b> closed · {num(t.self.pending)} pending
                <div className="muted">MTD {num(t.self.mtd_recv)} recd · {num(t.self.mtd_closed)} closed · {money(t.self.mtd_rev)}</div>
                <span className={`pill ${ST[t.self.status] ?? 'neutral'} small`}>{t.self.status === 'pending' ? 'Not entered' : label(t.self.status)}</span></div>}
              {team.length > 0 && <div className="small"><div className="muted">Team today (with you)</div><b>{num(all.recv)}</b> recd · {num(all.logged)} entry · <b>{num(all.closed)}</b> closed · {num(all.cancelled)} canc.
                <div className="muted">Rollover {num(all.rollover)} → pending <b>{num(all.pending)}</b> · {money(all.rev)} today</div>
                <div className="muted">MTD {num(all.mtd_recv)} recd · {num(all.mtd_closed)} closed · {money(all.mtd_rev)}</div></div>}
              <div className="small"><div className="muted">Collections</div>{c.entered_today ? <>Today <b>{money(c.received_today)}</b> · reconciled {money(c.reconciled_today)}</> : <span className="muted">Not entered today</span>}
                <div className="muted">MTD {money(c.collected_mtd)}{c.target ? ` of ${money(c.target)} (${pct}%)` : ' · no target'}</div>
                {outstanding != null && <div className="muted">Outstanding {money(outstanding)}</div>}</div>
              <div className="small"><div className="muted">Pending by age (today)</div>
                <div className="row" style={{ gap: 4 }}>{AGES.map((a, i) => <span key={a} className={`pill small ${i >= 4 && all.tat[i] ? 'bad' : 'neutral'}`} title={`${a}: ${all.tat[i]}`}>{a} {num(all.tat[i])}</span>)}</div></div>
            </div>
            {d.manager && waiting.length > 0 && <div className="stack small" style={{ marginTop: 8 }}>
              {[...byMgr.entries()].map(([mgr, ids]) => <div key={mgr} className="row" style={{ gap: 6 }}>
                <span>{mgr === me.person_id ? 'Not yet updated' : `In ${name(mgr)}'s team, not yet updated`}: <b>{ids.map(name).join(', ')}</b></span>
                <button className="btn sm" disabled={busy} onClick={() => remind(ids)}>Send reminder</button>
                <button className="btn sm" disabled={busy} onClick={() => absent(ids)}>Mark absent</button></div>)}</div>}
            {open === key && <Drill me={me} d={d} t={t} canValidate={canValidate} busy={busy} waiting={waiting.length}
              onValidate={(note) => act(async () => { const r = await rpc<any>('validate_client', { p_date: date, p_branch: t.branch_id, p_client: t.client_id, p_note: note || null });
                if (r.day_certified) setTimeout(() => setMsg('All clients validated — the day is certified.'), 0); setOpen(null); }, `${t.client} · ${t.branch} validated.`)} />}
          </div>);
      })}{list.length > limit && <button className="btn" onClick={() => setLimit(limit + 30)}>Show more ({list.length - limit} more)</button>}</>; })()}
    </div>
  );
}

/** Validation panel: today's roll-up for the client (operations + collections), then team → sub-team → person. */
function Drill({ me, d, t, canValidate, busy, waiting, onValidate }: { me: Me; d: Board; t: Tile; canValidate: boolean; busy: boolean; waiting: number; onValidate: (note: string) => void }) {
  const [note, setNote] = useState('');
  const all = agg(t.members);
  return (
    <div className="stack" style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div className="small"><b>Roll-up today</b> — Rollover {num(all.rollover)} + Received {num(all.recv)} − Closed {num(all.closed)} − Cancelled {num(all.cancelled)} = pending <b>{num(all.pending)}</b> · Entry {num(all.logged)} of {num(all.recv)} · revenue {money(all.rev)}
        {t.coll?.entered_today && <> · collections {money(t.coll.received_today)} (reconciled {money(t.coll.reconciled_today)}, bills {num(t.coll.bills_today)} for {money(t.coll.billed_today)})</>}</div>
      <div className="tablewrap" tabIndex={0}><table className="small">
        <thead><tr><th>Who</th><th>Status</th><th className="num">Rollover</th><th className="num">Recd</th><th className="num">Entry</th><th className="num">Closed</th><th className="num">Canc.</th><th className="num">Pending</th>
          {AGES.map((a) => <th key={a} className="num">{a}</th>)}<th className="num">Revenue</th><th className="num">MTD recd · closed · ₹</th></tr></thead>
        <tbody><Level me={me} d={d} ms={t.members} depth={0} tile={t} /></tbody></table></div>
      {canValidate ? <div className="row"><input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ maxWidth: 320 }} aria-label="Validation note" />
          <button className="btn primary" disabled={busy} onClick={() => onValidate(note)}>Validate {t.client}</button></div>
        : t.validated_at ? <div className="small muted">Validated {new Date(t.validated_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.</div>
        : waiting > 0 ? <div className="small muted">Validate becomes available when everyone on this client has reported or is marked absent / on leave.</div>
        : t.members.some((m) => m.person_id !== me.person_id) ? <div className="small muted">Submit your own figures for this client first.</div> : null}
    </div>
  );
}

/** One level of the drill-down: group the people by the next person in their line below me; expand to go deeper. */
function Level({ me, d, ms, depth, tile }: { me: Me; d: Board; ms: Mem[]; depth: number; tile: Tile }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const nav = useNavigate();
  // ask about these figures in Chat; the thread carries the client, location and date (D-99)
  const ask = (id: string) => rpc<string>('chat_topic', { p_people: [id], p_title: `${tile.client} · ${tile.branch}`, p_ref: { client: tile.client, location: tile.branch, date: d.date, client_id: tile.client_id, branch_id: tile.branch_id } })
    .then((t) => nav(`/chat?t=${t}`)).catch(() => nav('/chat'));
  const groups = new Map<string, Mem[]>();
  for (const m of ms) {
    const pth = m.person_id === me.person_id ? [] : d.people[m.person_id]?.path ?? [];
    const k = pth[depth] ?? m.person_id; groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return <>{[...groups.entries()].map(([k, list]) => {
    const leaf = list.length === 1 && list[0].person_id === k; const a = leaf ? list[0] : null; const s = agg(list);
    const nm = k === me.person_id ? 'You' : d.people[k]?.name ?? '—';
    return <Fragment key={k}>
      <tr><td style={{ paddingLeft: 8 + depth * 16 }}>{leaf ? <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>{nm}{k !== me.person_id && <button className="chip ask" onClick={() => ask(k)} aria-label={`Ask ${nm} about ${tile.client}`}>Ask</button>}</span> : <button className="linklike" aria-expanded={open.has(k)} onClick={() => { const x = new Set(open); x.has(k) ? x.delete(k) : x.add(k); setOpen(x); }}>
          {open.has(k) ? '▾' : '▸'} {nm}'s team ({list.length})</button>}</td>
        <td>{a ? <span className={`pill ${ST[a.status] ?? 'neutral'} small`}>{a.status === 'pending' ? 'not entered' : label(a.status)}</span> : <span className={`pill ${s.reported === s.people ? 'ok' : 'warn'} small`}>{s.reported}/{s.people}</span>}</td>
        <td className="num">{num(s.rollover)}</td><td className="num">{num(s.recv)}</td><td className="num">{num(s.logged)}</td><td className="num">{num(s.closed)}</td><td className="num">{num(s.cancelled)}</td><td className="num"><b>{num(s.pending)}</b></td>
        {s.tat.map((x, i) => <td key={i} className="num">{a && !a.has_tat ? '—' : num(x)}</td>)}<td className="num">{money(s.rev)}</td>
        <td className="num">{num(s.mtd_recv)} · {num(s.mtd_closed)} · {money(s.mtd_rev)}</td></tr>
      {!leaf && open.has(k) && <Level me={me} d={d} ms={list} depth={depth + 1} tile={tile} />}
    </Fragment>;
  })}</>;
}
