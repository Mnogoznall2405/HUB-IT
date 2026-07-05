import { describe, expect, it, vi } from 'vitest';

import {
  buildChatActiveConversationChangedDetail,
  buildMessageSearchParamAfterReveal,
  buildRequestedMessageRevealKey,
  CHAT_ACTIVE_CONVERSATION_CHANGED_EVENT,
  dispatchChatActiveConversationChanged,
  resolveRequestedMessageRevealPlan,
} from './useChatActiveConversationLifecycleEffects';
import useChatActiveConversationLifecycleEffects from './useChatActiveConversationLifecycleEffects';

describe('useChatActiveConversationLifecycleEffects helpers', () => {
  it('buildChatActiveConversationChangedDetail normalizes conversation ids', () => {
    expect(buildChatActiveConversationChangedDetail('  c-1  ')).toEqual({ conversationId: 'c-1' });
    expect(buildChatActiveConversationChangedDetail(null)).toEqual({ conversationId: '' });
  });

  it('dispatchChatActiveConversationChanged emits the custom event', () => {
    const dispatchEvent = vi.fn();
    const CustomEventCtor = vi.fn(function CustomEvent(type, init) {
      this.type = type;
      this.detail = init.detail;
    });
    dispatchChatActiveConversationChanged('c-42', { dispatchEvent, CustomEventCtor });
    expect(CustomEventCtor).toHaveBeenCalledWith(
      CHAT_ACTIVE_CONVERSATION_CHANGED_EVENT,
      { detail: { conversationId: 'c-42' } },
    );
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('buildRequestedMessageRevealKey joins normalized ids', () => {
    expect(buildRequestedMessageRevealKey(' c1 ', ' m1 ')).toBe('c1:m1');
    expect(buildRequestedMessageRevealKey('', 'm1')).toBe('');
  });

  it('resolveRequestedMessageRevealPlan gates reveal attempts', () => {
    expect(resolveRequestedMessageRevealPlan({
      requestedMessageId: '',
      activeConversationId: 'c1',
      requestedConversationId: 'c1',
      messagesLoading: false,
      lastHandledRevealKey: '',
    })).toEqual({ shouldReveal: false, resetRevealKey: true, revealKey: '' });

    expect(resolveRequestedMessageRevealPlan({
      requestedMessageId: 'm1',
      activeConversationId: 'c1',
      requestedConversationId: 'c2',
      messagesLoading: false,
      lastHandledRevealKey: '',
    })).toEqual({ shouldReveal: false, resetRevealKey: false, revealKey: '' });

    expect(resolveRequestedMessageRevealPlan({
      requestedMessageId: 'm1',
      activeConversationId: 'c1',
      requestedConversationId: 'c1',
      messagesLoading: true,
      lastHandledRevealKey: '',
    })).toEqual({ shouldReveal: false, resetRevealKey: false, revealKey: '' });

    expect(resolveRequestedMessageRevealPlan({
      requestedMessageId: 'm1',
      activeConversationId: 'c1',
      requestedConversationId: 'c1',
      messagesLoading: false,
      lastHandledRevealKey: 'c1:m1',
    })).toEqual({ shouldReveal: false, resetRevealKey: false, revealKey: 'c1:m1' });

    expect(resolveRequestedMessageRevealPlan({
      requestedMessageId: 'm1',
      activeConversationId: 'c1',
      requestedConversationId: 'c1',
      messagesLoading: false,
      lastHandledRevealKey: '',
    })).toEqual({ shouldReveal: true, resetRevealKey: false, revealKey: 'c1:m1' });
  });

  it('buildMessageSearchParamAfterReveal removes message param when it matches', () => {
    expect(buildMessageSearchParamAfterReveal('?conversation=c1&message=m1', 'm1')).toBe('?conversation=c1');
    expect(buildMessageSearchParamAfterReveal('?message=m1', 'm1')).toBe('');
    expect(buildMessageSearchParamAfterReveal('?message=m2', 'm1')).toBeNull();
  });
});

describe('useChatActiveConversationLifecycleEffects', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatActiveConversationLifecycleEffects).toBe('function');
  });

  it('mounts without throwing when conversation is empty', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { unmount } = renderHook(() => useChatActiveConversationLifecycleEffects({
      activeConversationId: '',
      activeConversationIdRef: { current: '' },
      closeAttachmentPreview: vi.fn(),
      closeDocumentPreview: vi.fn(),
      locationSearch: '',
      messagesLength: 0,
      messagesLoading: false,
      navigate: vi.fn(),
      requestedConversationId: '',
      requestedMessageId: '',
      requestedMessageRevealKeyRef: { current: '' },
      revealMessageRef: { current: vi.fn() },
      setMessageMenuAnchor: vi.fn(),
      setMessageMenuMessage: vi.fn(),
      setSelectedMessageIds: vi.fn(),
      setThreadMenuAnchor: vi.fn(),
    }));
    unmount();
  });
});
