import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatDialogsController, { computeShouldRenderChatDialogs } from './useChatDialogsController';

describe('computeShouldRenderChatDialogs', () => {
  it('returns false when no dialog surface is open', () => {
    expect(computeShouldRenderChatDialogs({
      threadMenuAnchor: null,
      messageMenuAnchor: null,
      composerMenuAnchor: null,
      emojiAnchorEl: null,
      groupOpen: false,
      shareOpen: false,
      forwardOpen: false,
      fileDialogOpen: false,
      attachmentPreview: null,
      documentPreview: null,
      messageReadsOpen: false,
      searchOpen: false,
      isMobile: false,
      infoOpen: false,
    })).toBe(false);
  });

  it('returns true when any dialog anchor or preview is active', () => {
    expect(computeShouldRenderChatDialogs({
      composerMenuAnchor: {},
    })).toBe(true);

    expect(computeShouldRenderChatDialogs({
      fileDialogOpen: true,
    })).toBe(true);

    expect(computeShouldRenderChatDialogs({
      isMobile: true,
      infoOpen: true,
    })).toBe(true);
  });

  it('does not preload the dialogs bundle while chat is idle by default', () => {
    const originalRequestIdleCallback = window.requestIdleCallback;
    window.requestIdleCallback = vi.fn();
    const { unmount } = renderHook(() => useChatDialogsController({}));

    expect(window.requestIdleCallback).not.toHaveBeenCalled();

    unmount();
    window.requestIdleCallback = originalRequestIdleCallback;
  });

  it('keeps explicit idle preload available for an intentional caller', () => {
    const originalRequestIdleCallback = window.requestIdleCallback;
    const originalCancelIdleCallback = window.cancelIdleCallback;
    window.requestIdleCallback = vi.fn(() => 17);
    window.cancelIdleCallback = vi.fn();
    const { unmount } = renderHook(() => useChatDialogsController({ preloadOnIdle: true }));

    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 1500 });
    unmount();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(17);

    window.requestIdleCallback = originalRequestIdleCallback;
    window.cancelIdleCallback = originalCancelIdleCallback;
  });
});
