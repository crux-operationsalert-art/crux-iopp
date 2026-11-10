// Reads the text that OCR found on an ID card / bank proof and decides what the document is and what it says.
// Pure functions (no browser APIs) so they are unit-tested. Every number is checked: Aadhaar by its Verhoeff check
// digit, PAN by its fixed pattern, IFSC by its pattern, account numbers by length and position on the page.

export type Kind = 'aadhaar' | 'pan' | 'bank';
export type Detected = Kind | 'aadhaar_masked' | 'passport' | 'voter' | 'driving' | 'unknown';
export type Parsed = {
  detected: Detected; number?: string; name?: string; dob?: string; gender?: string; address?: string; pincode?: string;
  ifsc?: string; bank_name?: string; candidates?: string[]; hint?: Kind;
};

export const KIND_NAME: Record<Detected, string> = {
  aadhaar: 'Aadhaar card', pan: 'PAN card', bank: 'bank proof (cancelled cheque or passbook)', aadhaar_masked: 'masked Aadhaar',
  passport: 'Passport', voter: 'Voter ID card', driving: 'Driving licence', unknown: 'document',
};

// ----------------------------------------------------------------- Verhoeff (Aadhaar check digit)
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
export function verhoeffOk(s: string): boolean {
  if (!/^\d+$/.test(s)) return false;
  let c = 0; const a = s.split('').reverse().map(Number);
  for (let i = 0; i < a.length; i++) c = VD[c][VP[i % 8][a[i]]];
  return c === 0;
}
export const aadhaarOk = (s: string) => /^[2-9]\d{11}$/.test(s) && verhoeffOk(s);

// ----------------------------------------------------------------- OCR look-alike repair by position
const TO_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '4': 'A', '7': 'T' };
const TO_DIGIT: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', Z: '2', S: '5', B: '8', G: '6', T: '7', A: '4' };
const letter = (c: string) => (/[A-Z]/.test(c) ? c : TO_LETTER[c] ?? c);
const digit = (c: string) => (/\d/.test(c) ? c : TO_DIGIT[c] ?? c);
export const PAN_RE = /^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/;
/** A 10-character token read as a PAN, with O/0, I/1, S/5 … mix-ups corrected by position. */
export function fixPan(tok: string): string | null {
  const t = tok.toUpperCase().replace(/[^A-Z0-9|]/g, '');
  if (t.length !== 10) return null;
  const f = t.split('').map((c, i) => (i < 5 || i === 9 ? letter(c) : digit(c))).join('');
  return PAN_RE.test(f) ? f : null;
}
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function fixIfsc(tok: string): string | null {
  const t = tok.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (t.length !== 11) return null;
  const f = t.slice(0, 4).split('').map(letter).join('') + (t[4] === 'O' || t[4] === 'D' || t[4] === 'Q' ? '0' : t[4]) + t.slice(5);
  return IFSC_RE.test(f) ? f : null;
}

export const BANKS: Record<string, string> = {
  SBIN: 'State Bank of India', HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', PUNB: 'Punjab National Bank', BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank', UBIN: 'Union Bank of India', BKID: 'Bank of India', MAHB: 'Bank of Maharashtra', KKBK: 'Kotak Mahindra Bank', IDIB: 'Indian Bank',
  IOBA: 'Indian Overseas Bank', CBIN: 'Central Bank of India', UCBA: 'UCO Bank', YESB: 'Yes Bank', INDB: 'IndusInd Bank', IDFB: 'IDFC First Bank',
  FDRL: 'Federal Bank', KARB: 'Karnataka Bank', SIBL: 'South Indian Bank', PSIB: 'Punjab & Sind Bank', AUBL: 'AU Small Finance Bank', BDBL: 'Bandhan Bank',
  RATN: 'RBL Bank', DCBL: 'DCB Bank', JAKA: 'Jammu & Kashmir Bank', KVBL: 'Karur Vysya Bank', CIUB: 'City Union Bank', TMBL: 'Tamilnad Mercantile Bank',
  SVCB: 'SVC Co-operative Bank', COSB: 'Cosmos Bank', SRCB: 'Saraswat Bank', IBKL: 'IDBI Bank', ESFB: 'Equitas Small Finance Bank', UJVN: 'Ujjivan Small Finance Bank',
  AIRP: 'Airtel Payments Bank', PYTM: 'Paytm Payments Bank', IPOS: 'India Post Payments Bank', DBSS: 'DBS Bank', HSBC: 'HSBC', SCBL: 'Standard Chartered Bank',
  CITI: 'Citibank', DLXB: 'Dhanlaxmi Bank', NKGS: 'NKGSB Co-op Bank', APGB: 'Andhra Pragathi Grameena Bank', TJSB: 'TJSB Sahakari Bank', JSFB: 'Jana Small Finance Bank',
};

