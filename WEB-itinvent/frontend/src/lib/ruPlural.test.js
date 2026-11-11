import { describe, expect, it } from 'vitest';

import { formatRuCount, ruPlural } from './ruPlural';

describe('ruPlural', () => {
  it('picks the one/few/many forms for typical counts', () => {
    expect(ruPlural(1, 'диалог', 'диалога', 'диалогов')).toBe('диалог');
    expect(ruPlural(2, 'диалог', 'диалога', 'диалогов')).toBe('диалога');
    expect(ruPlural(5, 'диалог', 'диалога', 'диалогов')).toBe('диалогов');
    expect(ruPlural(21, 'диалог', 'диалога', 'диалогов')).toBe('диалог');
    expect(ruPlural(11, 'диалог', 'диалога', 'диалогов')).toBe('диалогов');
    expect(formatRuCount(2, 'диалог', 'диалога', 'диалогов')).toBe('2 диалога');
  });
});
