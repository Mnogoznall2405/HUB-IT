import { describe, expect, it, vi } from 'vitest';

import {
  shouldCloseInfoPanelOnMobileInbox,
  shouldResetMobileViewAfterFailedBootstrap,
  shouldResetMobileViewWithoutConversation,
} from './useChatMobileViewGuardEffects';
import useChatMobileViewGuardEffects from './useChatMobileViewGuardEffects';

describe('useChatMobileViewGuardEffects helpers', () => {
  it('shouldResetMobileViewWithoutConversation detects orphan thread view', () => {
    expect(shouldResetMobileViewWithoutConversation({
      isMobile: true,
      mobileView: 'thread',
      activeConversationId: '',
    })).toBe(true);
    expect(shouldResetMobileViewWithoutConversation({
      isMobile: true,
      mobileView: 'thread',
      activeConversationId: 'c-1',
    })).toBe(false);
    expect(shouldResetMobileViewWithoutConversation({
      isMobile: false,
      mobileView: 'thread',
      activeConversationId: '',
    })).toBe(false);
  });

  it('shouldResetMobileViewAfterFailedBootstrap waits for bootstrap completion', () => {
    expect(shouldResetMobileViewAfterFailedBootstrap({
      isMobile: true,
      mobileView: 'thread',
      conversationBootstrapComplete: true,
      messagesLoading: false,
      activeConversation: null,
    })).toBe(true);
    expect(shouldResetMobileViewAfterFailedBootstrap({
      isMobile: true,
      mobileView: 'thread',
      conversationBootstrapComplete: false,
      messagesLoading: false,
      activeConversation: null,
    })).toBe(false);
    expect(shouldResetMobileViewAfterFailedBootstrap({
      isMobile: true,
      mobileView: 'thread',
      conversationBootstrapComplete: true,
      messagesLoading: true,
      activeConversation: null,
    })).toBe(false);
    expect(shouldResetMobileViewAfterFailedBootstrap({
      isMobile: true,
      mobileView: 'thread',
      conversationBootstrapComplete: true,
      messagesLoading: false,
      activeConversation: { id: 'c-1' },
    })).toBe(false);
  });

  it('shouldCloseInfoPanelOnMobileInbox closes info outside thread view', () => {
    expect(shouldCloseInfoPanelOnMobileInbox({
      isMobile: true,
      resolvedMobileView: 'inbox',
      infoOpen: true,
    })).toBe(true);
    expect(shouldCloseInfoPanelOnMobileInbox({
      isMobile: true,
      resolvedMobileView: 'thread',
      infoOpen: true,
    })).toBe(false);
    expect(shouldCloseInfoPanelOnMobileInbox({
      isMobile: true,
      resolvedMobileView: 'inbox',
      infoOpen: false,
    })).toBe(false);
  });
});

describe('useChatMobileViewGuardEffects', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatMobileViewGuardEffects).toBe('function');
  });

  it('mounts without throwing on desktop', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { unmount } = renderHook(() => useChatMobileViewGuardEffects({
      activeConversation: null,
      activeConversationId: '',
      conversationBootstrapComplete: false,
      infoOpen: false,
      isMobile: false,
      messagesLoading: false,
      mobileView: 'inbox',
      resolvedMobileView: 'inbox',
      setInfoOpen: vi.fn(),
      setMobileView: vi.fn(),
    }));
    unmount();
  });
});
