import { useEffect, useState } from 'react';
import { loadMeta, resetTraining, setTrainingUser, trainingUser, type TrainingMeta } from './engine';

const KEY = 'crux-training-as';

/** The strip across the top of training mode: who you are, and switch to anyone in the invented company. */
export function TrainingRoot({ children }: { children: (key: string) => JSX.Element }) {
  const [meta, setMeta] = useState<TrainingMeta | null>(null);
  const [err, setErr] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadMeta().then((m: TrainingMeta) => {
      let saved = ''; try { saved = sessionStorage.getItem(KEY) ?? ''; } catch { /* ignore */ }
      const start = m.people.find((p: TrainingMeta['people'][number]) => p.auth === saved) ?? m.people.find((p: TrainingMeta['people'][number]) => p.key === 'admin') ?? m.people[0];
      setTrainingUser(start.auth); setMeta(m); setWho(start.auth);
    }).catch((e) => setErr(String(e?.message ?? e)));
  }, []);
  const pick = (auth: string) => { setTrainingUser(auth); try { sessionStorage.setItem(KEY, auth); } catch { /* ignore */ } setWho(auth); };
  if (err) return <div className="login card"><h1>Training mode</h1><p>{err}</p></div>;
  if (!meta || !who || trainingUser() !== who) return <div className="login"><p className="muted">Loading the training company…</p></div>;
  const me = meta.people.find((p) => p.auth === who);
  const day = new Date(meta.today + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <>
      <div className="trainingbar" role="region" aria-label="Training mode">
        <b>Training mode</b>
        <span className="small">Made-up company and people. Nothing here is real or reaches the real app. Today is {day}.</span>
        <label className="small">You are
          <select value={who} onChange={(e) => pick(e.target.value)} aria-label="Switch to another person">
            {meta.people.map((p) => <option key={p.auth} value={p.auth}>{p.role} — {p.name}</option>)}
          </select></label>
        <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); await resetTraining().catch(() => undefined); setBusy(false); setWho(''); window.setTimeout(() => setWho(me?.auth ?? meta.people[0].auth), 0); }}>
          {busy ? 'Resetting…' : 'Start again'}</button>
      </div>
      {children(who)}
    </>
  );
}
