import { describe, expect, it } from 'vitest';

import { hasChatBlockingOverlay, resolveChatEscapeAction } from './chatEscapeClose';

describe('resolveChatEscapeAction', () => {
  it('does nothing while a blocking modal is open', () => {
    expect(resolveChatEscapeAction({
      hasBlockingOverlay: true,
      hasActiveConversation: true,
      isMobile: true,
      mobileThreadOpen: true,
    })).toBeNull();
  });

  it('closes emoji picker before the thread', () => {
    expect(resolveChatEscapeAction({
      emojiPickerOpen: true,
      hasActiveConversation: true,
    })).toBe('close-emoji');
  });

  it('clears message selection before closing the thread', () => {
    expect(resolveChatEscapeAction({
      hasSelectedMessages: true,
      hasActiveConversation: true,
    })).toBe('clear-selection');
  });

  it('closes side panels before the thread', () => {
    expect(resolveChatEscapeAction({
      contextPanelOpen: true,
      hasActiveConversation: true,
    })).toBe('close-panels');
    expect(resolveChatEscapeAction({
      taskPanelOpen: true,
      hasActiveConversation: true,
    })).toBe('close-panels');
    expect(resolveChatEscapeAction({
      infoOpen: true,
      isMobile: true,
      mobileThreadOpen: true,
    })).toBe('close-panels');
  });

  it('closes mobile thread view', () => {
    expect(resolveChatEscapeAction({
      isMobile: true,
      mobileThreadOpen: true,
      hasActiveConversation: true,
    })).toBe('close-mobile-thread');
  });

  it('closes desktop thread when a conversation is open', () => {
    expect(resolveChatEscapeAction({
      hasActiveConversation: true,
    })).toBe('close-desktop-thread');
  });

  it('is a no-op with nothing open', () => {
    expect(resolveChatEscapeAction({})).toBeNull();
  });
});

describe('hasChatBlockingOverlay', () => {
  it('detects visible MUI modal roots', () => {
    const doc = {
      querySelectorAll: () => [
        { getAttribute: (name) => (name === 'aria-hidden' ? 'false' : null) },
      ],
    };
    expect(hasChatBlockingOverlay(doc)).toBe(true);
  });

  it('ignores aria-hidden modals', () => {
    const doc = {
      querySelectorAll: () => [
        { getAttribute: (name) => (name === 'aria-hidden' ? 'true' : null) },
      ],
    };
    expect(hasChatBlockingOverlay(doc)).toBe(false);
  });
});
