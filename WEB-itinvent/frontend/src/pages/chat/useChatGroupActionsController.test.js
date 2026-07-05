import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatGroupActionsController from './useChatGroupActionsController';

vi.mock('../../api/client', () => ({
  chatAPI: {
    addGroupMembers: vi.fn(),
    leaveGroup: vi.fn(),
  },
}));

import { chatAPI } from '../../api/client';

function buildController(overrides = {}) {
  const activeConversationIdRef = { current: 'conv-1' };
  const setConversations = vi.fn((updater) => updater([{ id: 'conv-1', title: 'Group' }]));
  const setConversationDetailsById = vi.fn((updater) => updater({ 'conv-1': { id: 'conv-1' } }));
  const upsertConversationDetail = vi.fn();
  const upsertSearchConversation = vi.fn();

  return {
    activeConversationIdRef,
    clearStoredConversationState: vi.fn(),
    closeAllPanels: vi.fn(),
    closeInfoAndContextPanels: vi.fn(),
    isMobile: false,
    notifyApiError: vi.fn(),
    openMobileInboxView: vi.fn(),
    setActiveConversationId: vi.fn(),
    setConversationDetailsById,
    setConversations,
    setMessages: vi.fn(),
    setMessagesHasMore: vi.fn(),
    setMessagesHasNewer: vi.fn(),
    setViewerLastReadAt: vi.fn(),
    setViewerLastReadMessageId: vi.fn(),
    upsertConversationDetail,
    upsertSearchConversation,
    ...overrides,
  };
}

describe('useChatGroupActionsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handleAddGroupMembers calls API and applies conversation update', async () => {
    const updated = { id: 'conv-1', title: 'Updated Group' };
    chatAPI.addGroupMembers.mockResolvedValue(updated);
    const args = buildController();

    const { result } = renderHook(() => useChatGroupActionsController(args));

    await act(async () => {
      const value = await result.current.handleAddGroupMembers([2, 3]);
      expect(value).toEqual(updated);
    });

    expect(chatAPI.addGroupMembers).toHaveBeenCalledWith('conv-1', [2, 3]);
    expect(args.upsertConversationDetail).toHaveBeenCalledWith(updated);
    expect(args.upsertSearchConversation).toHaveBeenCalledWith(updated);
  });

  it('handleLeaveGroup clears conversation state and panels', async () => {
    chatAPI.leaveGroup.mockResolvedValue({ ok: true });
    const args = buildController();

    const { result } = renderHook(() => useChatGroupActionsController(args));

    await act(async () => {
      await result.current.handleLeaveGroup();
    });

    expect(chatAPI.leaveGroup).toHaveBeenCalledWith('conv-1');
    expect(args.clearStoredConversationState).toHaveBeenCalledWith({ conversationId: 'conv-1', invalidateThread: true });
    expect(args.closeInfoAndContextPanels).toHaveBeenCalled();
    expect(args.setActiveConversationId).toHaveBeenCalledWith('');
  });

  it('handleRemoteConversationRemoved clears active thread when ids match', () => {
    const args = buildController();

    const { result } = renderHook(() => useChatGroupActionsController(args));

    act(() => {
      result.current.handleRemoteConversationRemoved('conv-1');
    });

    expect(args.clearStoredConversationState).toHaveBeenCalledWith({ conversationId: 'conv-1', invalidateThread: true });
    expect(args.closeAllPanels).toHaveBeenCalled();
    expect(args.setMessages).toHaveBeenCalledWith([]);
    expect(args.setActiveConversationId).toHaveBeenCalledWith('');
  });
});
