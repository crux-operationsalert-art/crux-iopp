/** Pending-by-age carried forward (D-97): yesterday's age groups grow older by the days that passed, today's received cases
 *  start in "0–1 d", and closed + cancelled cases come off the oldest first. The person only changes what is different. */
export const EDGES = [0, 1, 2, 4, 7, 15, Infinity];

/** Shift counts in the six age groups forward by `days`, spreading each group evenly over its span (whole cases, totals kept). */
export function ageBuckets(prev: number[], days: number): number[] {
  const n = EDGES.length - 1;
  const p = prev.slice(0, n).map((x) => Math.max(0, Math.floor(Number(x) || 0)));
  if (!(days > 0)) return p;
  const out = new Array(n).fill(0);
  p.forEach((count, i) => {
    if (!count) return;
    const a = EDGES[i], b = EDGES[i + 1];
    if (!Number.isFinite(b)) { out[n - 1] += count; return; }
    const lo = a + days, hi = b + days, span = b - a;
    const shares = EDGES.slice(0, n).map((e, j) => Math.max(0, Math.min(hi, EDGES[j + 1]) - Math.max(lo, e)) / span);
    const raw = shares.map((s) => s * count);
    const whole = raw.map(Math.floor);
    let left = count - whole.reduce((t, x) => t + x, 0);
    // largest remainder, older group first on ties, so cases never get younger
    raw.map((r, j) => [r - whole[j], j] as const).sort((x, y) => y[0] - x[0] || y[1] - x[1]).forEach(([, j]) => { if (left > 0 && shares[j] > 0) { whole[j]++; left--; } });
    whole.forEach((w, j) => { out[j] += w; });
  });
  return out;
}

/** Apply today's movement: received joins the youngest group; closed + cancelled leave from the oldest group first. */
export function applyMoves(aged: number[], received: number, gone: number): number[] {
  const out = aged.slice();
  out[0] += Math.max(0, received || 0);
  let take = Math.max(0, gone || 0);
  for (let j = out.length - 1; j >= 0 && take > 0; j--) { const t = Math.min(out[j], take); out[j] -= t; take -= t; }
  return out;
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
