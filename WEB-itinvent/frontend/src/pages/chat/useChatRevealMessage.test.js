import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import useChatRevealMessage from './useChatRevealMessage';

it.each(['switch', 'unmount'])('stops a pending history reveal after %s', async (mode) => {
  const active = { current: 'A' };
  let resolve;
  const loadMessages = vi.fn(() => new Promise(r => { resolve = r; }));
  const scrollToMessage = vi.fn(() => false);
  const { result, unmount } = renderHook(() => useChatRevealMessage({
    activeConversationIdRef: active, loadMessages, messagesHasMoreRef: { current: true },
    messagesRef: { current: [{ id: 'oldest' }] }, revealMessageRef: { current: null }, scrollToMessage,
  }));
  let pending;
  act(() => { pending = result.current.revealMessage('target'); });
  if (mode === 'switch') active.current = 'B';
  else unmount();
  await act(async () => { resolve([{ id: 'older' }]); expect(await pending).toBe(false); });
  expect(loadMessages).toHaveBeenCalledExactlyOnceWith('A', expect.any(Object));
  expect(scrollToMessage).toHaveBeenCalledTimes(1);
});
