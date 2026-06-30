import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatNavigationController from './useChatNavigationController';

vi.mock('../../api/client', () => ({
  chatAPI: {
    createDirectConversation: vi.fn(),
    openAiBotConversation: vi.fn(),
  },
}));

import { chatAPI } from '../../api/client';

function buildArgs(overrides = {}) {
  return {
    activeConversationIdRef: { current: '' },
    conversationsRef: { current: [] },
    focusComposer: vi.fn(),
    handleActiveFolderChange: vi.fn(),
    isMobile: false,
    logChatDebug: vi.fn(),
    notifyApiError: vi.fn(),
    openMobileThreadView: vi.fn(),
    prefetchAdjacentThreadBootstraps: vi.fn(),
    prefetchThreadBootstrap: vi.fn().mockResolvedValue(null),
    resetMessageSearch: vi.fn(),
    resetSidebarSearch: vi.fn(),
    searchChats: [],
    setActiveConversationId: vi.fn(),
    setAiBots: vi.fn(),
    setAiStatusByConversation: vi.fn(),
    setInfoOpen: vi.fn(),
    setOpeningAiBotId: vi.fn(),
    setOpeningPeerId: vi.fn(),
    upsertConversation: vi.fn(),
    ...overrides,
  };
}

describe('useChatNavigationController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('openConversation activates conversation and resets search', () => {
    const setActiveConversationId = vi.fn();
    const resetMessageSearch = vi.fn();
    const setInfoOpen = vi.fn();
    const prefetchAdjacentThreadBootstraps = vi.fn();

    const { result } = renderHook(() => useChatNavigationController(buildArgs({
      setActiveConversationId,
      resetMessageSearch,
      setInfoOpen,
      prefetchAdjacentThreadBootstraps,
    })));

    act(() => {
      result.current.openConversation('conv-42');
    });

    expect(setInfoOpen).toHaveBeenCalledWith(false);
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-42');
    expect(resetMessageSearch).toHaveBeenCalled();
    expect(prefetchAdjacentThreadBootstraps).toHaveBeenCalledWith('conv-42');
  });

  it('handleOpenArchiveFolder switches folder filter to archived', () => {
    const handleActiveFolderChange = vi.fn();
    const { result } = renderHook(() => useChatNavigationController(buildArgs({
      handleActiveFolderChange,
    })));

    act(() => {
      result.current.handleOpenArchiveFolder();
    });

    expect(handleActiveFolderChange).toHaveBeenCalledWith('archived');
  });

  it('handleOpenAiBot opens existing bot conversation without API create', async () => {
    const focusComposer = vi.fn();
    const setActiveConversationId = vi.fn();

    const { result } = renderHook(() => useChatNavigationController(buildArgs({
      focusComposer,
      setActiveConversationId,
    })));

    await act(async () => {
      await result.current.handleOpenAiBot({ id: 'bot-1', conversation_id: 'conv-ai' });
    });

    expect(chatAPI.openAiBotConversation).not.toHaveBeenCalled();
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-ai');
    expect(focusComposer).toHaveBeenCalled();
  });

  it('handleOpenPeer opens existing direct conversation without POST', async () => {
    const conversationsRef = {
      current: [{ id: 'conv-existing', kind: 'direct', direct_peer: { id: 7 } }],
    };
    const setActiveConversationId = vi.fn();
    const focusComposer = vi.fn();
    const resetSidebarSearch = vi.fn();

    const { result } = renderHook(() => useChatNavigationController(buildArgs({
      conversationsRef,
      setActiveConversationId,
      focusComposer,
      resetSidebarSearch,
    })));

    await act(async () => {
      await result.current.handleOpenPeer({ id: 7 });
    });

    expect(chatAPI.createDirectConversation).not.toHaveBeenCalled();
    expect(resetSidebarSearch).toHaveBeenCalled();
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-existing');
    expect(focusComposer).toHaveBeenCalled();
  });

  it('handleOpenPeer creates direct conversation, upserts, prefetches, and opens without reload', async () => {
    chatAPI.createDirectConversation.mockResolvedValue({
      id: 'conv-peer',
      kind: 'direct',
      direct_peer: { id: 7 },
    });
    const upsertConversation = vi.fn();
    const prefetchThreadBootstrap = vi.fn().mockResolvedValue({ messages: [] });
    const setActiveConversationId = vi.fn();
    const focusComposer = vi.fn();
    const resetSidebarSearch = vi.fn();

    const { result } = renderHook(() => useChatNavigationController(buildArgs({
      upsertConversation,
      prefetchThreadBootstrap,
      setActiveConversationId,
      focusComposer,
      resetSidebarSearch,
    })));

    await act(async () => {
      await result.current.handleOpenPeer({ id: 7 });
    });

    expect(chatAPI.createDirectConversation).toHaveBeenCalledWith(7);
    expect(upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-peer' }),
      { promote: true },
    );
    expect(prefetchThreadBootstrap).toHaveBeenCalledWith('conv-peer', { force: true });
    expect(resetSidebarSearch).toHaveBeenCalled();
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-peer');
    expect(focusComposer).toHaveBeenCalled();
  });
});
