import { describe, expect, it } from 'vitest';
import { buildVCard, escapeVCardValue, foldVCardLine } from './vcard';

const entry = {
  full_name: 'Ivanov; Ivan, Ivanovich',
  position: 'Lead specialist',
  department: 'Monitoring department',
  department_location: 'Tyumen',
  employee_code: 'E-42',
  office_address: 'ул. Ленина, 1',
  work_phones: [
    { value: '8 (3452) 38-42-02', normalized: '73452384202' },
    { value: '8 (3452) 38-42-02', normalized: '73452384202' },
  ],
  personal_phones: [{ value: '+7 931 225-05-56', normalized: '79312250556' }],
  work_emails: [{ value: 'ivanov@zsgp.ru' }],
  personal_emails: [{ value: 'ivanov@home.example' }],
  // Fields that must never leak into the vCard payload.
  inn: '7200000000',
  age: 36,
  dismissal_date: '2024-01-31',
};

describe('buildVCard', () => {
  it('produces a vCard 3.0 document with CRLF separators', () => {
    const card = buildVCard(entry);
    expect(card.startsWith('BEGIN:VCARD\r\n')).toBe(true);
    expect(card.endsWith('END:VCARD\r\n')).toBe(true);
    expect(card).toContain('VERSION:3.0');
    expect(card).not.toContain('\n\n');
    // No bare LF — every line break is CRLF.
    expect(card.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('escapes semicolons, commas and backslashes', () => {
    expect(escapeVCardValue('a;b,c\\d')).toBe('a\\;b\\,c\\\\d');
    const card = buildVCard(entry);
    expect(card).toContain('FN:Ivanov\\; Ivan\\, Ivanovich');
    expect(card).toContain('ADR;TYPE=WORK:;;ул. Ленина\\, 1;;;;');
  });

  it('deduplicates phones and keeps both work and personal kinds', () => {
    const card = buildVCard(entry);
    expect(card.match(/TEL;TYPE=WORK:/g)).toHaveLength(1);
    expect(card).toContain('TEL;TYPE=CELL:+7 931 225-05-56');
    expect(card).toContain('EMAIL;TYPE=WORK:ivanov@zsgp.ru');
    expect(card).toContain('EMAIL;TYPE=INTERNET:ivanov@home.example');
  });

  it('does not include fields absent from the public payload contract', () => {
    const card = buildVCard(entry);
    expect(card).not.toContain('7200000000');
    expect(card).not.toContain('INN');
    expect(card).not.toContain('36');
    expect(card).not.toContain('2024-01-31');
  });

  it('returns an empty string for empty items and skips missing fields', () => {
    expect(buildVCard(null)).toBe('');
    expect(buildVCard({})).toBe('');
    const minimal = buildVCard({ full_name: 'Solo Person' });
    expect(minimal).toContain('FN:Solo Person');
    expect(minimal).not.toContain('TEL');
    expect(minimal).not.toContain('ADR');
  });

  it('R6: drops NOTE and keeps ORG equal to the department only', () => {
    const card = buildVCard(entry);
    expect(card).not.toContain('NOTE');
    expect(card).not.toContain('E-42');
    expect(card).toContain('ORG:Monitoring department');
    expect(card).not.toContain('ORG:Monitoring department;Tyumen');
  });

  it('R6: folds content lines at 75 octets without splitting UTF-8 sequences', () => {
    const encoder = new TextEncoder();
    const card = buildVCard({
      ...entry,
      full_name: 'Фёдорова Ёлка Ильинична',
      department: 'Отделение буровых работ с очень длинным наименованием подразделения',
      position: 'Ведущий специалист по мониторингу буровых установок и сопровождению',
    });
    // Every physical line (including folded continuations) ≤ 75 octets.
    card.split('\r\n').forEach((line) => {
      expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
    });
    // Unfolding must restore the original logical lines.
    const unfolded = card.replace(/\r\n /g, '');
    expect(unfolded).toContain('FN:Фёдорова Ёлка Ильинична');
    expect(unfolded).toContain(
      'ORG:Отделение буровых работ с очень длинным наименованием подразделения',
    );
    // A folded card still parses line-wise and ends with END:VCARD.
    expect(card).toContain('\r\n ');
    expect(unfolded.endsWith('END:VCARD\r\n')).toBe(true);
  });

  it('R6: foldVCardLine leaves short lines untouched and folds at byte boundary', () => {
    expect(foldVCardLine('FN:Ivanov')).toBe('FN:Ivanov');
    const long = `TITLE:${'x'.repeat(100)}`;
    const folded = foldVCardLine(long);
    const parts = folded.split('\r\n ');
    expect(parts.length).toBe(2);
    expect(new TextEncoder().encode(parts[0]).length).toBe(75);
    // Cyrillic chars are 2 octets — a 60-char line exceeds the limit in bytes.
    const cyrillic = `NOTE:${'Ё'.repeat(60)}`;
    const foldedCyrillic = foldVCardLine(cyrillic);
    foldedCyrillic.split('\r\n ').forEach((part) => {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    });
    expect(foldedCyrillic.replace(/\r\n /g, '')).toBe(cyrillic);
  });
});
