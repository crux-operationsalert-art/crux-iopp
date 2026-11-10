import { useEffect, useId, useRef, useState } from 'react';
import { sectionHelp } from '../lib/help';

/** The small ? next to a title (D-102): what this section is and what to do. Shows nothing when there is no note. */
export function HelpTip({ k, text }: { k?: unknown; text?: string }) {
  const note = text ?? sectionHelp(k);
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(-12);
  const ref = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', off); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!note) return null;
  return (
    <span className="helptip" ref={ref}>
      <button type="button" className="helptip-btn" aria-expanded={open} aria-controls={id} aria-label={`What is ${typeof k === 'string' ? k : 'this'}?`} onClick={() => {
        // keep the note on screen: shift it left when the ? is near the right edge
        const r = ref.current?.getBoundingClientRect(); const w = Math.min(300, window.innerWidth * 0.8);
        if (r) setLeft(Math.min(-12, window.innerWidth - 12 - w - r.left)); setOpen(!open); }}>?</button>
      {open && <span id={id} role="note" className="helptip-pop" style={{ left }}>{note}</span>}
    </span>
  );
}
