import { useState } from 'react';
import { Me, rpc } from '../lib/api';
import { label, time } from '../lib/format';
import { formatId } from '../lib/ocrParse';
import { DOC_TYPES } from './Documents';
import { IdScan } from './IdScan';
import { Card, ErrorBox, Loading, useLoad } from './ui';

const DOC = Object.fromEntries(DOC_TYPES);
const SRC: Record<string, [string, string]> = { scan: ['ok', 'read from document'], edited: ['warn', 'corrected after the scan — check against the document'], hr: ['info', 'entered by HR'] };

/** The full profile of a person (D-89): contact, personal details, addresses, emergency contact, ID and bank details,
 *  documents and completion. HR / Admin / the person see full ID numbers; managers see them masked. Salary is not here (D-90). */
export function PersonProfile({ personId, hr }: { me?: Me; personId: string; hr?: boolean }) {
  const d = useLoad(() => rpc<any>('person_profile', { p_person: personId }), [personId]);
  const docs = useLoad(() => (hr ? rpc<any[]>('scannable_documents', { p_person: personId }) : Promise.resolve([])), [personId, hr]);
  const [scan, setScan] = useState<'aadhaar' | 'pan' | 'bank' | null>(null);
  if (d.loading) return <Loading rows={4} />;
  if (d.error) return <ErrorBox error={d.error} retry={d.reload} />;
  const x = d.data, p = x.person ?? {}, h = x.profile ?? {}, i = x.identity ?? {}, pr = x.progress ?? {};
  const F = (l: string, v: unknown) => <div><span className="muted small">{l}</span><div>{v == null || v === '' ? <span className="muted">—</span> : String(v)}</div></div>;
  const src = (s?: string) => s && SRC[s] ? <span className={`pill ${SRC[s][0]} small`}>{SRC[s][1]}</span> : null;
  const ex = (t: string[]) => ((docs.data ?? []) as any[]).find((z) => t.includes(z.doc_type)) ?? null;
  return (
    <div className="stack">
      <Card title={`${p.full_name ?? ''} — profile ${pr.pct ?? 0}% complete`}>
        {pr.missing?.length > 0 && <div className="banner warn small">Still needed: {pr.missing.join(' · ')}{pr.blocking ? ' — the app is locked for them until done.' : ` — due ${new Date(pr.due_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}.`}</div>}
        <h3 className="small muted" style={{ margin: '8px 0 4px' }}>Work</h3>
        <div className="grid two">
          {F('Designation', p.designation)}{F('Type', p.resource_type === 'partner' ? 'Partner / BA' : 'CRUX employee')}{F('Status', label(p.status ?? ''))}
          {F('Reports to', (x.managers ?? []).map((m: any) => `${m.name} (${label(m.function)})`).join(', '))}{F('Joining / association date', h.joining_date ?? p.joined_on)}
          {p.resource_type === 'partner' && F('Firm name', h.firm_name)}
        </div>
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>Contact and personal</h3>
        <div className="grid two">
          {F('Mobile', p.mobile)}{F('Email', p.email)}{F('Date of birth', h.date_of_birth)}{F('Gender', h.gender ? label(h.gender) : null)}
          {F('Highest qualification', h.highest_qualification)}{F('City · state · PIN', [h.city, h.state, h.pincode].filter(Boolean).join(' · '))}
          <div style={{ gridColumn: '1 / -1' }}>{F('Current address', h.current_address)}</div>
          <div style={{ gridColumn: '1 / -1' }}>{F('Permanent address', h.permanent_address)}</div>
        </div>
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>Emergency contact</h3>
        <div className="grid two">{F('Name', h.emergency_name)}{F('Relation', h.emergency_relation)}{F('Mobile', h.emergency_phone)}</div>
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>ID and bank {x.full_ids ? '' : <span className="pill neutral small">masked — full numbers: HR / Admin only</span>}</h3>
        <div className="grid two">
          <div>{F('Aadhaar', i.aadhaar ? formatId('aadhaar', i.aadhaar) : null)}{i.aadhaar_name && <div className="small muted">name on card: {i.aadhaar_name}</div>}{src(i.aadhaar_source)}</div>
          <div>{F('PAN', i.pan)}{i.pan_name && <div className="small muted">name on card: {i.pan_name}</div>}{src(i.pan_source)}</div>
          <div>{F('Bank account', i.bank_account)}{i.bank_holder && <div className="small muted">name: {i.bank_holder}</div>}{src(i.bank_source)}</div>
          <div>{F('IFSC · bank', [i.bank_ifsc ?? h.bank_ifsc, i.bank_name ?? h.bank_name].filter(Boolean).join(' · '))}</div>
        </div>
        {hr && <div className="row" style={{ marginTop: 8 }}>
          <span className="small muted">Read or correct from the documents:</span>
          {(['aadhaar', 'pan', 'bank'] as const).map((k) => <button key={k} className={`btn sm${scan === k ? ' primary' : ''}`} onClick={() => setScan(scan === k ? null : k)}>{k === 'bank' ? 'Bank' : k === 'pan' ? 'PAN' : 'Aadhaar'}</button>)}</div>}
        <h3 className="small muted" style={{ margin: '12px 0 4px' }}>Documents</h3>
        {(x.documents ?? []).length === 0 ? <div className="muted small">Nothing uploaded.</div> :
          <div className="small">{(x.documents as any[]).map((z, n) => <div key={n}>{DOC[z.doc_type] ?? z.doc_type} · {time(z.uploaded_at)} · {z.rejected ? <span className="pill bad small">not accepted{z.note ? ` — ${z.note}` : ''}</span> : z.verified ? <span className="pill ok small">verified</span> : <span className="pill warn small">to verify</span>}</div>)}</div>}
      </Card>
      {hr && scan && <IdScan key={scan} personId={personId} kind={scan} existing={ex(scan === 'bank' ? ['bank', 'cancelled_cheque'] : [scan])} onSaved={() => { d.reload(); docs.reload(); }} />}
    </div>
  );
}
