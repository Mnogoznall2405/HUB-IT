import { describe, expect, it } from 'vitest';
import { MAIL_HTML_SANDBOX_STORAGE_KEY, isMailHtmlSandboxEnabled, setMailHtmlSandboxEnabled } from './mailHtmlSandboxFlags';

describe('isMailHtmlSandboxEnabled', () => {
  it('defaults to off when env and storage are empty', () => {
    expect(isMailHtmlSandboxEnabled({
      storage: { getItem: () => null },
      envValue: '',
    })).toBe(false);
  });

  it('uses storage over env', () => {
    expect(isMailHtmlSandboxEnabled({
      storage: { getItem: () => 'true' },
      envValue: '0',
    })).toBe(true);
    expect(isMailHtmlSandboxEnabled({
      storage: { getItem: () => 'false' },
      envValue: '1',
    })).toBe(false);
  });

  it('uses env when storage is empty', () => {
    expect(isMailHtmlSandboxEnabled({
      storage: { getItem: () => '' },
      envValue: '1',
    })).toBe(true);
  });

  it('persists the flag', () => {
    const memory = {};
    const storage = {
      getItem: (key) => memory[key] ?? null,
      setItem: (key, value) => {
        memory[key] = String(value);
      },
    };

    expect(setMailHtmlSandboxEnabled(true, { storage })).toBe(true);
    expect(memory[MAIL_HTML_SANDBOX_STORAGE_KEY]).toBe('true');
    expect(isMailHtmlSandboxEnabled({ storage, envValue: '0' })).toBe(true);
    expect(setMailHtmlSandboxEnabled(false, { storage })).toBe(false);
    expect(isMailHtmlSandboxEnabled({ storage, envValue: '1' })).toBe(false);
  });
});
