import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mailAiAPI } from '../../api/mailAi';
import useMailMessageAi from './useMailMessageAi';

vi.mock('../../api/mailAi', () => ({
  mailAiAPI: {
    summarizeMessage: vi.fn(),
    getSmartReplies: vi.fn(),
  },
}));

describe('useMailMessageAi smart replies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes an abort signal and keeps chips for the selected message', async () => {
    mailAiAPI.getSmartReplies.mockResolvedValue({ suggestions: ['Ок, спасибо'] });
    const { result } = renderHook(() => useMailMessageAi({
      messageId: 'msg-a',
      mailboxId: 'mb-1',
      enabled: true,
    }));

    let suggestions;
    await act(async () => {
      suggestions = await result.current.loadSmartReplies();
    });

    expect(suggestions).toEqual(['Ок, спасибо']);
    expect(result.current.smartReplies).toEqual(['Ок, спасибо']);
    expect(mailAiAPI.getSmartReplies).toHaveBeenCalledTimes(1);
    expect(mailAiAPI.getSmartReplies.mock.calls[0][2]?.signal).toBeInstanceOf(AbortSignal);
    expect(mailAiAPI.getSmartReplies.mock.calls[0][2]?.signal.aborted).toBe(false);
  });

  it('aborts in-flight smart replies and ignores stale chips after switching messages', async () => {
    const onError = vi.fn();
    let resolveFirst;
    const firstSignalRef = { current: null };
    mailAiAPI.getSmartReplies.mockImplementation((_messageId, _mailboxId, options = {}) => {
      firstSignalRef.current = options.signal;
      return new Promise((resolve) => {
        resolveFirst = resolve;
      });
    });

    const { result, rerender } = renderHook(
      ({ messageId }) => useMailMessageAi({
        messageId,
        mailboxId: 'mb-1',
        enabled: true,
        onError,
      }),
      { initialProps: { messageId: 'msg-a' } },
    );

    act(() => {
      void result.current.loadSmartReplies();
    });

    expect(result.current.smartRepliesLoading).toBe(true);

    rerender({ messageId: 'msg-b' });

    expect(firstSignalRef.current?.aborted).toBe(true);
    expect(result.current.smartReplies).toEqual([]);
    expect(result.current.smartRepliesLoading).toBe(false);

    await act(async () => {
      resolveFirst({ suggestions: ['Чужой ответ для A'] });
    });

    expect(result.current.smartReplies).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.smartRepliesLoading).toBe(false);
  });

  it('does not treat an aborted smart-replies failure as a user-visible error', async () => {
    const onError = vi.fn();
    let rejectFirst;
    mailAiAPI.getSmartReplies.mockImplementation((_messageId, _mailboxId, options = {}) => (
      new Promise((_, reject) => {
        options.signal?.addEventListener('abort', () => {
          rejectFirst = reject;
        });
      })
    ));

    const { result, rerender } = renderHook(
      ({ messageId }) => useMailMessageAi({
        messageId,
        mailboxId: 'mb-1',
        enabled: true,
        onError,
      }),
      { initialProps: { messageId: 'msg-a' } },
    );

    act(() => {
      void result.current.loadSmartReplies();
    });

    rerender({ messageId: 'msg-b' });

    await act(async () => {
      rejectFirst?.(new Error('canceled'));
    });

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.smartReplies).toEqual([]);
  });

  it('does not fetch smart replies when AI is disabled', async () => {
    mailAiAPI.getSmartReplies.mockResolvedValue({ suggestions: ['Ок, спасибо'] });
    const { result } = renderHook(() => useMailMessageAi({
      messageId: 'msg-a',
      mailboxId: 'mb-1',
      enabled: false,
    }));

    let suggestions;
    await act(async () => {
      suggestions = await result.current.loadSmartReplies();
    });

    expect(suggestions).toEqual([]);
    expect(mailAiAPI.getSmartReplies).not.toHaveBeenCalled();
  });
});
