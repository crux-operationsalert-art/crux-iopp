import { useRef, useState } from 'react';
import { rpc, sb, errText } from '../lib/api';
import { useLoad } from './ui';
import { Icon } from './Icon';

const BUCKET = 'attachments';
const MAX = 10 * 1024 * 1024;
const OKMIME = /^(application\/pdf|image\/(jpeg|png|webp|heic|gif)|application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet)|text\/(csv|plain))$/;
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.docx,.xlsx,.csv,.txt,image/*,application/pdf';

export type Att = { id: string; parent_id: string; file_name: string; mime: string | null; size: number | null; storage_path: string; by_name: string | null; created_at: string };

export function attachCheck(f: File): string | null {
  if (f.size > MAX) return 'The file is larger than 10 MB.';
  if (!OKMIME.test(f.type)) return 'Allowed: PDF, image, Word, Excel, CSV or text.';
  return null;
}

/** Upload one file to the private bucket and register it against its parent. */
export async function uploadAttachment(parentType: 'chat' | 'task', parentId: string, f: File): Promise<string> {
  const bad = attachCheck(f); if (bad) throw new Error(bad);
  const safe = f.name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const path = `${parentType}/${parentId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
  if (error) throw error;
  return rpc<string>('register_attachment', { p_parent_type: parentType, p_parent_id: parentId, p_path: path, p_file_name: f.name, p_mime: f.type, p_size: f.size });
}

/** Open a stored attachment with a 60-second signed link (tab opens on the tap so phones don't block it). */
export async function openAttachment(path: string) {
  const w = window.open('', '_blank');
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 60);
  if (error || !data) { w?.close(); throw error ?? new Error('Could not open the file.'); }
  if (w) { w.opener = null; w.location.href = data.signedUrl; } else window.location.href = data.signedUrl;
}

/** Chips for a set of attachments; each opens via a signed link. */
export function AttachChips({ items }: { items: Att[] }) {
  const [err, setErr] = useState(false);
  if (!items.length) return null;
  return (
    <div className="attachrow">
      {items.map((a) => <button key={a.id} className="attachchip" onClick={() => openAttachment(a.storage_path).catch(() => setErr(true))} title={a.by_name ? `added by ${a.by_name}` : ''}>
        <Icon name="file" size={13} /> <span className="fn">{a.file_name}</span></button>)}
      {err && <span className="small" style={{ color: 'var(--bad)' }}>Could not open the file.</span>}
    </div>
  );
}

/** Existing attachments on a task + (for people who can see it) a multi-select Attach button. */
export function TaskAttachments({ taskId, canAdd }: { taskId: string; canAdd: boolean }) {
  const d = useLoad(() => rpc<Att[]>('attachments_for', { p_parent_type: 'task', p_parent_ids: [taskId] }), [taskId]);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setErr(null);
    try { for (const f of Array.from(files)) await uploadAttachment('task', taskId, f); d.reload(); }
    catch (e) { setErr(e); } finally { setBusy(false); if (ref.current) ref.current.value = ''; }
  }
  const items = (d.data ?? []) as Att[];
  if (!canAdd && items.length === 0) return null;
  return (
    <div className="attachbox">
      <AttachChips items={items} />
      {canAdd && <>
        <button className="btn sm ghost" disabled={busy} onClick={() => ref.current?.click()}><Icon name="paperclip" size={14} /> {busy ? 'Uploading…' : 'Attach files'}</button>
        <input ref={ref} type="file" accept={ACCEPT} multiple hidden onChange={(e) => add(e.target.files)} /></>}
      {err ? <span className="small" style={{ color: 'var(--bad)' }}>{errText(err)}</span> : null}
    </div>
  );
}
