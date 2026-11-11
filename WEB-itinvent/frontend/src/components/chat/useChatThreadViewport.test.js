import React, { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX } from './chatHelpers';
import useChatThreadViewport from './useChatThreadViewport';

function Harness({ onReady, hasNewer = false, onApproachBottom, initialShowJump = false }) {
  const showJumpToLatestRef = useRef(initialShowJump);
  const setShowJumpToLatest = vi.fn();
  const threadNearBottomRef = useRef(false);
  const threadViewportSyncFrameRef = useRef(null);
  const messagesHasNewerRef = useRef(hasNewer);
  const approachCallback = onApproachBottom || vi.fn();

  const api = useChatThreadViewport({
    showJumpToLatestRef,
    setShowJumpToLatest,
    threadNearBottomRef,
    threadViewportSyncFrameRef,
    messagesHasNewerRef,
    onApproachBottom: approachCallback,
  });

  React.useEffect(() => {
    onReady?.({
      api,
      showJumpToLatestRef,
      setShowJumpToLatest,
      threadNearBottomRef,
      messagesHasNewerRef,
      onApproachBottom: approachCallback,
    });
  }, [api, onReady]);

  return null;
}

const buildNode = ({ scrollHeight = 2000, scrollTop = 0, clientHeight = 500 } = {}) => ({
  scrollHeight,
  scrollTop,
  clientHeight,
});

describe('useChatThreadViewport (R19)', () => {
  it('keeps the jump button visible at the loaded bottom while has_newer', () => {
    let ctx = null;
    render(React.createElement(Harness, { hasNewer: true, onReady: (value) => { ctx = value; } }));

    const node = buildNode({ scrollTop: 1500 });
    act(() => {
      ctx.api.syncThreadViewportState(node);
    });

    expect(ctx.threadNearBottomRef.current).toBe(true);
    expect(ctx.setShowJumpToLatest).toHaveBeenCalledWith(true);
    expect(ctx.showJumpToLatestRef.current).toBe(true);
    expect(ctx.onApproachBottom).toHaveBeenCalledTimes(1);
  });

  it('hides the jump button at the real bottom once has_newer is false', () => {
    let ctx = null;
    render(React.createElement(Harness, {
      hasNewer: false,
      initialShowJump: true,
      onReady: (value) => { ctx = value; },
    }));

    const node = buildNode({ scrollTop: 1500 });
    act(() => {
      ctx.api.syncThreadViewportState(node);
    });

    expect(ctx.threadNearBottomRef.current).toBe(true);
    expect(ctx.setShowJumpToLatest).toHaveBeenCalledWith(false);
    expect(ctx.showJumpToLatestRef.current).toBe(false);
    expect(ctx.onApproachBottom).not.toHaveBeenCalled();
  });

  it('shows the jump button without paging when the reader is above the threshold', () => {
    let ctx = null;
    render(React.createElement(Harness, { hasNewer: true, onReady: (value) => { ctx = value; } }));

    const node = buildNode({ scrollTop: 0 });
    act(() => {
      ctx.api.syncThreadViewportState(node);
    });

    expect(ctx.threadNearBottomRef.current).toBe(false);
    expect(ctx.setShowJumpToLatest).toHaveBeenCalledWith(true);
    expect(ctx.onApproachBottom).not.toHaveBeenCalled();
  });

  it('does not page when near the bottom but everything is already loaded', () => {
    let ctx = null;
    render(React.createElement(Harness, { hasNewer: false, onReady: (value) => { ctx = value; } }));

    const node = buildNode({ scrollTop: 1500 - CHAT_THREAD_NEAR_BOTTOM_DISTANCE_PX });
    act(() => {
      ctx.api.syncThreadViewportState(node);
    });

    expect(ctx.onApproachBottom).not.toHaveBeenCalled();
  });

  it('uses the latest onApproachBottom callback after rerender', () => {
    const first = vi.fn();
    const second = vi.fn();
    const onReady = (value) => { ctxRef.current = value; };
    const ctxRef = { current: null };

    const { rerender } = render(React.createElement(Harness, {
      hasNewer: true,
      onApproachBottom: first,
      onReady,
    }));
    rerender(React.createElement(Harness, {
      hasNewer: true,
      onApproachBottom: second,
      onReady,
    }));

    const node = buildNode({ scrollTop: 1500 });
    act(() => {
      ctxRef.current.api.syncThreadViewportState(node);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
