import { ReactNode, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Me, rpc } from '../lib/api';
import { nice } from '../lib/format';
import { Icon } from './Icon';
import { Countdown, useLoad } from './ui';
import { HelpTip } from './HelpTip';

export type Badge = { key: string; name: string; got: boolean; how: string };
export type Journey = { reports: boolean; today: string; streak: number; best_streak: number; points: number; month_points: number; month_ontime: number; month_days: number;
  level: string; level_floor: number; next_level_at: number | null; badges: Badge[];
  team?: { top?: { name: string; streak: number; points: number; me: boolean }[]; reported_today?: number; reporting?: number } };

export const useJourney = (dep: unknown = 0) => useLoad(() => rpc<Journey>('my_journey').catch(() => null), [dep]);
const hello = () => { const h = Number(new Date().toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** The one sapphire card (D-100): today's single job, the deadline, and the streak. */
export function TodayHero({ me, day, j }: { me: Me; day: any; j: Journey | null }) {
  const st: string | null = day?.status?.status ?? (day?.rows?.length ? 'pending' : null);
  const sent = st && !['pending', 'draft'].includes(st);
  const rows = day?.rows?.length ?? 0;
  const done = (day?.rows ?? []).filter((r: any) => r.entry != null && r.closure != null).length;
  return (
    <section className="hero" aria-label="Today">
      <div className="hero-top">
        <div style={{ minWidth: 0 }}>
          <div className="hero-date">{nice(me.today)}<HelpTip k="Today" /></div>
          <h1 className="display hero-hello">{hello()}, {me.full_name.split(' ')[0]}</h1>
        </div>
        {j?.reports && <div className="seal" title={`Best: ${j.best_streak} days`}><Icon name="flame" size={18} /><b>{j.streak}</b><span>day{j.streak === 1 ? '' : 's'}</span></div>}
      </div>
      {rows > 0 ? (sent ? (
        <div className="hero-body"><div className="hero-line"><Icon name="check" size={20} /> Today's update is sent{day.status.submitted_at ? ` at ${new Date(day.status.submitted_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}.</div>
          <div className="hero-sub">Nothing else needed from you today{j?.reports ? ` · ${j.month_points} points this month` : ''}.</div>
          <Link className="btn hero-cta ghosted" to="/productivity">View my update</Link></div>
      ) : (
        <div className="hero-body">
          <div className="hero-line">{st === 'draft' ? `${done} of ${rows} clients filled — not sent yet` : `${rows} client${rows === 1 ? '' : 's'} to update`}</div>
          <div className="hero-sub">{day.window === 'open' ? <Countdown to={day.deadline} prefix="Closes at midnight · " /> : day.window === 'grace' ? <>Late window · <Countdown to={day.grace_deadline} /></> : day.window === 'closed' ? 'Closed — ask Admin to reopen' : null}</div>
          <Link className="btn hero-cta" to="/productivity">{st === 'draft' ? 'Finish and send' : "Send today's update"}</Link>
          <div className="hero-hint">Yesterday's figures are already filled in — change only what moved.</div>
        </div>)) : (
        <div className="hero-body"><div className="hero-sub">{entersNothing(me)}</div></div>)}
    </section>
  );
}
const entersNothing = (me: Me) => (me.manages_operations ? 'Your team’s figures come in through the day — review them below.' : 'No client figures are due from you today.');

/** Level, points, badges and positive-only team standing (D-98). Never shows who is behind. */
export function JourneyCard({ j }: { j: Journey }) {
  if (!j.reports) return null;
  const span = (j.next_level_at ?? j.points) - j.level_floor;
  const pct = j.next_level_at ? Math.min(100, Math.round(((j.points - j.level_floor) / Math.max(1, span)) * 100)) : 100;
  const t = j.team ?? {};
  return (
    <section className="card journey" aria-label="My journey">
      <div className="journey-head">
        <Ring pct={pct}><span className="ring-level">{j.level}</span></Ring>
        <div style={{ minWidth: 0 }}>
          <div className="display journey-pts">{j.points.toLocaleString('en-IN')} <span>points</span></div>
          <div className="small muted"><HelpTip text="Points come from sending on time: 10 a day, 5 more before 7 pm, 4 when late, 50 once for a complete profile. Levels: Silver 150, Gold 400, Platinum 800. Badges mark streaks and good habits. Only the top streaks are shown — nobody is listed for missing." />{' '}{j.next_level_at ? `${(j.next_level_at - j.points).toLocaleString('en-IN')} to ${nextLevel(j.level)}` : 'Top level reached'} · on time {j.month_ontime} of {j.month_days} days this month</div>
        </div>
      </div>
      <div className="badges" role="list" aria-label="Badges">
        {j.badges.map((b) => <div role="listitem" key={b.key} className={`badge-tile${b.got ? ' got' : ''}`} title={b.got ? b.name : b.how}>
          <Icon name={b.key.startsWith('streak') ? 'flame' : b.key === 'early' ? 'clock' : b.key === 'profile' ? 'user' : b.key === 'clean' ? 'check' : 'star'} size={18} />
          <span>{b.name}</span>{!b.got && <span className="sr"> — not yet: {b.how}</span>}</div>)}
      </div>
      {(t.top?.length ?? 0) > 0 && <div className="standing">
        <div className="small muted" style={{ marginBottom: 6 }}>Longest streaks in your team{t.reporting ? ` · ${t.reported_today} of ${t.reporting} sent today` : ''}</div>
        <ol>{t.top!.map((p, n) => <li key={n} className={p.me ? 'me' : ''}><span className="small muted">{n + 1}</span><span className="nm">{p.name}</span><span className="small"><Icon name="flame" size={14} /> {p.streak}</span></li>)}</ol>
      </div>}
      <p className="small muted" style={{ margin: '8px 0 0' }}>On time 10 points, before 7 pm 5 more, late 4. Your streak counts working days sent on time; holidays and leave do not break it.</p>
    </section>
  );
}
const nextLevel = (l: string) => ({ Bronze: 'Silver', Silver: 'Gold', Gold: 'Platinum' } as Record<string, string>)[l] ?? 'next level';

function Ring({ pct, children }: { pct: number; children: ReactNode }) {
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="ring" role="img" aria-label={`${pct}% to the next level`}>
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden><circle cx="38" cy="38" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="6" />
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--gold)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 38 38)" /></svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

/** Shown once, right after sending: what the update earned. One orchestrated moment, nothing else animates (D-100). */
export function Celebrate({ before, after, onClose }: { before: Journey | null; after: Journey | null; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const gained = after && before ? after.points - before.points : null;
  const fresh = after?.badges.filter((b) => b.got && !before?.badges.find((x) => x.key === b.key)?.got) ?? [];
  const levelUp = after && before && after.level !== before.level;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="celebrate" role="dialog" aria-modal="true" aria-labelledby="cel-title" onClick={(e) => e.stopPropagation()}>
        <div className="cel-seal" aria-hidden><Icon name="seal" size={88} /><Icon name="check" size={34} className="cel-check" /></div>
        <h2 id="cel-title" className="display">Sent. Thank you.</h2>
        {after?.reports && <>
          <div className="cel-stats">
            <div><b>{after.streak}</b><span>day streak</span></div>
            {gained != null && gained > 0 && <div><b>+{gained}</b><span>points</span></div>}
            <div><b>{after.level}</b><span>level</span></div>
          </div>
          {levelUp && <p className="cel-note">You reached <b>{after.level}</b>.</p>}
          {fresh.map((b) => <p key={b.key} className="cel-note"><Icon name="star" size={16} /> New badge: <b>{b.name}</b></p>)}
        </>}
        <p className="small muted">Your manager can see it now. If anything changes, they will message you in Chat.</p>
        <button ref={btn} className="btn primary" onClick={onClose} style={{ width: '100%' }}>Done</button>
      </div>
    </div>
  );
}