// ----------------------------------------------------------------- helpers
const lines = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
function dobOf(t: string): string | undefined {
  const m = t.match(/(\d{2})\s*[/\-.]\s*(\d{2})\s*[/\-.]\s*(\d{4})/);
  if (!m) return undefined;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1930 || y > 2015) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function nameLike(l: string) {
  const c = l.replace(/[^A-Za-z .]/g, '').replace(/\s+/g, ' ').trim();
  return c.length >= 4 && c.split(' ').length >= 2 && c.length / Math.max(l.length, 1) > 0.8
    && !/GOVERNMENT|INDIA|INCOME|TAX|DEPARTMENT|PERMANENT|ACCOUNT|NUMBER|SIGNATURE|FATHER|BIRTH|MALE|FEMALE|AADHAAR|UNIQUE|AUTHORITY|DOB|ADDRESS|BANK|BRANCH|PAY|CHEQUE|RUPEES|VALID/i.test(c) ? c : null;
}
/** 12-digit groups (4-4-4 or 12 together) that are not part of a 16-digit VID. */
function twelveDigitGroups(t: string): string[] {
  const out: string[] = [];
  for (const l of lines(t)) {
    const s = l.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
    const re = /(\d{4})[ \-]?(\d{4})[ \-]?(\d{4})/g; let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const before = s.slice(0, m.index), after = s.slice(m.index + m[0].length);
      if (/\d[ \-]?$/.test(before) || /^[ \-]?\d/.test(after)) continue;       // longer run: VID, account or phone
      out.push(m[1] + m[2] + m[3]);
    }
  }
  return out;
}

