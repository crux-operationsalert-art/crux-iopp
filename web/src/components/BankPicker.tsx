import { rpc } from '../lib/api';
import { useLoad } from './ui';

export type Bank = { ifsc_code: string; name: string; kind: string };
let CACHE: Bank[] | null = null;

/** The bank for an IFSC, from the official list (null when the four-letter code is not one we hold). */
export function bankFromIfsc(list: Bank[] | null | undefined, ifsc?: string): string | null {
  const code = (ifsc ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
  if (code.length !== 4 || !list) return null;
  return list.find((b) => b.ifsc_code === code)?.name ?? null;
}

/** Shows the bank taken from the IFSC; when the IFSC is one we don't hold, offers the bank list to pick from (D-103). */
export function BankPicker({ ifsc, value, onChange }: { ifsc?: string; value?: string; onChange: (name: string) => void }) {
  const list = useLoad(() => (CACHE ? Promise.resolve(CACHE) : rpc<Bank[]>('bank_list').then((b) => (CACHE = b))), []);
  const derived = bankFromIfsc(list.data, ifsc);
  const ifscOk = /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test((ifsc ?? '').replace(/\s/g, ''));
  if (derived) return <div><span className="muted small">Bank</span><div><b>{derived}</b> <span className="muted small">from IFSC</span></div></div>;
  if (!ifscOk) return <div><span className="muted small">Bank</span><div className="muted small">Enter a valid IFSC and your bank will appear.</div></div>;
  return (
    <label className="field">Your bank <span className="muted">(IFSC not recognised — pick it)</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose your bank…</option>
        {(list.data ?? []).map((b) => <option key={b.ifsc_code} value={b.name}>{b.name}</option>)}
      </select></label>
  );
}
