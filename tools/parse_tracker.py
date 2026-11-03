"""Parse a Live Zonewise Monthly Business Tracker workbook into import rows (facts, rates, exceptions).

Usage: python3 -I tools/parse_tracker.py <tracker.xlsx> <out.json> [first_month=2026-02-01]
Nothing is invented: values are copied as recorded. A rate is proposed only when Revenue Tgt / Target (or
Actual Revenue / Actual) is a whole rupee amount and both agree; anything else becomes an exception.
"""
import itertools, json, re, sys
from collections import Counter, defaultdict
import openpyxl

MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}

def month_of(header):
    h = str(header).lower().replace('\n', ' ')
    m = re.search(r'(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*\'?\s*(\d{2})\b', h)
    return f'20{m.group(2)}-{MONTHS[m.group(1)]:02d}-01' if m else None

def num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

def main(src, out, first_month='2026-02-01'):
    wb = openpyxl.load_workbook(src, data_only=True, read_only=True)
    rows = list(wb['Main Tracker'].iter_rows(values_only=True))
    hdr = rows[2]
    as_of = None
    for v in hdr:
        if isinstance(v, str) and re.match(r'\d{2}\.\d{2}\.\d{4}', v.strip()):
            d, mth, y = v.strip().split('.'); as_of = f'{y}-{mth}-{d}'
    cur_month = as_of[:8] + '01'

    # Month blocks: (cases col, revenue col, billing col, kind)
    blocks = [{'month': cur_month, 'cases': 4, 'target': 3, 'rev': 6, 'rev_t': 5, 'bill': None, 'as_of': as_of, 'cols': 'D,E,F,G'}]
    for c in range(17, 90):
        h = ' '.join(str(hdr[c] or '').split())
        if h.startswith('Actual Billing'):
            mth = month_of(h)
            if not mth or mth < '2025-01-01':
                continue
            prev2, prev1 = ' '.join(str(hdr[c - 2] or '').split()), ' '.join(str(hdr[c - 1] or '').split())
            actual = prev2.startswith('Actual MTD')
            blocks.append({'month': mth, 'cases': c - 2 if actual else None, 'target': None if actual else c - 2,
                           'rev': c - 1 if actual else None, 'rev_t': None if actual else c - 1, 'bill': c, 'as_of': None,
                           'cols': ','.join(openpyxl.utils.get_column_letter(x + 1) for x in (c - 2, c - 1, c))})

    # Segments: consecutive data rows ending with a "Total ..." row, grouped under zone headers.
    headers, cur, seg = [], {'name': str(rows[1][0]).strip(), 'segs': []}, []
    pan = None; regions = {}
    for i in range(3, len(rows)):
        r = rows[i]; a = r[0]
        if not isinstance(a, str):
            continue
        a = a.strip()
        if a == 'Pan India':
            pan = i; break
        if a in ('North Zone', 'South Zone', 'East Zone', 'West Zone'):
            regions[a.replace(' Zone', '')] = num(r[3]); continue
        if a.lower().startswith('total'):
            if seg:
                cur['segs'].append({'label': seg[0][1][0].strip(), 'rows': seg, 'total': i}); seg = []
            continue
        if r[1] is None and r[3] is None:
            headers.append(cur); cur = {'name': a, 'segs': []}; continue
        if r[1] is not None and num(r[3]) is not None:
            seg.append((i, r))
    headers.append(cur)

    def seg_total(s, col):
        return sum(num(r[col]) or 0 for _, r in s['rows'])

    leaves = []   # (zone, location, segment)
    summaries = []  # (zone, summary segment, child segments)
    for h in headers:
        ss = h['segs']
        if not ss:
            continue
        if len(ss) > 1 and abs(seg_total(ss[0], 3) - sum(seg_total(s, 3) for s in ss[1:])) < 0.5 \
                and abs(seg_total(ss[0], 4) - sum(seg_total(s, 4) for s in ss[1:])) < 0.5:
            leaves += [(h['name'], s['label'], s) for s in ss[1:]]          # first block is the zone summary
            summaries.append((h['name'], ss[0], ss[1:]))
        else:
            leaves.append((h['name'], ss[0]['label'], ss[0]))
            leaves += [(s['label'], s['label'], s) for s in ss[1:]]         # standalone zones without a header

    # Regions: the unique assignment of zones to the four region rows that matches target, actual, revenue
    # target and actual revenue simultaneously (one column alone is ambiguous).
    zsum = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
    for z, _, s in leaves:
        for _, r in s['rows']:
            for k, c in enumerate((3, 4, 5, 6)):
                zsum[z][k] += num(r[c]) or 0
    zones = list(zsum)
    reg_tot = {}
    for i in range(3, len(rows)):
        a = rows[i][0]
        if isinstance(a, str) and a.strip() in ('North Zone', 'South Zone', 'East Zone', 'West Zone'):
            reg_tot[a.strip().replace(' Zone', '')] = [num(rows[i][c]) or 0 for c in (3, 4, 5, 6)]
    cands = {reg: [set(c) for k in range(1, len(zones) + 1) for c in itertools.combinations(zones, k)
                   if all(abs(sum(zsum[z][j] for z in c) - tot[j]) < 0.5 for j in range(4))] for reg, tot in reg_tot.items()}
    region_of = {}
    sols = [combo for combo in itertools.product(*cands.values())
            if sum(len(x) for x in combo) == len(zones) and set().union(*combo) == set(zones)] if cands else []
    if len(sols) == 1:
        for reg, zs in zip(cands, sols[0]):
            for z in zs:
                region_of[z] = reg
    zone_t = {z: v[0] for z, v in zsum.items()}

    # Canonical client names (case-insensitive merge, most frequent spelling wins).
    spell = defaultdict(Counter)
    for _, _, s in leaves:
        for _, r in s['rows']:
            spell[str(r[1]).strip().lower()][str(r[1]).strip()] += 1
            if r[16] is not None:
                spell[str(r[16]).strip().lower()][str(r[16]).strip()] += 1
    canon = {k: v.most_common(1)[0][0] for k, v in spell.items()}

    hist_index = {}
    for i in range(3, len(rows)):
        a, b = rows[i][15], rows[i][16]
        if isinstance(a, str) and b is not None:
            hist_index.setdefault((a.strip().lower(), str(b).strip().lower()), i)
    out_rows, exceptions, n = [], [], 0
    agg = {}
    for z, loc, s in leaves:
        for i, r in s['rows']:
            client = canon[str(r[1]).strip().lower()]
            if str(r[1]).strip() != client:
                exceptions.append({'issue': 'client name spelling merged', 'location': loc, 'as_written': str(r[1]).strip(), 'merged_into': client, 'source_row': i + 1})
            # History columns sit on the same row but carry their own location/client labels (cols P/Q);
            # record history under those labels exactly as written.
            hclient = canon[str(r[16]).strip().lower()] if r[16] is not None else None
            if hclient is not None and hclient != client:
                exceptions.append({'issue': 'history recorded under a different client label on the same row', 'location': loc,
                                   'current_client': client, 'history_client': hclient, 'source_row': i + 1})
            for b in blocks:
                src = r
                cl_name = client if b is blocks[0] else hclient
                if cl_name is None:
                    continue
                vals = {k: (num(src[b[c]]) if b[c] is not None else None) for k, c in
                        (('actual_cases', 'cases'), ('target_cases', 'target'), ('actual_revenue', 'rev'), ('revenue_target', 'rev_t'), ('billing_amount', 'bill'))}
                if all(v in (None, 0) for v in vals.values()):
                    continue
                key = (b['month'], loc, cl_name)
                if key in agg:     # duplicate after spelling merge: add up, keep provenance
                    for k, v in vals.items():
                        if v is not None:
                            agg[key][k] = (agg[key][k] or 0) + v
                    agg[key]['source_columns'] += f';row {i + 1}'
                    continue
                agg[key] = {'zone': z, 'region': region_of.get(z), 'location': loc, 'client': cl_name, 'month': b['month'],
                            'as_of': b['as_of'], **vals, 'source_row': i + 1, 'source_columns': b['cols']}
            # Rate proposal from the current month.
            t, a, rt, ra = num(r[3]) or 0, num(r[4]) or 0, num(r[5]) or 0, num(r[6]) or 0
            rates = [x for x in ((rt / t) if t else None, (ra / a) if a else None) if x is not None]
            if not rates:
                continue
            if any(abs(x - round(x)) > 0.01 for x in rates) or (len(rates) == 2 and abs(rates[0] - rates[1]) > 0.5):
                exceptions.append({'issue': 'no single per-case rate (blended or inconsistent)', 'location': loc, 'client': client,
                                   'target_rate': round(rates[0], 2), 'actual_rate': round(rates[-1], 2), 'source_row': i + 1})
            else:
                out_rows.append({'kind': 'rate', 'payload': {'location': loc, 'client': client, 'rate': round(rates[0]),
                                 'valid_from': cur_month, 'basis': f'{cur_month[:7]} revenue target ÷ target cases (row {i + 1})'}})
    # Months recorded only at zone level (before the zone was split into locations): keep the remainder
    # (zone summary row − sum of its location rows) as a clearly labelled zone-level fact. Never spread it.
    for z, summ, kids in summaries:
        for i, r in summ['rows']:
            if r[16] is None:
                continue
            client = canon[str(r[16]).strip().lower()]
            for b in blocks[1:]:
                vals = {}
                for k, c in (('actual_cases', 'cases'), ('target_cases', 'target'), ('actual_revenue', 'rev'), ('revenue_target', 'rev_t'), ('billing_amount', 'bill')):
                    col = b[c]
                    if col is None:
                        vals[k] = None; continue
                    zv = num(r[col]) or 0
                    kv = sum(num(kr[col]) or 0 for kid in kids for _, kr in kid['rows']
                             if kr[16] is not None and str(kr[16]).strip().lower() == str(r[16]).strip().lower())
                    vals[k] = round(zv - kv, 2) if abs(zv - kv) >= 0.01 else None
                if all(v is None for v in vals.values()):
                    continue
                loc = f'{z} — zone level (not split by location)'
                key = (b['month'], loc, client)
                if key in agg:
                    for k, v in vals.items():
                        if v is not None: agg[key][k] = (agg[key][k] or 0) + v
                    continue
                agg[key] = {'zone': z, 'region': region_of.get(z), 'location': loc, 'zone_level': True, 'client': client,
                            'month': b['month'], 'as_of': None, **vals, 'source_row': i + 1, 'source_columns': b['cols'] + ' (zone summary − locations)'}
    facts = [{'kind': 'fact', 'payload': p} for p in agg.values()]
    held_back = sorted({f['payload']['month'] for f in facts if f['payload']['month'] < first_month})
    facts = [f for f in facts if f['payload']['month'] >= first_month]
    # De-duplicate rate proposals (merged spellings) keeping the first.
    seen, rates_u = set(), []
    for r in out_rows:
        k = (r['payload']['location'], r['payload']['client'])
        if k not in seen:
            seen.add(k); rates_u.append(r)

    # Reconciliation: every month/column vs the Pan India row.
    recon = []
    for b in blocks:
        for name in ('cases', 'target', 'rev', 'rev_t', 'bill'):
            c = b[name]
            if c is None:
                continue
            meas = {'cases': 'actual_cases', 'target': 'target_cases', 'rev': 'actual_revenue', 'rev_t': 'revenue_target', 'bill': 'billing_amount'}[name]
            leaf_sum = sum(f['payload'][meas] or 0 for f in facts if f['payload']['month'] == b['month'])
            pan_v = num(rows[pan][c]) or 0
            recon.append({'month': b['month'], 'column': openpyxl.utils.get_column_letter(c + 1), 'measure': name,
                          'leaf_sum': round(leaf_sum, 2), 'pan_india': round(pan_v, 2), 'difference': round(leaf_sum - pan_v, 2)})
    if held_back:
        exceptions.append({'issue': 'months not imported: location rows explain only part of the Pan India total',
                           'months': held_back, 'detail': 'See batch reconciliation; source likely the "Old Tracker till Feb 2026" sheet'})
    for x in recon:
        if x['month'] >= first_month and abs(x['difference']) >= 1:
            exceptions.append({'issue': 'imported column does not equal the tracker Pan India row', **x})
    allrows = facts + rates_u + [{'kind': 'exception', 'payload': e} for e in exceptions]
    for k, r in enumerate(allrows, 1):
        r['row_no'] = k
    summary = {'as_of': as_of, 'zones': sorted(set(z for z, _, _ in leaves)), 'region_of': region_of,
               'leaves': len(leaves), 'facts': len(facts), 'rates': len(rates_u), 'exceptions': len(exceptions),
               'months': sorted({b['month'] for b in blocks}), 'reconciliation': recon}
    json.dump({'summary': summary, 'rows': allrows}, open(out, 'w'))
    print(json.dumps({k: v for k, v in summary.items() if k not in ('reconciliation', 'months')}, indent=1))
    print('zone totals', {z: zone_t[z] for z in zones}, 'regions', regions)
    bad = [x for x in recon if abs(x['difference']) >= 1]
    print('reconciliation lines:', len(recon), 'with difference >= 1:', len(bad))
    for x in bad[:20]:
        print('  ', x)

if __name__ == '__main__':
    main(*sys.argv[1:4])
