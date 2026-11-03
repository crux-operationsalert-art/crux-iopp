import { ReactNode, useEffect, useState } from 'react';
import { errText } from '../lib/api';
import { label, left } from '../lib/format';

export const Card = ({ children, title, action }: { children: ReactNode; title?: ReactNode; action?: ReactNode }) => (
  <section className="card">
    {(title || action) && <div className="row" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>{title}</h2><span className="spacer" />{action}</div>}
    {children}
  </section>
);

export const Kpi = ({ label: l, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div className="card kpi"><div className="label">{l}</div><div className="value">{value}</div>{sub && <div className="sub">{sub}</div>}</div>
);

const tone: Record<string, string> = {
  submitted: 'ok', manager_entered: 'info', certified: 'ok', absent: 'neutral', on_leave: 'neutral',
  non_operational: 'neutral', exception: 'warn', draft: 'warn', pending: 'bad', reopened: 'info',
  proposed: 'warn', approved: 'bad', waived: 'ok', reversed: 'ok', disputed: 'info',
  reconciled: 'ok', partially_reconciled: 'warn', mismatch: 'bad', open: 'ok', grace: 'warn', closed: 'bad', future: 'neutral',
};
const icon: Record<string, string> = { ok: '✓', warn: '!', bad: '✕', info: 'i', neutral: '–' };
export const Pill = ({ status, text }: { status: string; text?: string }) => {
  const t = tone[status] ?? 'neutral';
  return <span className={`pill ${t}`}><span aria-hidden>{icon[t]}</span>{text ?? label(status)}</span>;
};

export const Loading = ({ rows = 3 }: { rows?: number }) => (
  <div className="stack" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" />)}</div>
);
export const Empty = ({ children }: { children: ReactNode }) => <p className="muted" style={{ margin: '8px 0' }}>{children}</p>;
export const ErrorBox = ({ error, retry }: { error: unknown; retry?: () => void }) =>
  error ? <div className="banner bad" role="alert">{errText(error)} {retry && <button className="btn sm" onClick={retry}>Try again</button>}</div> : null;

/** Re-renders every 30 s so deadlines stay current. */
export function Countdown({ to, prefix }: { to: string; prefix?: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  return <span>{prefix}{left(to)}</span>;
}

/** Small data loader with loading / error / reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true); setError(null);
    fn().then((d) => live && setData(d)).catch((e) => live && setError(e)).finally(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

export function Progress({ value }: { value: number | null }) {
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  return <div className="progress" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${v}%` }} /></div>;
}

/** Read-only message with Copy, WhatsApp and (optional) email buttons. */
export function CopyBox({ text, title, mobile, email, subject, html }: { text: string; title?: string; mobile?: string | null;
  email?: string | null; subject?: string; html?: string }) {
  const [done, setDone] = useState('');
  async function copy(kind: 'text' | 'html') {
    try {
      if (kind === 'html' && html && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      } else await navigator.clipboard.writeText(text);
      setDone(kind === 'html' ? 'Formatted email copied — paste into Gmail/Outlook' : 'Copied');
    } catch { setDone('Copy blocked by the browser — select the text and copy it manually'); }
    window.setTimeout(() => setDone(''), 4000);
  }
  const d = (mobile ?? '').replace(/\D/g, '').slice(-10);
  return (
    <div className="stack">
      {title && <b>{title}</b>}
      <textarea readOnly rows={Math.min(18, text.split('\n').length + 1)} value={text} onFocus={(e) => e.currentTarget.select()} style={{ fontFamily: 'inherit', fontSize: '.9rem' }} />
      <div className="row">
        <button className="btn primary" onClick={() => copy('text')}>Copy message</button>
        <a className="btn" target="_blank" rel="noreferrer" href={`https://wa.me/${d.length === 10 ? '91' + d : ''}?text=${encodeURIComponent(text)}`}>WhatsApp</a>
        {email !== undefined && <a className="btn" href={`mailto:${encodeURIComponent(email ?? '')}?subject=${encodeURIComponent(subject ?? '')}&body=${encodeURIComponent(text.slice(0, 1800))}`}>Email</a>}
        {html && <button className="btn" onClick={() => copy('html')}>Copy formatted email</button>}
        <span className="small muted" aria-live="polite">{done}</span>
      </div>
    </div>
  );
}

/** Simple tab strip. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return <div className="chips" role="tablist">{tabs.map(([k, l]) =>
    <button key={k} role="tab" aria-selected={value === k} className={`chip ${value === k ? 'on' : ''}`} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
