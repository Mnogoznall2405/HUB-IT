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

it('pages forward with after_message_id when the target is newer than the loaded window', async () => {
  const active = { current: 'A' };
  const messagesRef = { current: [{ id: 'tail-old' }] };
  const hasNewer = { current: true };
  const loadMessages = vi.fn(async () => {
    messagesRef.current = [...messagesRef.current, { id: 'target' }];
    hasNewer.current = false;
    return [{ id: 'target' }];
  });
  const scrollToMessage = vi.fn((id) => (id === 'target' && messagesRef.current.some((m) => m.id === 'target')));
  const { result } = renderHook(() => useChatRevealMessage({
    activeConversationIdRef: active, loadMessages, messagesHasMoreRef: { current: false },
    messagesHasNewerRef: hasNewer, messagesRef, revealMessageRef: { current: null }, scrollToMessage,
  }));
  let found;
  await act(async () => { found = await result.current.revealMessage('target'); });
  expect(found).toBe(true);
  expect(loadMessages).toHaveBeenCalledExactlyOnceWith('A', expect.objectContaining({ afterMessageId: 'tail-old' }));
});
