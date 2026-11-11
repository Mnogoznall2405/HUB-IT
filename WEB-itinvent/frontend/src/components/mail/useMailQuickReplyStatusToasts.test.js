import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailQuickReplyStatusToasts from './useMailQuickReplyStatusToasts';

describe('useMailQuickReplyStatusToasts', () => {
  it('announces sending and sent with the existing copy', () => {
    const notifyMailInfo = vi.fn();
    const notifyMailSuccess = vi.fn();
    const { result } = renderHook(() => useMailQuickReplyStatusToasts({
      notifyMailInfo,
      notifyMailSuccess,
    }));

    result.current.handleQuickReplySendingStart();
    result.current.handleQuickReplySent();

    expect(notifyMailInfo).toHaveBeenCalledWith('Письмо отправляется…', {
      dedupeKey: 'mail-quick-reply:sending',
      durationMs: 4000,
    });
    expect(notifyMailSuccess).toHaveBeenCalledWith('Письмо отправлено.');
  });
});
