// Need help answers and routing, and the ? notes (D-102).
import { describe, expect, it } from 'vitest';
import { findAnswers, forPeople, guessDesk, sectionHelp } from '../web/src/lib/help';

describe('Need help', () => {
  it('answers app questions from the guide', () => {
    expect(findAnswers('how to apply leave')[0].q).toBe('How do I apply for leave?');
    expect(findAnswers('how to apply leave').map((f) => f.q)).not.toContain('How do I install the app?');
    expect(findAnswers('how do i correct a sent figure')[0].q).toBe('I made a mistake after sending');
    expect(findAnswers('I forgot password')[0].q).toMatch(/password/);
    expect(findAnswers('notifications not coming')[0].q).toMatch(/notifications/);
  });
  it('sends people questions to the right desk', () => {
    expect([forPeople('my salary bill reimbursement is pending with accounts'), guessDesk('my salary bill reimbursement is pending with accounts')]).toEqual([true, 'finance']);
    expect(guessDesk('when will my salary be credited')).toBe('hr');
    expect(guessDesk('client portal allocation of field visits is delayed')).toBe('ops');
    expect(forPeople('how do I install app on iphone')).toBe(false);
  });
  it('has a ? note for page and section titles', () => {
    expect(sectionHelp('My day')).toMatch(/daily update/);
    expect(sectionHelp('Police verification — 3 of 5 done')).toMatch(/Compulsory/);
    expect(sectionHelp('Something unknown')).toBeNull();
  });
});
