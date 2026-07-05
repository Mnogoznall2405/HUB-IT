import { describe, expect, it } from 'vitest';

import {
  buildChatMobileScreenTransition,
  resolveChatMobileView,
} from './chatMobilePresentation';
import useChatPageAnchorScrollBridge from './useChatPageAnchorScrollBridge';
import useChatMobileThreadAnimation from './useChatMobileThreadAnimation';
import { syncChatPageCollectionRefs } from './syncChatPageCollectionRefs';

describe('chatMobilePresentation', () => {
  it('resolveChatMobileView falls back to inbox when thread has no active conversation', () => {
    expect(resolveChatMobileView({
      isMobile: true,
      mobileView: 'thread',
      activeConversationId: '',
      conversationBootstrapComplete: false,
      activeConversation: null,
      messagesLoading: false,
      requestedConversationId: '',
    })).toBe('inbox');
  });

  it('resolveChatMobileView keeps thread when conversation is active', () => {
    expect(resolveChatMobileView({
      isMobile: true,
      mobileView: 'thread',
      activeConversationId: 'conv-1',
      conversationBootstrapComplete: true,
      activeConversation: { id: 'conv-1' },
      messagesLoading: false,
      requestedConversationId: '',
    })).toBe('thread');
  });

  it('resolveChatMobileView returns inbox after bootstrap when conversation is missing', () => {
    expect(resolveChatMobileView({
      isMobile: true,
      mobileView: 'thread',
      activeConversationId: 'missing',
      conversationBootstrapComplete: true,
      activeConversation: null,
      messagesLoading: false,
      requestedConversationId: '',
    })).toBe('inbox');
  });

  it('buildChatMobileScreenTransition uses instant timing when motion is disabled', () => {
    expect(buildChatMobileScreenTransition(true)).toEqual({ duration: 0.01 });
  });

  it('buildChatMobileScreenTransition uses tween timing when motion is enabled', () => {
    expect(buildChatMobileScreenTransition(false)).toMatchObject({
      type: 'tween',
      duration: expect.any(Number),
    });
  });
});

describe('syncChatPageCollectionRefs', () => {
  it('mirrors collection state into ref handles', () => {
    const conversationsRef = { current: [] };
    const conversationDetailsByIdRef = { current: {} };
    const conversationsLoadingRef = { current: true };
    const aiBotsLoadingRef = { current: true };
    syncChatPageCollectionRefs({
      conversationsRef,
      conversations: [{ id: 'c1' }],
      conversationDetailsByIdRef,
      conversationDetailsById: { c1: { id: 'c1' } },
      conversationsLoadingRef,
      conversationsLoading: false,
      aiBotsLoadingRef,
      aiBotsLoading: false,
    });
    expect(conversationsRef.current).toEqual([{ id: 'c1' }]);
    expect(conversationDetailsByIdRef.current).toEqual({ c1: { id: 'c1' } });
    expect(conversationsLoadingRef.current).toBe(false);
    expect(aiBotsLoadingRef.current).toBe(false);
  });
});

describe('useChatPageAnchorScrollBridge', () => {
  it('exports a hook factory function', () => {
    expect(typeof useChatPageAnchorScrollBridge).toBe('function');
  });
});

describe('useChatMobileThreadAnimation', () => {
  it('exports a hook factory function', () => {
    expect(typeof useChatMobileThreadAnimation).toBe('function');
  });
});
