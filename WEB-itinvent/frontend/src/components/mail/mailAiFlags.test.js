import { describe, expect, it } from 'vitest';
import { MAIL_AI_ENABLED_STORAGE_KEY, isMailAiEnabled, setMailAiEnabled } from './mailAiFlags';

describe('isMailAiEnabled', () => {
  it('defaults to opt-in off when env and storage are empty', () => {
    expect(isMailAiEnabled({
      storage: { getItem: () => null },
      envValue: '',
    })).toBe(false);
  });

  it('uses storage over env', () => {
    expect(isMailAiEnabled({
      storage: { getItem: () => 'true' },
      envValue: '0',
    })).toBe(true);
    expect(isMailAiEnabled({
      storage: { getItem: () => 'false' },
      envValue: '1',
    })).toBe(false);
  });

  it('uses env when storage is empty', () => {
    expect(isMailAiEnabled({
      storage: { getItem: () => '' },
      envValue: '1',
    })).toBe(true);
    expect(isMailAiEnabled({
      storage: { getItem: () => null },
      envValue: '0',
    })).toBe(false);
  });

  it('persists the user toggle', () => {
    const memory = {};
    const storage = {
      getItem: (key) => memory[key] ?? null,
      setItem: (key, value) => {
        memory[key] = String(value);
      },
    };

    expect(setMailAiEnabled(true, { storage })).toBe(true);
    expect(memory[MAIL_AI_ENABLED_STORAGE_KEY]).toBe('true');
    expect(isMailAiEnabled({ storage, envValue: '0' })).toBe(true);
    expect(setMailAiEnabled(false, { storage })).toBe(false);
    expect(isMailAiEnabled({ storage, envValue: '1' })).toBe(false);
  });
});
