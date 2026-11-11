import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailComposeDraftSavedAction from './useMailComposeDraftSavedAction';

describe('useMailComposeDraftSavedAction', () => {
  it('toasts and refreshes folder counts after saving a draft', async () => {
    const calls = [];
    const notifyMailSuccess = vi.fn(() => calls.push('toast'));
    const invalidateMailClientCache = vi.fn(() => calls.push('invalidate'));
    const refreshFolderSummary = vi.fn(async () => {
      calls.push('summary');
    });

    const { result } = renderHook(() => useMailComposeDraftSavedAction({
      notifyMailSuccess,
      invalidateMailClientCache,
      refreshFolderSummary,
    }));

    await result.current();

    expect(notifyMailSuccess).toHaveBeenCalledWith('Письмо сохранено в черновики.');
    expect(refreshFolderSummary).toHaveBeenCalledWith({ force: true });
    expect(calls).toEqual(['toast', 'invalidate', 'summary']);
  });
});
