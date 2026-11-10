// Pending-by-age carried forward (D-97).
import { describe, expect, it } from 'vitest';
import { ageBuckets, applyMoves, daysBetween } from '../web/src/lib/aging';

const sum = (a: number[]) => a.reduce((t, x) => t + x, 0);
describe('pending by age, carried forward', () => {
  it('keeps the total and only makes cases older', () => {
    const prev = [5, 4, 6, 3, 8, 2];
    for (const d of [1, 2, 3, 5, 9, 20]) {
      const a = ageBuckets(prev, d);
      expect(sum(a)).toBe(sum(prev));
      // cumulative from the oldest side never shrinks
      for (let j = 5; j >= 0; j--) expect(sum(a.slice(j))).toBeGreaterThanOrEqual(sum(prev.slice(j)));
    }
  });
  it('moves a day: 0–1 d becomes 1–2 d; 1–2 d becomes 2–4 d; 15+ stays', () => {
    expect(ageBuckets([3, 2, 0, 0, 0, 1], 1)).toEqual([0, 3, 2, 0, 0, 1]);
    expect(ageBuckets([3, 0, 0, 0, 0, 0], 0)).toEqual([3, 0, 0, 0, 0, 0]);
    expect(ageBuckets([0, 0, 0, 0, 0, 7], 30)).toEqual([0, 0, 0, 0, 0, 7]);
    expect(ageBuckets([0, 0, 4, 0, 0, 0], 1)).toEqual([0, 0, 2, 2, 0, 0]);   // half of 2–4 d crosses into 4–7 d
  });
  it('adds received to the youngest group and takes closed + cancelled from the oldest', () => {
    expect(applyMoves([0, 3, 2, 0, 0, 1], 4, 2)).toEqual([4, 3, 1, 0, 0, 0]);
    expect(sum(applyMoves([1, 1, 1, 1, 1, 1], 5, 3))).toBe(8);
    expect(daysBetween('2026-11-07', '2026-11-10')).toBe(3);
  });
});
