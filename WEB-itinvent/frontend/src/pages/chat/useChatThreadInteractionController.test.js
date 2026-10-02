import React, { useRef } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useChatThreadInteractionController from './useChatThreadInteractionController';

function Harness({
  onReady,
  messages,
  hasNewerRef,
  loadMessages,
  scrollThreadBottomIntoView,
  cancelPendingInitialAnchor,
  queueAutoScroll,
}) {
  const activeConversationIdRef = useRef('conv-1');
  const messagesRef = useRef(messages);
  const pendingInitialAnchorRef = useRef(null);
  const showJumpToLatestRef = useRef(false);
  const suppressThreadScrollCancelRef = useRef(false);
  const threadNearBottomRef = useRef(false);

  const api = useChatThreadInteractionController({
    activeConversationIdRef,
    cancelPendingInitialAnchor,
    clearInitialViewportGuard: vi.fn(),
    isInitialViewportGuardActive: () => false,
    loadMessages,
    logChatDebug: vi.fn(),
    messagesHasNewerRef: hasNewerRef,
    pendingInitialAnchorRef,
    queueAutoScroll,
    scheduleThreadViewportStateSync: vi.fn(),
    scrollThreadBottomIntoView,
    setShowJumpToLatest: vi.fn(),
    showJumpToLatestRef,
    suppressThreadScrollCancelRef,
    threadNearBottomRef,
  });

  React.useEffect(() => {
    onReady?.({ api, threadNearBottomRef });
  }, [api, onReady]);

  return null;
}

const buildMessages = () => Array.from({ length: 34 }, (_, index) => ({
  id: `msg-${index + 31}`,
  conversation_id: 'conv-1',
  body: `m${index + 31}`,
}));

const buildHarnessProps = (overrides = {}) => ({
  hasNewerRef: { current: true },
  messages: buildMessages(),
  loadMessages: vi.fn(async () => []),
  scrollThreadBottomIntoView: vi.fn(),
  cancelPendingInitialAnchor: vi.fn(),
  queueAutoScroll: vi.fn(),
  ...overrides,
});

describe('useChatThreadInteractionController (R19/R20/R26/R28)', () => {
  it('ensureLatestThreadWindow loads the latest window once and scrolls to the bottom', async () => {
    const hasNewerRef = { current: true };
    const loadMessages = vi.fn(async () => {
      hasNewerRef.current = false;
      return [{ id: 'msg-120' }];
    });
    const scrollThreadBottomIntoView = vi.fn();
    const props = buildHarnessProps({ hasNewerRef, loadMessages, scrollThreadBottomIntoView });
    let ctx = null;
    render(React.createElement(Harness, { ...props, onReady: (value) => { ctx = value; } }));

    await waitFor(() => expect(ctx?.api?.ensureLatestThreadWindow).toBeTypeOf('function'));

    await act(async () => {
      await ctx.api.ensureLatestThreadWindow();
    });

    // R28: one bootstrap replace, not a page walk.
    expect(loadMessages).toHaveBeenCalledTimes(1);
    expect(loadMessages).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ silent: true, force: true }),
    );
    expect(loadMessages.mock.calls[0][1]).not.toHaveProperty('afterMessageId');
    // R26: the viewport is driven to the very bottom.
    expect(scrollThreadBottomIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ensureLatestThreadWindow:bottom' }),
    );
    expect(props.queueAutoScroll).toHaveBeenCalledWith('bottom', 'ensureLatestThreadWindow');
    expect(ctx.threadNearBottomRef.current).toBe(true);
    expect(props.cancelPendingInitialAnchor).toHaveBeenCalled();
    expect(hasNewerRef.current).toBe(false);
  });

  it('ensureLatestThreadWindow is a no-op without has_newer', async () => {
    const hasNewerRef = { current: false };
    const loadMessages = vi.fn();
    const props = buildHarnessProps({ hasNewerRef, loadMessages });
    let ctx = null;
    render(React.createElement(Harness, { ...props, onReady: (value) => { ctx = value; } }));
    await waitFor(() => expect(ctx?.api?.ensureLatestThreadWindow).toBeTypeOf('function'));

    await act(async () => {
      await ctx.api.ensureLatestThreadWindow();
    });
    expect(loadMessages).not.toHaveBeenCalled();
  });

  it('jumpToLatest replaces a partial window with the latest page, then scrolls to the bottom', async () => {
    const hasNewerRef = { current: true };
    const loadMessages = vi.fn(async () => {
      hasNewerRef.current = false;
      return [{ id: 'msg-120' }];
    });
    const scrollThreadBottomIntoView = vi.fn();
    const queueAutoScroll = vi.fn();
    const props = buildHarnessProps({
      hasNewerRef,
      loadMessages,
      scrollThreadBottomIntoView,
      queueAutoScroll,
    });
    let ctx = null;
    render(React.createElement(Harness, { ...props, onReady: (value) => { ctx = value; } }));
    await waitFor(() => expect(ctx?.api?.jumpToLatest).toBeTypeOf('function'));

    await act(async () => {
      await ctx.api.jumpToLatest();
    });

    expect(loadMessages).toHaveBeenCalledTimes(1);
    expect(loadMessages).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({ silent: true, force: true }),
    );
    expect(queueAutoScroll).toHaveBeenCalledWith('bottom', 'jumpToLatest', { userInitiated: true });
    expect(scrollThreadBottomIntoView).toHaveBeenCalled();
    expect(hasNewerRef.current).toBe(false);
  });
});
