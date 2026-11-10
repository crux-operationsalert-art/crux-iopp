// Document recognition from OCR text (synthetic card text; numbers are made up, the Aadhaar ones pass the checksum).
import { describe, expect, it } from 'vitest';
import { aadhaarOk, fixIfsc, fixPan, parseText, verdict } from '../web/src/lib/ocrParse';

const AADHAAR_FRONT = `भारत सरकार
GOVERNMENT OF INDIA
Ravi Kumar Sharma
DOB: 14/03/1991
MALE
2345 6789 0124
आधार - आम आदमी का अधिकार`;
const AADHAAR_BACK = `Unique Identification Authority of India
Address:
S/O Mohan Sharma, Flat 12, Shanti Nagar,
Kothrud, Pune, Maharashtra - 411038
2345 6789 0124
VID : 9134 5678 9012 3456`;
const PAN = `INCOME TAX DEPARTMENT GOVT. OF INDIA
Permanent Account Number Card
ABCPS1234F
Name
RAVI KUMAR SHARMA
Father's Name
MOHAN SHARMA
Date of Birth
14/03/1991`;
const CHEQUE = `STATE BANK OF INDIA
KOTHRUD BRANCH, PUNE
IFSC: SBIN0001234
PAY ________________ OR BEARER
A/c No. 3012 3456 7890
RAVI KUMAR SHARMA
⑈123456⑈ 411002003⑆ 000123⑈ 10`;
const PASSPORT = `REPUBLIC OF INDIA
PASSPORT
P<INDSHARMA<<RAVI<KUMAR<<<<<<<<<<<<<<<<<<<<<<
Z1234567<4IND9103145M3001010<<<<<<<<<<<<<<02`;

describe('ID document recognition (D-87)', () => {
  it('checks Aadhaar numbers with the Verhoeff digit and repairs PAN / IFSC look-alikes', () => {
    expect(aadhaarOk('234567890124')).toBe(true);
    expect(aadhaarOk('234567890125')).toBe(false);
    expect(aadhaarOk('034567890124')).toBe(false);
    expect(fixPan('ABCPS1234F')).toBe('ABCPS1234F');
    expect(fixPan('A8CPSI234F')).toBe('ABCPS1234F');      // 8→B in a letter place, I→1 in a digit place
    expect(fixPan('ABCPS123')).toBe(null);
    expect(fixPan('ABCQS1234F')).toBe(null);        // 4th letter must be a valid holder type
    expect(fixIfsc('SBINO001234')).toBe('SBIN0001234');   // letter O in the 5th place is a zero
  });
  it('reads an Aadhaar card front and back', () => {
    const f = parseText(AADHAAR_FRONT);
    expect(f).toMatchObject({ detected: 'aadhaar', number: '234567890124', dob: '1991-03-14', gender: 'male', name: 'Ravi Kumar Sharma' });
    expect(verdict('aadhaar', f)).toEqual({ ok: true });
    const b = parseText(AADHAAR_BACK);
    expect(b).toMatchObject({ detected: 'aadhaar', number: '234567890124', pincode: '411038' });
    expect(b.address).toMatch(/Shanti Nagar.*411038/);
  });
  it('does not take the 16-digit VID or a bad check digit as the Aadhaar number', () => {
    const p = parseText(`Unique Identification Authority of India\nVID : 9134 5678 9012 3456\n2345 6789 0125`);
    expect(p.number).toBeUndefined();
    expect(verdict('aadhaar', p)).toMatchObject({ ok: false, retake: true });
  });
  it('rejects a masked Aadhaar', () => {
    const p = parseText(`GOVERNMENT OF INDIA\nAadhaar\nXXXX XXXX 0124`);
    expect(p.detected).toBe('aadhaar_masked');
    expect(verdict('aadhaar', p)).toMatchObject({ ok: false, message: expect.stringMatching(/masked/) });
  });
  it('reads a PAN card', () => {
    const p = parseText(PAN);
    expect(p).toMatchObject({ detected: 'pan', number: 'ABCPS1234F', name: 'RAVI KUMAR SHARMA', dob: '1991-03-14' });
  });
  it('reads a cancelled cheque: IFSC, bank and account number, ignoring the MICR line', () => {
    const p = parseText(CHEQUE);
    expect(p).toMatchObject({ detected: 'bank', ifsc: 'SBIN0001234', bank_name: 'State Bank of India', number: '301234567890' });
    expect(verdict('bank', p)).toEqual({ ok: true });
  });
  it('tells the person when the wrong document is uploaded or it cannot be read', () => {
    expect(verdict('aadhaar', parseText(PASSPORT))).toMatchObject({ ok: false, message: expect.stringMatching(/Passport, not your Aadhaar/) });
    expect(verdict('aadhaar', parseText(PAN))).toMatchObject({ ok: false, message: expect.stringMatching(/PAN card, not your Aadhaar/) });
    expect(verdict('pan', parseText(AADHAAR_FRONT))).toMatchObject({ ok: false, message: expect.stringMatching(/Aadhaar card, not your PAN/) });
    expect(verdict('bank', parseText('blurry ~~ ## ..'))).toMatchObject({ ok: false, retake: true });
    expect(verdict('pan', parseText(`ELECTION COMMISSION OF INDIA\nIDENTITY CARD`))).toMatchObject({ ok: false, message: expect.stringMatching(/Voter ID/) });
  });
  it('reads an old-format PAN with stray characters around the number (as OCR gives it on a worn card)', () => {
    const p = parseText(`TTIH fam it Hd dF
INCOMETAXDEPARTMENT ~~ ¢:  GOVT. OF INDIA
RAVI KUMAR SHARMA

KUMAR MOHAN SHARMA

14/03/1991

cABCaPS1234F ™

hide,
atu 4 h`);
    expect(p).toMatchObject({ detected: 'pan', number: 'ABCPS1234F', name: 'RAVI KUMAR SHARMA', dob: '1991-03-14' });
  });
  it('reads a cheque where the IFSC label is noisy and the A/C label is lost', () => {
    const p = parseText(`AXIS BANK - we
IFS CODE - UTIB0003723 © DDMMYYYY
Pay CRUX RISK MANAGEMENT PVT LTD OR BEARER
H [remo] | 912345678901234 |
F DBEZY 000160 : |
RAVI KUMAR SHARMA |
Payable at par at all branches of Axis Bank Ltd in India. Please sign above
*LLOOE3 LLL2LeOB3 OOOREONE 33 |`);
    expect(p).toMatchObject({ detected: 'bank', ifsc: 'UTIB0003723', bank_name: 'Axis Bank', number: '912345678901234' });
    expect(verdict('bank', p)).toEqual({ ok: true });
    expect(parseText('IFS CODE - LITIB0003723\nOR BEARER').ifsc).toBe('UTIB0003723');      // "U" read as "LI"
  });
  it('does not invent a PAN from cheque or Aadhaar text', () => {
    expect(parseText(`IFSC SBIN0001234\nOR BEARER\nA/c No. 301234567890\nABCDE12345XYZ`).detected).toBe('bank');
    expect(parseText(`GOVERNMENT OF INDIA\nRavi Kumar Sharma\nDOB: 14/03/1991\nMALE\n2345 6789 0124`).detected).toBe('aadhaar');
  });
});
