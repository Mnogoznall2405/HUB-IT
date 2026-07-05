import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import useChatScrollController from './useChatScrollController';

const buildRefs = () => ({
  threadScrollRef: { current: null },
  bottomRef: { current: null },
  pinnedScrollRef: { current: null },
  activeConversationIdRef: { current: 'conv-1' },
  threadNearBottomRef: { current: true },
  showJumpToLatestRef: { current: false },
  threadViewportSyncFrameRef: { current: null },
  bottomInstantSettleFrameRef: { current: null },
  mobileKeyboardSettleTimeoutsRef: { current: [] },
});

describe('useChatScrollController', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      cb();
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes scrollTop and syncs viewport state', () => {
    const refs = buildRefs();
    const setShowJumpToLatest = vi.fn();
    const traceProgrammaticThreadScroll = vi.fn();
    const container = {
      scrollTop: 0,
      scrollHeight: 500,
      clientHeight: 200,
    };
    refs.threadScrollRef.current = container;

    const { result } = renderHook(() => useChatScrollController({
      ...refs,
      setShowJumpToLatest,
      suppressThreadScrollCancel: vi.fn(),
      traceProgrammaticThreadScroll,
      isInitialViewportGuardActive: () => false,
    }));

    expect(result.current.setThreadScrollTop(50, { source: 'test' })).toBe(true);
    expect(container.scrollTop).toBe(50);
    expect(traceProgrammaticThreadScroll).toHaveBeenCalledWith('test', expect.objectContaining({
      nextScrollTop: 50,
    }));
    expect(result.current.syncThreadViewportState(container)).toBeUndefined();
    expect(refs.threadNearBottomRef.current).toBe(false);
    expect(setShowJumpToLatest).toHaveBeenCalledWith(true);
  });

  it('captures prepend restore anchor from visible message node', () => {
    const refs = buildRefs();
    const anchor = {
      getAttribute: (attr) => attr === 'data-chat-message-id' ? 'msg-42' : '',
      getBoundingClientRect: () => ({ top: 220, bottom: 260 }),
    };
    const container = {
      scrollTop: 100,
      scrollHeight: 800,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: () => null,
      querySelectorAll: (selector) => (
        String(selector || '').includes('data-chat-message-id') ? [anchor] : []
      ),
    };
    refs.threadScrollRef.current = container;

    const { result } = renderHook(() => useChatScrollController({
      ...refs,
      setShowJumpToLatest: vi.fn(),
      suppressThreadScrollCancel: vi.fn(),
      traceProgrammaticThreadScroll: vi.fn(),
      isInitialViewportGuardActive: () => false,
    }));

    expect(result.current.capturePrependScrollRestore()).toEqual({
      mode: 'anchor',
      virtual: false,
      scrollHeight: 800,
      scrollTop: 100,
      anchorMessageId: 'msg-42',
      anchorViewportOffset: 120,
    });
  });

  it('restores prepend scroll position via anchor viewport offset', () => {
    const refs = buildRefs();
    const anchor = {
      getAttribute: (attr) => attr === 'data-chat-message-id' ? 'msg-42' : '',
      getBoundingClientRect: () => ({ top: 250, bottom: 290 }),
    };
    const container = {
      scrollTop: 100,
      scrollHeight: 1200,
      clientHeight: 200,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: (selector) => (
        String(selector || '').includes('msg-42') ? anchor : null
      ),
    };
    refs.threadScrollRef.current = container;

    const { result } = renderHook(() => useChatScrollController({
      ...refs,
      setShowJumpToLatest: vi.fn(),
      suppressThreadScrollCancel: vi.fn(),
      traceProgrammaticThreadScroll: vi.fn(),
      isInitialViewportGuardActive: () => false,
    }));

    const restore = {
      mode: 'anchor',
      virtual: false,
      scrollHeight: 800,
      scrollTop: 100,
      anchorMessageId: 'msg-42',
      anchorViewportOffset: 120,
    };

    expect(result.current.restorePrependScrollPosition(restore)).toBe(true);
    expect(container.scrollTop).toBe(130);
  });

  it('regression: schedulePrependScrollRestore waits for scrollHeight growth before settling at top', () => {
    const rafCallbacks = [];
    vi.stubGlobal('requestAnimationFrame', (cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    const refs = buildRefs();
    let scrollHeight = 1000;
    let scrollTop = 0;
    const container = {
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 0 }),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value) => {
        scrollTop = Number(value);
      },
    });
    refs.threadScrollRef.current = container;

    const { result } = renderHook(() => useChatScrollController({
      ...refs,
      setShowJumpToLatest: vi.fn(),
      suppressThreadScrollCancel: vi.fn(),
      traceProgrammaticThreadScroll: vi.fn(),
      isInitialViewportGuardActive: () => false,
    }));

    const restore = {
      mode: 'scrollHeight',
      virtual: false,
      scrollHeight: 1000,
      scrollTop: 0,
    };
    const onSettled = vi.fn();

    result.current.schedulePrependScrollRestore(restore, { onSettled });

    expect(scrollTop).toBe(0);
    expect(onSettled).not.toHaveBeenCalled();

    scrollHeight = 1600;
    rafCallbacks.forEach((cb) => cb());

    expect(scrollTop).toBe(600);
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it('re-exports scroll model helpers', () => {
    const refs = buildRefs();
    const { result } = renderHook(() => useChatScrollController({
      ...refs,
      setShowJumpToLatest: vi.fn(),
      suppressThreadScrollCancel: vi.fn(),
      traceProgrammaticThreadScroll: vi.fn(),
      isInitialViewportGuardActive: () => false,
    }));

    expect(typeof result.current.getChatBottomInstantSettleFrames).toBe('function');
    expect(typeof result.current.capturePrependScrollRestoreState).toBe('function');
    expect(typeof result.current.computePrependScrollRestoreTop).toBe('function');
  });
});
