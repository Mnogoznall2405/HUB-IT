import { describe, expect, it } from 'vitest';
import { normalizeComposeSubject } from './mailComposeSubject';

describe('normalizeComposeSubject', () => {
  it('adds reply prefix when needed', () => {
    expect(normalizeComposeSubject('reply', 'Тестовая тема')).toBe('Re: Тестовая тема');
  });

  it('does not duplicate reply prefix', () => {
    expect(normalizeComposeSubject('reply_all', 'Re: Тестовая тема')).toBe('Re: Тестовая тема');
  });

  it('adds forward prefix when needed', () => {
    expect(normalizeComposeSubject('forward', 'Тестовая тема')).toBe('Fwd: Тестовая тема');
  });

  it('uses fallback label for empty reply subject', () => {
    expect(normalizeComposeSubject('reply', '')).toBe('Re: (без темы)');
  });
});
