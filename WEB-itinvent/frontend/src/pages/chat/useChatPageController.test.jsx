import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./useChatThreadController', () => ({ default: () => ({}) }));
vi.mock('./useChatConversationsController', () => ({ default: () => ({}) }));
vi.mock('./useChatFoldersController', () => ({ default: () => ({}) }));
vi.mock('./useChatAiController', async () => {
  const { useState } = await import('react');
  return { default: function useMockAi() { return { state: useState('ai') }; } };
});
vi.mock('./useChatDraftsAndPinned', async () => {
  const { useState } = await import('react');
  return { default: function useMockDrafts() { const [draft, setDraft] = useState(''); return { draft, setDraft }; } };
});

import useChatPageController from './useChatPageController';

describe('chat controller permission changes', () => {
  it('preserves the draft when AI permissions appear and disappear', () => {
    const { result, rerender } = renderHook(({ enabled }) => useChatPageController({
      thread: {}, conversations: {}, folders: {}, drafts: {},
      ai: enabled ? { canUseAiChat: true } : undefined,
    }), { initialProps: { enabled: false } });
    act(() => result.current.drafts.setDraft('Новый черновик'));
    rerender({ enabled: true });
    expect(result.current.drafts.draft).toBe('Новый черновик');
    rerender({ enabled: false });
    expect(result.current.drafts.draft).toBe('Новый черновик');
  });
});
