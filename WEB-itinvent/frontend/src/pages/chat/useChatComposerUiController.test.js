import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatComposerUiController from './useChatComposerUiController';

const buildProps = (overrides = {}) => ({
  composerRef: { current: { focus: vi.fn() } },
  emojiAnchorEl: null,
  emojiPanelMode: 'popover',
  focusComposer: vi.fn(),
  isMobile: false,
  loadChatDialogsModule: vi.fn(),
  setComposerMenuAnchor: vi.fn(),
  setEmojiAnchorEl: vi.fn(),
  setEmojiPanelMode: vi.fn(),
  setThreadMenuAnchor: vi.fn(),
  syncComposerSelection: vi.fn(),
  ...overrides,
});

describe('useChatComposerUiController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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

  it('click on desktop pins the panel to the right dock', () => {
    const setEmojiAnchorEl = vi.fn();
    const setEmojiPanelMode = vi.fn();
    const { result } = renderHook(() => useChatComposerUiController(
      buildProps({ setEmojiAnchorEl, setEmojiPanelMode }),
    ));

    act(() => {
      result.current.handleOpenEmojiPicker({ currentTarget: 'emoji-button' });
    });

    expect(setEmojiPanelMode).toHaveBeenCalledWith('pinned');
    expect(setEmojiAnchorEl).toHaveBeenCalledWith('emoji-button');
  });

  it('emoji panel open and hover preview do not load the unrelated dialogs bundle', () => {
    const loadChatDialogsModule = vi.fn();
    const { result } = renderHook(() => useChatComposerUiController(
      buildProps({ loadChatDialogsModule }),
    ));

    act(() => {
      result.current.handleOpenEmojiPicker({ currentTarget: 'emoji-button' });
    });
    expect(loadChatDialogsModule).not.toHaveBeenCalled();

    act(() => {
      result.current.handleEmojiHoverStart({ currentTarget: 'emoji-button' });
      vi.advanceTimersByTime(300);
    });
    expect(loadChatDialogsModule).not.toHaveBeenCalled();
  });

  it('click while pinned closes the dock instead of reopening', () => {
    const setEmojiAnchorEl = vi.fn();
    const { result } = renderHook(() => useChatComposerUiController(
      buildProps({
        emojiAnchorEl: {},
        emojiPanelMode: 'pinned',
        setEmojiAnchorEl,
      }),
    ));

    act(() => {
      result.current.handleOpenEmojiPicker({ currentTarget: 'emoji-button' });
    });

    expect(setEmojiAnchorEl).toHaveBeenCalledWith(null);
  });

  it('hover opens a popover preview only after the delay (no flicker)', () => {
    const setEmojiAnchorEl = vi.fn();
    const setEmojiPanelMode = vi.fn();
    const { result } = renderHook(() => useChatComposerUiController(
      buildProps({ setEmojiAnchorEl, setEmojiPanelMode }),
    ));

    act(() => {
      result.current.handleEmojiHoverStart({ currentTarget: 'emoji-button' });
    });
    expect(setEmojiAnchorEl).not.toHaveBeenCalled();

    // Быстрое прохождение курсором — панель не открывается.
    act(() => {
      result.current.handleEmojiHoverEnd();
      vi.runAllTimers();
    });
    expect(setEmojiAnchorEl).not.toHaveBeenCalled();

    act(() => {
      result.current.handleEmojiHoverStart({ currentTarget: 'emoji-button' });
      vi.advanceTimersByTime(300);
    });
    expect(setEmojiPanelMode).toHaveBeenCalledWith('popover');
    expect(setEmojiAnchorEl).toHaveBeenCalledWith('emoji-button');
  });

  it('leaving an open preview schedules a delayed close; re-entering cancels it', () => {
    const setEmojiAnchorEl = vi.fn();
    const { result, rerender } = renderHook(
      ({ anchor }) => useChatComposerUiController(buildProps({
        emojiAnchorEl: anchor,
        emojiPanelMode: 'popover',
        setEmojiAnchorEl,
      })),
      { initialProps: { anchor: {} } },
    );

    act(() => {
      result.current.handleEmojiHoverEnd();
      vi.advanceTimersByTime(100);
    });
    expect(setEmojiAnchorEl).not.toHaveBeenCalled();

    // Курсор вернулся в панель до истечения задержки — остаётся открыта.
    act(() => {
      result.current.handleEmojiHoverStart();
      vi.runAllTimers();
    });
    expect(setEmojiAnchorEl).not.toHaveBeenCalled();

    rerender({ anchor: {} });
    act(() => {
      result.current.handleEmojiHoverEnd();
      vi.advanceTimersByTime(400);
    });
    expect(setEmojiAnchorEl).toHaveBeenCalledWith(null);
  });

  it('hover-leave never closes a pinned panel', () => {
    const setEmojiAnchorEl = vi.fn();
    const { result } = renderHook(() => useChatComposerUiController(
      buildProps({
        emojiAnchorEl: {},
        emojiPanelMode: 'pinned',
        setEmojiAnchorEl,
      }),
    ));

    act(() => {
      result.current.handleEmojiHoverEnd();
      vi.runAllTimers();
    });
    expect(setEmojiAnchorEl).not.toHaveBeenCalled();
  });

  it('mobile click toggles the inline popover without hover timers', () => {
    const setEmojiAnchorEl = vi.fn();
    const setEmojiPanelMode = vi.fn();
    const composerRef = { current: { blur: vi.fn() } };
    const { result } = renderHook(() => useChatComposerUiController(
      buildProps({ composerRef, isMobile: true, setEmojiAnchorEl, setEmojiPanelMode }),
    ));

    act(() => {
      result.current.handleOpenEmojiPicker({ currentTarget: 'emoji-button' });
    });
    expect(composerRef.current.blur).toHaveBeenCalled();
    expect(setEmojiPanelMode).toHaveBeenCalledWith('popover');
    expect(setEmojiAnchorEl).toHaveBeenCalledWith('emoji-button');
  });
});
