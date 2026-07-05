import { describe, expect, it, vi } from 'vitest';

import useChatOptimisticThreadMessages from './useChatOptimisticThreadMessages';

describe('useChatOptimisticThreadMessages', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatOptimisticThreadMessages).toBe('function');
  });

  it('createOptimisticTextMessage increments seq ref', async () => {
    const { renderHook } = await import('@testing-library/react');
    const optimisticMessageSeqRef = { current: 0 };

    const { result, unmount } = renderHook(() => useChatOptimisticThreadMessages({
      optimisticMessageSeqRef,
      user: { id: 1, username: 'alice', full_name: 'Alice' },
    }));

    const first = result.current.createOptimisticTextMessage({
      conversationId: 'c1',
      body: 'first',
    });
    const second = result.current.createOptimisticTextMessage({
      conversationId: 'c1',
      body: 'second',
    });

    expect(optimisticMessageSeqRef.current).toBe(2);
    expect(first?.body).toBe('first');
    expect(second?.body).toBe('second');
    expect(first?.id).not.toBe(second?.id);

    unmount();
  });

  it('mounts without throwing', async () => {
    const { renderHook } = await import('@testing-library/react');

    const { unmount } = renderHook(() => useChatOptimisticThreadMessages({
      optimisticMessageSeqRef: { current: 0 },
      user: { id: 1, username: 'alice' },
    }));

    unmount();
  });

  it('createOptimisticFileMessage increments seq ref', async () => {
    const { renderHook } = await import('@testing-library/react');
    const optimisticMessageSeqRef = { current: 0 };

    const { result, unmount } = renderHook(() => useChatOptimisticThreadMessages({
      optimisticMessageSeqRef,
      user: { id: 1, username: 'alice', full_name: 'Alice' },
    }));

    const message = result.current.createOptimisticFileMessage({
      conversationId: 'c1',
      files: [new File(['x'], 'a.txt', { type: 'text/plain' })],
      body: 'caption',
    });

    expect(optimisticMessageSeqRef.current).toBe(1);
    expect(message?.kind).toBe('file');
    expect(message?.attachments?.[0]?.file_name).toBe('a.txt');

    unmount();
  });

  it('revokeObjectUrls delegates to helper', async () => {
    const { renderHook } = await import('@testing-library/react');

    const { result, unmount } = renderHook(() => useChatOptimisticThreadMessages({
      optimisticMessageSeqRef: { current: 0 },
      user: { id: 1, username: 'alice' },
    }));

    expect(() => result.current.revokeObjectUrls(['blob:test'])).not.toThrow();

    unmount();
  });
});
