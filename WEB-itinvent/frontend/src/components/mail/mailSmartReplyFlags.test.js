import { describe, expect, it } from 'vitest';
import { isMailSmartReplyChipsEnabled } from './mailSmartReplyFlags';

describe('isMailSmartReplyChipsEnabled', () => {
  it('defaults to on when env and storage are empty', () => {
    expect(isMailSmartReplyChipsEnabled({
      storage: { getItem: () => null },
      envValue: '',
    })).toBe(true);
  });

  it('hides chips when storage flag is false', () => {
    expect(isMailSmartReplyChipsEnabled({
      storage: { getItem: () => 'false' },
      envValue: '1',
    })).toBe(false);
  });

  it('uses env when storage is empty', () => {
    expect(isMailSmartReplyChipsEnabled({
      storage: { getItem: () => '' },
      envValue: '0',
    })).toBe(false);
    expect(isMailSmartReplyChipsEnabled({
      storage: { getItem: () => null },
      envValue: '1',
    })).toBe(true);
  });
});
