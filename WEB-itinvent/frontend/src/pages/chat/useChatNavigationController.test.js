import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatNavigationController from './useChatNavigationController';

vi.mock('../../api/client', () => ({
  chatAPI: {
    createDirectConversation: vi.fn(),
    createAiConversation: vi.fn(),
    createAiBotConversation: vi.fn(),
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

  it('openConversation loads only the selected conversation and resets search', () => {
    const setActiveConversationId = vi.fn();
    const resetMessageSearch = vi.fn();
    const setInfoOpen = vi.fn();
    const prefetchAdjacentThreadBootstraps = vi.fn();
    const prefetchThreadBootstrap = vi.fn().mockResolvedValue(null);

    const { result } = renderHook(() => useChatNavigationController(buildArgs({
      setActiveConversationId,
      resetMessageSearch,
      setInfoOpen,
      prefetchAdjacentThreadBootstraps,
      prefetchThreadBootstrap,
    })));

    act(() => {
      result.current.openConversation('conv-42');
    });

    expect(setInfoOpen).toHaveBeenCalledWith(false);
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-42');
    expect(resetMessageSearch).toHaveBeenCalled();
    expect(prefetchThreadBootstrap).toHaveBeenCalledWith('conv-42');
    expect(prefetchAdjacentThreadBootstraps).not.toHaveBeenCalled();
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

  it('handleOpenAiBot opens the latest conversation for the selected bot', async () => {
    const focusComposer = vi.fn();
    const setActiveConversationId = vi.fn();
    const upsertConversation = vi.fn();
    const setAiBots = vi.fn((updater) => updater([{ id: 'bot-1', conversation_ids: ['conv-ai'] }]));
    chatAPI.openAiBotConversation.mockResolvedValue({
      id: 'conv-ai-2',
      kind: 'ai',
      title: 'AI Assistant',
    });

    const { result } = renderHook(() => useChatNavigationController(buildArgs({
      focusComposer,
      setActiveConversationId,
      setAiBots,
      upsertConversation,
    })));

    await act(async () => {
      await result.current.handleOpenAiBot({ id: 'bot-1', conversation_id: 'conv-ai' });
    });

    expect(chatAPI.openAiBotConversation).toHaveBeenCalledWith('bot-1');
    expect(chatAPI.createAiBotConversation).not.toHaveBeenCalled();
    expect(upsertConversation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-ai-2', kind: 'ai' }),
      { promote: true },
    );
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-ai-2');
    expect(focusComposer).toHaveBeenCalled();
  });

  it('creates a separate bot conversation only from the explicit create action', async () => {
    chatAPI.createAiBotConversation.mockResolvedValue({ id: 'conv-ai-new', kind: 'ai', title: 'Документы' });
    const setActiveConversationId = vi.fn();
    const { result } = renderHook(() => useChatNavigationController(buildArgs({ setActiveConversationId })));

    await act(async () => {
      await result.current.handleCreateAiBotConversation({ id: 'bot-docs', title: 'Документы' });
    });

    expect(chatAPI.createAiBotConversation).toHaveBeenCalledWith('bot-docs');
    expect(chatAPI.openAiBotConversation).not.toHaveBeenCalled();
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-ai-new');
  });

  it('creates a generic AI conversation without selecting a bot', async () => {
    chatAPI.createAiConversation.mockResolvedValue({ id: 'conv-general', kind: 'ai', title: 'Новый чат' });
    const setActiveConversationId = vi.fn();
    const { result } = renderHook(() => useChatNavigationController(buildArgs({ setActiveConversationId })));

    await act(async () => {
      await result.current.handleCreateAiConversation();
    });

    expect(chatAPI.createAiConversation).toHaveBeenCalledTimes(1);
    expect(setActiveConversationId).toHaveBeenCalledWith('conv-general');
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
