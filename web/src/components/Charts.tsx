// Small dependency-free SVG charts (line + bars + sparkline). Colours follow the CRUX palette.
export const C = { navy: '#012277', blue: '#0096ff', red: '#c62828', grey: '#9aa5b1', green: '#1f7a5c', amber: '#b26a00' };
const fmtK = (v: number) => (Math.abs(v) >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : Math.abs(v) >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : `${Math.round(v)}`);

type S = { name: string; values: (number | null)[]; color: string; dashed?: boolean; bars?: boolean };
export function Chart({ labels, series, height = 220, title }: { labels: string[]; series: S[]; height?: number; title?: string }) {
  const W = 760, H = height, L = 46, R = 10, T = 14, B = 34;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const max = Math.max(1, ...all) * 1.08;
  const x = (i: number) => L + ((i + 0.5) * (W - L - R)) / Math.max(1, labels.length);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const bw = Math.max(4, ((W - L - R) / Math.max(1, labels.length)) * 0.55);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const every = Math.ceil(labels.length / 12);
  return (
    <figure style={{ margin: 0 }}>
      {title && <figcaption className="small muted" style={{ marginBottom: 4 }}>{title}</figcaption>}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title ?? 'chart'} style={{ display: 'block' }}>
        {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">{fmtK(t)}</text></g>)}
        {labels.map((l, i) => i % every === 0 && <text key={i} x={x(i)} y={H - 12} textAnchor="middle" fontSize={11} fill="var(--muted)">{l}</text>)}
        {series.filter((s) => s.bars).map((s) => s.values.map((v, i) => v == null ? null :
          <rect key={s.name + i} x={x(i) - bw / 2} y={y(v)} width={bw} height={Math.max(0, H - B - y(v))} fill={s.color} opacity={0.85} rx={2}><title>{`${labels[i]} · ${s.name}: ${Math.round(v).toLocaleString('en-IN')}`}</title></rect>))}
        {series.filter((s) => !s.bars).map((s) => {
          const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as const));
          let d = ''; pts.forEach((p, i) => { if (!p) return; d += `${d && pts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)} `; });
          return <g key={s.name}><path d={d} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dashed ? '6 5' : undefined} />
            {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={2.6} fill={s.color}><title>{`${labels[i]} · ${s.name}: ${Math.round(s.values[i]!).toLocaleString('en-IN')}`}</title></circle>)}</g>;
        })}
      </svg>
      <div className="row small" style={{ gap: 14, marginTop: 2 }}>{series.map((s) => <span key={s.name} className="row" style={{ gap: 6 }}>
        <span aria-hidden style={{ width: 14, height: s.bars ? 10 : 3, background: s.color, display: 'inline-block', borderRadius: 2, opacity: s.dashed ? 0.6 : 1 }} />{s.name}</span>)}</div>
    </figure>
  );
}

export function Spark({ values, color = C.navy, w = 120, h = 28 }: { values: (number | null)[]; color?: string; w?: number; h?: number }) {
  const v = values.map((x) => (x == null ? null : Number(x)));
  const nums = v.filter((x): x is number => x != null);
  if (nums.length < 2) return <span className="small muted">—</span>;
  const max = Math.max(...nums), min = Math.min(...nums, 0), span = max - min || 1;
  let d = '';
  v.forEach((x, i) => { if (x == null) return; const px = (i * (w - 4)) / (v.length - 1) + 2, py = h - 3 - ((x - min) / span) * (h - 6); d += `${d ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)} `; });
  return <svg width={w} height={h} aria-hidden><path d={d} fill="none" stroke={color} strokeWidth={1.8} /></svg>;
}

export function Bar({ value, max, color = C.navy }: { value: number; max: number; color?: string }) {
  return <div style={{ background: 'var(--surface-2)', borderRadius: 4, height: 8, width: '100%', minWidth: 60 }}>
    <div style={{ width: `${Math.max(0, Math.min(100, (value / (max || 1)) * 100))}%`, background: color, height: 8, borderRadius: 4 }} /></div>;
}
