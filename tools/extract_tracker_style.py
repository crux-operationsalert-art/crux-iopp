"""Extract the visual style (fills, fonts, number formats, borders, widths) of the Zonal Tracker's
Main Tracker sheet into a JSON spec. No business data is copied: only formatting of sample rows."""
import json, sys, openpyxl
from openpyxl.utils import get_column_letter as L

SAMPLES = {  # row kind -> sample row number in the 30-Oct tracker
  'title': 1, 'zone_header_single': 2, 'header': 3, 'leaf_single': 122, 'leaf_alt': 6, 'zone_total_single': 142,
  'zone_header': 16, 'zone_client': 18, 'zone_total': 28, 'leaf': 42, 'loc_total': 52, 'zone_total_alt': 218,
  'zone_ab': 528, 'nsew': 530, 'roi': 534, 'pan': 535,
  'cw_title': 538, 'cw_header': 539, 'cw_row': 541, 'cw_total': 582, 'sh_title': 587, 'sh_header': 588, 'sh_row': 589, 'sh_total': 594,
}
COLS = [L(c) for c in range(1, 22)]  # A..U (current block + first history month block S,T,U)

def color(c):
    if c is None: return None
    if c.type == 'rgb' and isinstance(c.rgb, str): return c.rgb[-6:]
    if c.type == 'theme': return {'theme': c.theme, 'tint': round(c.tint or 0, 2)}
    return None

def side(s):
    return None if not s or not s.style else {'style': s.style, 'color': color(s.color) or '000000'}

def cell_style(c):
    f = c.font
    return {
      'fill': color(c.fill.fgColor) if c.fill and c.fill.fill_type == 'solid' else None,
      'font': {'b': bool(f.b), 'i': bool(f.i), 'sz': f.sz, 'name': f.name, 'color': color(f.color)},
      'numFmt': c.number_format,
      'align': {'h': c.alignment.horizontal, 'v': c.alignment.vertical, 'wrap': bool(c.alignment.wrap_text)},
      'border': {k: side(getattr(c.border, k)) for k in ('left', 'right', 'top', 'bottom')},
    }

wb = openpyxl.load_workbook(sys.argv[1]); ws = wb['Main Tracker']
spec = {'widths': {k: round(v.width, 1) for k, v in ws.column_dimensions.items() if k in COLS or k in ('S', 'T', 'U')},
        'rows': {}}
for kind, r in SAMPLES.items():
    spec['rows'][kind] = {'height': ws.row_dimensions[r].height, 'cells': {col: cell_style(ws[f'{col}{r}']) for col in COLS}}
json.dump(spec, open(sys.argv[2], 'w'), indent=1)
print('kinds', len(spec['rows']))
