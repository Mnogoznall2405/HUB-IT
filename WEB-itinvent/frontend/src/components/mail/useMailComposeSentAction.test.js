import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailComposeSentAction from './useMailComposeSentAction';

describe('useMailComposeSentAction', () => {
  it('closes compose, toasts, and refreshes mail data', async () => {
    const calls = [];
    const closeComposeSession = vi.fn(() => calls.push('close'));
    const notifyMailSuccess = vi.fn(() => calls.push('toast'));
    const invalidateMailClientCache = vi.fn(() => calls.push('invalidate'));
    const refreshList = vi.fn(async () => {
      calls.push('list');
    });
    const refreshFolderSummary = vi.fn(async () => {
      calls.push('summary');
    });

    const { result } = renderHook(() => useMailComposeSentAction({
      closeComposeSession,
      notifyMailSuccess,
      invalidateMailClientCache,
      refreshList,
      refreshFolderSummary,
    }));

    await result.current();

    expect(notifyMailSuccess).toHaveBeenCalledWith('Письмо отправлено.');
    expect(refreshList).toHaveBeenCalledWith({ silent: true, force: true });
    expect(calls).toEqual(['close', 'toast', 'invalidate', 'list', 'summary']);
  });
});
