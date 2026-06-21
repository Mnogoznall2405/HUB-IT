import { describe, expect, it } from 'vitest';
import { findDefaultPasswordExpiryOu, isDefaultPasswordExpiryOu } from './adOuTreeUtils';

describe('adOuTreeUtils', () => {
  it('matches Users standart label case-insensitively', () => {
    expect(isDefaultPasswordExpiryOu('Users standart')).toBe(true);
    expect(isDefaultPasswordExpiryOu('USERS STANDART')).toBe(true);
    expect(isDefaultPasswordExpiryOu('IT')).toBe(false);
  });

  it('finds default OU in domain children', () => {
    const found = findDefaultPasswordExpiryOu([
      { dn: 'OU=IT,DC=example,DC=local', label: 'IT' },
      { dn: 'OU=Users standart,DC=example,DC=local', label: 'Users standart' },
    ]);
    expect(found?.dn).toBe('OU=Users standart,DC=example,DC=local');
  });
});
