import { describe, expect, it } from 'vitest';
import { getMailPersonDisplay, getMailPersonEmail } from './mailPeople';

describe('mailPeople', () => {
  it('getMailPersonDisplay uses fallback for empty person object', () => {
    expect(getMailPersonDisplay({ display: null, email: null, name: null }, '-')).toBe('-');
    expect(getMailPersonDisplay({ display: '', email: '' }, 'fallback')).toBe('fallback');
  });

  it('getMailPersonDisplay still resolves populated person objects', () => {
    expect(getMailPersonDisplay({ email: 'a@b.co' }, '-')).toBe('a@b.co');
    expect(getMailPersonDisplay({ display: 'Name', email: 'a@b.co' }, '-')).toBe('Name');
  });

  it('getMailPersonEmail returns empty string for empty person object', () => {
    expect(getMailPersonEmail({})).toBe('');
    expect(getMailPersonEmail({ email: null })).toBe('');
  });
});
