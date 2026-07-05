import { describe, expect, it, vi } from 'vitest';

import {
  bootLoadAiBots,
  bootLoadConversationsAndFolders,
  buildChatInitDebugPayload,
  CHAT_PAGE_THREAD_POLL_MS,
  logChatInitDebug,
} from './useChatPageBootEffects';
import useChatPageBootEffects from './useChatPageBootEffects';

describe('useChatPageBootEffects helpers', () => {
  it('bootLoadConversationsAndFolders invokes loaders', () => {
    const loadConversations = vi.fn();
    const loadChatFolders = vi.fn();

    bootLoadConversationsAndFolders({ loadConversations, loadChatFolders });

    expect(loadConversations).toHaveBeenCalledTimes(1);
    expect(loadChatFolders).toHaveBeenCalledTimes(1);
  });

  it('bootLoadAiBots invokes loader', () => {
    const loadAiBots = vi.fn();

    bootLoadAiBots({ loadAiBots });

    expect(loadAiBots).toHaveBeenCalledTimes(1);
  });

  it('buildChatInitDebugPayload includes feature flags and thread poll interval', () => {
    expect(buildChatInitDebugPayload({
      chatFeatureEnabled: true,
      chatWsEnabled: false,
      threadPollMs: 12_000,
    })).toEqual({
      chatFeatureEnabled: true,
      chatWsEnabled: false,
      threadPollMs: 12_000,
    });
    expect(buildChatInitDebugPayload().threadPollMs).toBe(CHAT_PAGE_THREAD_POLL_MS);
  });

  it('logChatInitDebug emits chat:init event', () => {
    const logChatDebug = vi.fn();
    const payload = buildChatInitDebugPayload({ threadPollMs: 5_000 });

    logChatInitDebug(logChatDebug, payload);

    expect(logChatDebug).toHaveBeenCalledWith('chat:init', payload);
  });
});

describe('useChatPageBootEffects', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatPageBootEffects).toBe('function');
  });

  it('mounts without throwing', async () => {
    const { renderHook } = await import('@testing-library/react');

    const { unmount } = renderHook(() => useChatPageBootEffects({
      loadConversations: vi.fn(),
      loadChatFolders: vi.fn(),
      loadAiBots: vi.fn(),
      logChatDebug: vi.fn(),
    }));

    unmount();
  });
});
