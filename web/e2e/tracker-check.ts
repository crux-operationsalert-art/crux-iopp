// Builds a tracker from SYNTHETIC data, writes it with formulas, and prints cached values so LibreOffice can recalculate and compare.
import { writeFileSync } from 'node:fs';
import { buildWorkbook, TExport } from '../src/lib/trackerModel';
const z = (zone: string, order: number, style: any, region: string) => ({ zone, zone_order: order, zone_style: style, region });
const r = (zz: any, location: string, lo: number, tier: string, client: string, co: number, rate: number, target: number, e: number, c: number, x: number, prev: number, who: string) =>
  ({ ...zz, tier, location, loc_order: lo, client, client_order: co, rate, target, entry: e, closure: c, cancelled: x, mtd: e - x, prev_mtd: prev, revenue: (e - x) * rate, stakeholder: who, head: null });
const W = z('SYNTH West Zone', 10, { header: 'BDD7EE', rollup: 'EAD1DC', total: 'C27BA0', leaf: 'FBE5D5', loc_total: 'F4B083' }, 'West');
const N = z('SYNTH North', 20, { header: null, leaf: 'CFE2F3', total: '9FC5E8' }, 'North');
const E = z('SYNTH East Zone', 30, { header: 'C9DAF8', leaf: 'D9E2F3', total: '9FC5E8' }, 'East');
const x: TExport = { mode: 'full', as_of: '2026-11-10', month: '2026-11-01', prev_as_of: '2026-11-09', source: 'app', wd_done: 8, wd_total: 25, me: 'SYNTH', roi_exclude: 'SYNTH Mumbai',
  rows: [
    r(W, 'SYNTH Pune', 1, 'Zone A', 'SYNTH-SBI', 2, 300, 100, 60, 20, 5, 40, 'SYNTH ZM A'), r(W, 'SYNTH Pune', 1, 'Zone A', 'SYNTH-BOM', 3, 750, 50, 30, 10, 0, 25, 'SYNTH ZM A'),
    r(W, 'SYNTH Mumbai', 2, 'Zone A', 'SYNTH-SBI', 2, 350, 200, 120, 50, 10, 100, 'SYNTH ZM A'), r(W, 'SYNTH Nashik', 3, 'Zone B', 'SYNTH-BOM', 3, 700, 30, 12, 2, 1, 9, 'SYNTH ZM B'),
    r(N, 'SYNTH Delhi', 4, 'Zone A', 'SYNTH-SBI', 2, 280, 500, 310, 90, 20, 270, 'SYNTH ZM B'), r(N, 'SYNTH Delhi', 4, 'Zone A', 'SYNTH-LIC', 1, 1000, 10, 3, 0, 0, 3, 'SYNTH ZM B'),
    r(E, 'SYNTH Patna', 5, 'Zone B', 'SYNTH-BOM', 3, 700, 210, 120, 30, 0, 110, 'SYNTH ZM C') ] as any,
  history: [{ month: '2026-10-01', location: 'SYNTH Pune', client: 'SYNTH-SBI', cases: 400, revenue: 120000, billing: 90000 },
            { month: '2026-10-01', location: 'SYNTH Patna', client: 'SYNTH-BOM', cases: 130, revenue: 91000, billing: null }],
  people: [], team_members: [] };
buildWorkbook(x, true).then((b) => { writeFileSync(process.argv[2], Buffer.from(b)); console.log('ok'); });
