// How a letter's text is laid out (D-134). The same reading is used on screen and in the PDF.
//   # Heading                  a section heading
//   === Annexure A – Title     starts a new page with a centred title
//   1. text / 1.1 text / (a)   a numbered clause with a hanging indent
//   - text                     a bullet
//   Label | Value              consecutive lines like this make a two-column table
//   anything else              a paragraph (a single line break inside it is kept)
export type Block =
  | { t: 'h'; text: string } | { t: 'title'; text: string } | { t: 'num'; n: string; text: string; level: number }
  | { t: 'bullet'; text: string } | { t: 'table'; rows: [string, string][] } | { t: 'p'; text: string };

export function parseLetter(body: string): Block[] {
  const out: Block[] = []; let para: string[] = []; let table: [string, string][] = [];
  const flushP = () => { if (para.length) { out.push({ t: 'p', text: para.join('\n') }); para = []; } };
  const flushT = () => { if (table.length) { out.push({ t: 'table', rows: table }); table = []; } };
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd(); let m: RegExpMatchArray | null;
    if (!line.trim()) { flushP(); flushT(); continue; }
    if ((m = line.match(/^(.{1,60}?)\s\|\s(.+)$/)) && !/^[-#=]/.test(line)) { flushP(); table.push([m[1].trim(), m[2].trim()]); continue; }
    flushT();
    if ((m = line.match(/^===\s*(.+)$/))) { flushP(); out.push({ t: 'title', text: m[1].trim() }); continue; }
    if ((m = line.match(/^#+\s+(.+)$/))) { flushP(); out.push({ t: 'h', text: m[1].trim() }); continue; }
    if ((m = line.match(/^\s*[-•]\s+(.+)$/))) { flushP(); out.push({ t: 'bullet', text: m[1] }); continue; }
    if ((m = line.match(/^\s*((?:\d+\.)+\d*|\d+\.|\([a-z]\)|\([ivx]+\))\s+(.+)$/))) { flushP(); out.push({ t: 'num', n: m[1], text: m[2], level: /^\(|\d+\.\d/.test(m[1]) ? 1 : 0 }); continue; }
    para.push(line);
  }
  flushP(); flushT();
  return out;
}