// ----------------------------------------------------------------- main parser
export function parseText(raw: string): Parsed {
  const t = raw.toUpperCase();
  const L = lines(raw);
  // other identity documents that are often uploaded by mistake
  if (/P<IND|\bPASSPORT\b/.test(t) && !/INCOME TAX/.test(t)) return { detected: 'passport' };
  if (/ELECTION COMMISSION|ELECTOR'?S? PHOTO|\bEPIC\b/.test(t)) return { detected: 'voter' };
  if (/DRIVING LICEN[CS]E|\bD\.?L\.? ?NO\b|TRANSPORT DEPARTMENT|UNION OF INDIA DRIVING/.test(t)) return { detected: 'driving' };

  const aadhaarWords = /AADHAAR|AADHAR|UNIQUE IDENTIFICATION|UIDAI|ENROL?MENT|\bVID\b|आधार|MERA AADHAAR/.test(t) || raw.includes('आधार');
  const panWords = /INCOME ?TAX|PERMANENT ?ACCOUNT|\bPAN\b/.test(t);
  const bankWords = /\bIFS ?C\b|IFSC|A\/C|ACCOUNT NO|\bSB\b|SAVINGS|PASSBOOK|CHEQUE|\bMICR\b|BRANCH|PAY\b|OR ORDER|OR BEARER/.test(t);

  // PAN: a valid 10-character token anywhere
  const panTok = t.split(/[\s:]+/).map(fixPan).find(Boolean) as string | undefined;
  if (panTok && (panWords || !aadhaarWords)) {
    const i = L.findIndex((l) => /NAME/i.test(l));
    const nm = (i >= 0 && L[i + 1] && nameLike(L[i + 1])) || L.map(nameLike).find(Boolean) || undefined;
    return { detected: 'pan', number: panTok, name: nm, dob: dobOf(raw) };
  }

  // Aadhaar
  const masked = /X{4}[ \-]?X{4}[ \-]?\d{4}/.test(t.replace(/[*]/g, 'X'));
  const groups = twelveDigitGroups(t);
  const valid = groups.find(aadhaarOk);
  if (valid || (aadhaarWords && !bankWords)) {
    if (!valid && masked) return { detected: 'aadhaar_masked' };
    const di = L.findIndex((l) => /DOB|D\.O\.B|YEAR OF BIRTH|जन्म/i.test(l));
    const nm = (di > 0 && (nameLike(L[di - 1]) || (di > 1 && nameLike(L[di - 2])))) || undefined;
    const g = /\bFEMALE\b|महिला/.test(t) ? 'female' : /\bMALE\b|पुरुष/.test(t) ? 'male' : /TRANSGENDER/.test(t) ? 'other' : undefined;
    const ai = L.findIndex((l) => /^ADDRESS|^ADDRESS:|पता/i.test(l));
    let address: string | undefined; let pincode: string | undefined;
    if (ai >= 0) {
      const chunk = L.slice(ai, ai + 6).join(', ').replace(/^ADDRESS:?\s*,?\s*/i, '').replace(/पता:?/g, '');
      const pm = chunk.match(/\b([1-9]\d{5})\b/);
      address = (pm ? chunk.slice(0, chunk.indexOf(pm[1]) + 6) : chunk).replace(/[^A-Za-z0-9,./\- ]/g, '').replace(/\s+/g, ' ').trim() || undefined;
      pincode = pm?.[1];
    }
    return { detected: 'aadhaar', number: valid, name: nm, dob: dobOf(raw), gender: g, address, pincode };
  }

  // Bank proof: IFSC + account number
  const ifsc = t.split(/[\s:.,]+/).map(fixIfsc).find(Boolean) as string | undefined;
  if (ifsc || bankWords) {
    const near: string[] = [], all: string[] = [];
    for (const l of L) {
      const u = l.toUpperCase();
      const runs = (u.replace(/[OQ]/g, '0').match(/\d[\d ]{7,22}\d/g) ?? []).map((x) => x.replace(/ /g, '')).filter((x) => x.length >= 9 && x.length <= 18);
      const isMicr = /[⑆⑈⑉]|MICR/.test(l) || /^\s*[⑆⑈"]?\d{6}[⑆⑈"]?\s+\d{9}/.test(l);
      for (const r of runs) {
        if (ifsc && ifsc.includes(r)) continue;
        if (isMicr) continue;
        if (/A\/C|ACCOUNT|A\/C NO|AC NO|SB A|\bSB\b|CA NO|NO\.?\s*:/.test(u)) near.push(r); else all.push(r);
      }
    }
    const uniq = [...new Set([...near, ...all])].filter((x) => !(x.length === 10 && /^[6-9]/.test(x) && !near.includes(x)));   // a 10-digit mobile number is not an account
    const nm = L.map((l) => (/A\/C HOLDER|NAME|PAY\b/i.test(l) ? null : nameLike(l))).find(Boolean) || undefined;
    return { detected: 'bank', ifsc, bank_name: ifsc ? BANKS[ifsc.slice(0, 4)] : undefined, number: near.length === 1 || uniq.length === 1 ? (near[0] ?? uniq[0]) : undefined,
             candidates: uniq.slice(0, 4), name: nm };
  }
  return { detected: 'unknown', hint: aadhaarWords ? 'aadhaar' : panWords ? 'pan' : undefined };
}

/** What to tell the person about this scan, given which document we asked for. */
export function verdict(expected: Kind, p: Parsed): { ok: true } | { ok: false; message: string; retake?: boolean } {
  const want = KIND_NAME[expected];
  if (p.detected === 'passport' || p.detected === 'voter' || p.detected === 'driving')
    return { ok: false, message: `This looks like a ${KIND_NAME[p.detected]}, not your ${want}. Upload your ${want}.` };
  if (expected === 'aadhaar' && p.detected === 'aadhaar_masked')
    return { ok: false, message: 'This is a masked Aadhaar (only the last 4 digits show). Upload the regular Aadhaar card or the e-Aadhaar PDF (not masked).' };
  if (p.detected !== 'unknown' && p.detected !== expected && !(expected === 'aadhaar' && p.detected === 'aadhaar_masked'))
    return { ok: false, message: `This looks like your ${KIND_NAME[p.detected]}, not your ${want}. Upload your ${want}.` };
  if (p.detected === 'unknown')
    return { ok: false, retake: true, message: `We could not read this as your ${want}. Take a clearer photo: card flat on a table, good light, no glare or shadow, the whole card in the frame, nothing covering the number. A PDF also works.` };
  if (expected === 'bank' && !p.ifsc)
    return { ok: false, retake: true, message: 'We could not read the IFSC code. Upload a cancelled cheque or the first page of your passbook where the IFSC and account number are printed clearly.' };
  if (!p.number && !(expected === 'bank' && p.candidates?.length))
    return { ok: false, retake: true, message: `We found your ${want} but could not read the number clearly. Take a closer, sharper photo of the side with the number (no glare).` };
  return { ok: true };
}

export const formatId = (k: Kind, n?: string) => (!n ? '' : k === 'aadhaar' ? n.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3') : n);
