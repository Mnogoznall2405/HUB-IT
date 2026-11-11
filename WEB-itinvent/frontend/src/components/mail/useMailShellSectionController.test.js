import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useMailShellSectionController, {
  MAIL_SHELL_SECTION_KEY,
  readStoredMailShellSection,
} from './useMailShellSectionController';

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

describe('useMailShellSectionController', () => {
  it('defaults to inbox when storage is empty or unknown', () => {
    expect(readStoredMailShellSection(createMemoryStorage())).toBe('inbox');
    expect(readStoredMailShellSection(createMemoryStorage({
      [MAIL_SHELL_SECTION_KEY]: 'settings',
    }))).toBe('inbox');
  });

  it('opens quotas only when the user can read quotas and persists the section', () => {
    const storage = createMemoryStorage();
    const { result, rerender } = renderHook(
      ({ canQuotasRead }) => useMailShellSectionController({ canQuotasRead, storage }),
      { initialProps: { canQuotasRead: true } },
    );

    expect(result.current.showQuotasSection).toBe(false);

    act(() => {
      result.current.handleMailShellSectionChange('quotas');
    });

    expect(result.current.mailShellSection).toBe('quotas');
    expect(result.current.showQuotasSection).toBe(true);
    expect(storage.memory[MAIL_SHELL_SECTION_KEY]).toBe('quotas');

    rerender({ canQuotasRead: false });
    expect(result.current.mailShellSection).toBe('quotas');
    expect(result.current.showQuotasSection).toBe(false);
  });

  it('restores quotas from session storage and returns to inbox', () => {
    const storage = createMemoryStorage({
      [MAIL_SHELL_SECTION_KEY]: 'quotas',
    });
    const { result } = renderHook(() => useMailShellSectionController({
      canQuotasRead: true,
      storage,
    }));

    expect(result.current.showQuotasSection).toBe(true);

    act(() => {
      result.current.handleMailShellSectionChange('other');
    });

    expect(result.current.mailShellSection).toBe('inbox');
    expect(result.current.showQuotasSection).toBe(false);
    expect(storage.memory[MAIL_SHELL_SECTION_KEY]).toBe('inbox');
  });

  it('stays on inbox when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const { result } = renderHook(() => useMailShellSectionController({
      canQuotasRead: true,
      storage,
    }));

    expect(result.current.mailShellSection).toBe('inbox');
    act(() => {
      result.current.handleMailShellSectionChange('quotas');
    });
    expect(result.current.mailShellSection).toBe('quotas');
  });
});
