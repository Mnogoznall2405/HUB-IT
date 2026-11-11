import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import useChatComposerUiController from './useChatComposerUiController';

describe('useChatComposerUiController', () => {
  it('derives emojiPickerOpen from anchor element', () => {
    const anchor = {};
    const { result } = renderHook(() => useChatComposerUiController({
      composerRef: { current: null },
      emojiAnchorEl: anchor,
      focusComposer: vi.fn(),
      handleComposerSend: vi.fn(),
      isMobile: false,
      loadChatDialogsModule: vi.fn(),
      queueSelectedFiles: vi.fn(),
      setComposerMenuAnchor: vi.fn(),
      setEmojiAnchorEl: vi.fn(),
      setMessageText: vi.fn(),
      setThreadMenuAnchor: vi.fn(),
      syncComposerSelection: vi.fn(),
    }));

    expect(result.current.emojiPickerOpen).toBe(true);
  });

  it('opens thread menu via handleOpenMenu', () => {
    const setThreadMenuAnchor = vi.fn();
    const loadChatDialogsModule = vi.fn();
    const anchor = { currentTarget: 'menu-anchor' };

    const { result } = renderHook(() => useChatComposerUiController({
      composerRef: { current: null },
      emojiAnchorEl: null,
      focusComposer: vi.fn(),
      handleComposerSend: vi.fn(),
      isMobile: false,
      loadChatDialogsModule,
      queueSelectedFiles: vi.fn(),
      setComposerMenuAnchor: vi.fn(),
      setEmojiAnchorEl: vi.fn(),
      setMessageText: vi.fn(),
      setThreadMenuAnchor,
      syncComposerSelection: vi.fn(),
    }));

    result.current.handleOpenMenu(anchor);
    expect(loadChatDialogsModule).toHaveBeenCalled();
    expect(setThreadMenuAnchor).toHaveBeenCalledWith('menu-anchor');
  });
});
