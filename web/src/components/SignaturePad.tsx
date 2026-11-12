import { useEffect, useRef, useState } from 'react';

/** Sign with a finger, stylus or mouse. Gives back a small PNG (transparent, dark ink) or null when cleared. */
export function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const draw = useRef<{ on: boolean; x: number; y: number; moved: number }>({ on: false, x: 0, y: 0, moved: 0 });
  const [has, setHas] = useState(false);
  useEffect(() => {
    const c = ref.current!; const r = c.getBoundingClientRect(); const k = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * k); c.height = Math.round(r.height * k);
    const g = c.getContext('2d')!; g.scale(k, k); g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#14213d';
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { e.preventDefault(); ref.current!.setPointerCapture(e.pointerId); const p = pos(e); draw.current = { on: true, x: p.x, y: p.y, moved: draw.current.moved }; };
  const move = (e: React.PointerEvent) => {
    const d = draw.current; if (!d.on) return; e.preventDefault();
    const p = pos(e); const g = ref.current!.getContext('2d')!; g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(p.x, p.y); g.stroke();
    d.moved += Math.hypot(p.x - d.x, p.y - d.y); d.x = p.x; d.y = p.y;
  };
  const up = () => { const d = draw.current; if (!d.on) return; d.on = false; if (d.moved > 40) { setHas(true); onChange(ref.current!.toDataURL('image/png')); } };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); draw.current.moved = 0; setHas(false); onChange(null); };
  return (
    <div className="sigpad">
      <canvas ref={ref} role="img" aria-label="Signature box. Sign here with your finger." onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{has ? 'Signature captured.' : 'Sign inside the box with your finger.'}</span>
        <button type="button" className="btn sm" onClick={clear} disabled={!has}>Clear and sign again</button>
      </div>
    </div>
  );
}
