import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MAIL_AI_ENABLED_STORAGE_KEY } from './mailAiFlags';
import useMailAiConsentController from './useMailAiConsentController';

const createMemoryStorage = (initial = {}) => {
  const memory = { ...initial };
  return {
    memory,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null),
    setItem: (key, value) => {
      memory[key] = String(value);
    },
  };
};

describe('useMailAiConsentController', () => {
  it('starts opt-in off when storage and env are empty', () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useMailAiConsentController({
      storage,
      envValue: '',
      chipsEnabled: true,
    }));

    expect(result.current.mailAiEnabled).toBe(false);
    expect(result.current.mailAiConsentOpen).toBe(false);
    expect(result.current.mailAiSmartRepliesActive).toBe(false);
  });

  it('confirms consent, persists the flag and closes the dialog', () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useMailAiConsentController({
      storage,
      envValue: '',
      chipsEnabled: true,
    }));

    act(() => {
      result.current.openMailAiConsentDialog();
    });
    expect(result.current.mailAiConsentOpen).toBe(true);

    act(() => {
      result.current.confirmMailAiConsent();
    });

    expect(result.current.mailAiEnabled).toBe(true);
    expect(result.current.mailAiConsentOpen).toBe(false);
    expect(result.current.mailAiSmartRepliesActive).toBe(true);
    expect(storage.memory[MAIL_AI_ENABLED_STORAGE_KEY]).toBe('true');
  });

  it('cancels consent without enabling AI', () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useMailAiConsentController({
      storage,
      envValue: '',
      chipsEnabled: true,
    }));

    act(() => {
      result.current.openMailAiConsentDialog();
      result.current.closeMailAiConsentDialog();
    });

    expect(result.current.mailAiConsentOpen).toBe(false);
    expect(result.current.mailAiEnabled).toBe(false);
    expect(storage.memory[MAIL_AI_ENABLED_STORAGE_KEY]).toBeUndefined();
  });

  it('disables AI from settings and turns chips off', () => {
    const storage = createMemoryStorage({ [MAIL_AI_ENABLED_STORAGE_KEY]: 'true' });
    const { result } = renderHook(() => useMailAiConsentController({
      storage,
      envValue: '',
      chipsEnabled: true,
    }));

    expect(result.current.mailAiEnabled).toBe(true);
    expect(result.current.mailAiSmartRepliesActive).toBe(true);

    act(() => {
      result.current.handleMailAiEnabledChange(false);
    });

    expect(result.current.mailAiEnabled).toBe(false);
    expect(result.current.mailAiSmartRepliesActive).toBe(false);
    expect(storage.memory[MAIL_AI_ENABLED_STORAGE_KEY]).toBe('false');
  });

  it('keeps chips inactive when the smart-reply flag is off even if AI is enabled', () => {
    const storage = createMemoryStorage({ [MAIL_AI_ENABLED_STORAGE_KEY]: 'true' });
    const { result } = renderHook(() => useMailAiConsentController({
      storage,
      envValue: '',
      chipsEnabled: false,
    }));

    expect(result.current.mailAiEnabled).toBe(true);
    expect(result.current.mailAiSmartRepliesActive).toBe(false);
  });
});
