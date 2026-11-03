import { useMemo, useState } from 'react';
import { rpc } from '../lib/api';
import { ErrorBox, Loading, useLoad } from './ui';

type S = { client_location_id: string; client: string; location: string; zone: string | null; active: boolean; since: string | null; my_location: boolean };

/** Every client × location with an active / inactive tick. Active ones first, then the person's own locations.
 *  For yourself no reason is needed; for a team member the change needs a reason (recorded). */
export function ClientPicker({ person, personName, onChanged, compact }: { person?: string; personName?: string; onChanged?: () => void; compact?: boolean }) {
  const d = useLoad(() => rpc<S[]>('my_services', person ? { p_person: person } : {}), [person]);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const rows = d.data ?? [];
  const anyMine = rows.some((r) => r.my_location || r.active);
  const shown = useMemo(() => rows.filter((r) => (all || !anyMine || r.active || r.my_location)
    && `${r.client} ${r.location} ${r.zone ?? ''}`.toLowerCase().includes(q.toLowerCase())), [rows, all, q, anyMine]);
  async function toggle(r: S) {
    if (person && !reason.trim()) { setErr(new Error(`Write a reason first (it is recorded and ${personName ?? 'the person'} is told).`)); return; }
    setBusy(r.client_location_id); setErr(null);
    try {
      const res = await rpc<string>('set_service_active', { p_client_location: r.client_location_id, p_active: !r.active, ...(person ? { p_person: person, p_reason: reason } : {}) });
      setNote(`${r.client} · ${r.location}: ${res}`);
      d.setData(rows.map((x) => x.client_location_id === r.client_location_id ? { ...x, active: !r.active } : x));
      onChanged?.();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  }
  const active = rows.filter((r) => r.active).length;
  return (
    <div className="stack">
      <div className="row">
        <b>{active} active</b><span className="muted small">of {rows.length} client-locations</span><span className="spacer" />
        {anyMine && <label className="small row" style={{ gap: 6 }}><input type="checkbox" style={{ width: 18, height: 18, margin: 0 }} checked={all} onChange={(e) => setAll(e.target.checked)} />Show all locations</label>}
      </div>
      <input placeholder="Search client, location or zone…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search clients" />
      {person && <label className="field">Reason for changes (required, recorded)<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. now also covering Nashik BOM" /></label>}
      <ErrorBox error={err} />
      {note && <div className="small muted" aria-live="polite">{note}</div>}
      <div style={{ maxHeight: compact ? 260 : 420, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {d.loading ? <Loading rows={3} /> : shown.length === 0 ? <p className="muted small" style={{ padding: 10 }}>Nothing matches.</p> :
          <table><tbody>{shown.map((r) => (
            <tr key={r.client_location_id} style={{ background: r.active ? 'var(--ok-bg, rgba(31,122,77,.07))' : undefined }}>
              <td style={{ width: 36 }}><input type="checkbox" aria-label={`${r.client} at ${r.location}`} disabled={busy === r.client_location_id}
                style={{ width: 20, height: 20, margin: 0 }} checked={r.active} onChange={() => toggle(r)} /></td>
              <td><b>{r.client}</b><div className="small muted">{r.location}{r.zone && r.zone !== r.location ? ` · ${r.zone}` : ''}</div></td>
              <td className="small muted" style={{ textAlign: 'right' }}>{r.active ? (r.since ? `active since ${r.since.slice(8, 10)}/${r.since.slice(5, 7)}` : 'active') : 'inactive'}</td>
            </tr>))}</tbody></table>}
      </div>
      <p className="small muted">Tick a client the {person ? 'person works' : 'you work'} on — it appears in My day from today. Untick to stop (from today, or from tomorrow if figures were already entered today). If a wrong client is ticked and figures entered, the manager can correct or remove that entry with a note.</p>
    </div>
  );
}
