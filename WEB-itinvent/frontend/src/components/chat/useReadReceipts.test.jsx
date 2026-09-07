import React, { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const desktopState = vi.hoisted(() => ({ foreground: null }));
vi.mock('../../lib/desktopBridge', () => ({
  getDesktopWindowForeground: () => desktopState.foreground,
  DESKTOP_WINDOW_STATE_CHANGED_EVENT: 'itinvent:desktop-window-state-changed',
}));

import useReadReceipts from './useReadReceipts';

function installIntersectionObserverMock() {
  const originalIntersectionObserver = window.IntersectionObserver;
  const instances = [];

  class MockIntersectionObserver {
    constructor(callback, options) {
      this.callback = callback;
      this.options = options;
      this.observed = new Set();
      instances.push(this);
    }

    observe = (node) => {
      this.observed.add(node);
    };

    unobserve = (node) => {
      this.observed.delete(node);
    };

    disconnect = () => {
      this.observed.clear();
    };

    trigger = (entries) => {
      this.callback(entries.map((entry) => ({
        isIntersecting: Boolean(entry.isIntersecting),
        intersectionRatio: Number(entry.intersectionRatio ?? 1),
        target: entry.target,
      })));
    };
  }

  window.IntersectionObserver = MockIntersectionObserver;
  globalThis.IntersectionObserver = MockIntersectionObserver;

  return {
    instances,
    restore() {
      if (originalIntersectionObserver) {
        window.IntersectionObserver = originalIntersectionObserver;
        globalThis.IntersectionObserver = originalIntersectionObserver;
      } else {
        delete window.IntersectionObserver;
        delete globalThis.IntersectionObserver;
      }
    },
  };
}

function ReadReceiptsHarness({
  conversationId,
  messages,
  viewerLastReadMessageId = '',
  markRead = vi.fn(),
  onOptimisticRead = vi.fn(),
  onReadSyncError = vi.fn(),
  onTargetRef,
  socketStatus = 'disconnected',
}) {
  const scrollRootRef = useRef(null);
  const { effectiveLastReadMessageId, getReadTargetRef } = useReadReceipts({
    conversationId,
    messages,
    enabled: true,
    socketStatus,
    scrollRootRef,
    viewerLastReadMessageId,
    markRead,
    onOptimisticRead,
    onReadSyncError,
  });

  return (
    <div>
      <div ref={scrollRootRef}>
        {messages.map((message) => {
          const targetRef = getReadTargetRef(message.id);
          onTargetRef?.(message.id, targetRef);
          return (
            <div
              key={message.id}
              ref={targetRef}
              data-chat-message-id={message.id}
            >
              {message.body}
            </div>
          );
        })}
      </div>
      <output data-testid="effective-read-id">{effectiveLastReadMessageId}</output>
    </div>
  );
}

const MESSAGES = [
  {
    id: 'msg-own',
    body: 'Mine',
    is_own: true,
  },
  {
    id: 'msg-b',
    body: 'Unread B',
    is_own: false,
  },
  {
    id: 'msg-a',
    body: 'Unread A',
    is_own: false,
  },
];

describe('useReadReceipts', () => {
  it('does not mark hidden messages and waits for a visible observation', async () => {
    const observer = installIntersectionObserverMock();
    const markRead = vi.fn().mockResolvedValue({ ok: true });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      render(<ReadReceiptsHarness conversationId="A" messages={MESSAGES} markRead={markRead} />);
      const entry = { target: document.querySelector('[data-chat-message-id="msg-b"]'), isIntersecting: true };
      act(() => observer.instances[0].trigger([entry]));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(markRead).not.toHaveBeenCalled();
      visibility.mockReturnValue('visible');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      act(() => observer.instances[0].trigger([entry]));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(markRead).toHaveBeenCalledTimes(1);
    } finally { observer.restore(); }
  });

  it('defers a pending read while Desktop loses foreground, then resumes it', async () => {
    const observer = installIntersectionObserverMock();
    const markRead = vi.fn().mockResolvedValue({ ok: true });
    desktopState.foreground = true;
    try {
      render(<ReadReceiptsHarness conversationId="A" messages={MESSAGES} markRead={markRead} />);
      act(() => observer.instances[0].trigger([{ target: document.querySelector('[data-chat-message-id="msg-b"]'), isIntersecting: true }]));
      desktopState.foreground = false;
      act(() => window.dispatchEvent(new Event('itinvent:desktop-window-state-changed')));
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(markRead).not.toHaveBeenCalled();
      desktopState.foreground = true;
      await act(async () => { window.dispatchEvent(new Event('itinvent:desktop-window-state-changed')); });
      expect(markRead).toHaveBeenCalledExactlyOnceWith('A', 'msg-b');
    } finally { observer.restore(); }
  });

  it.each([503, 403])('resumes only transient failures on socket recovery: %s', async (status) => {
    const observer = installIntersectionObserverMock();
    const markRead = vi.fn().mockRejectedValue({ response: { status } });
    try {
      const { rerender } = render(<ReadReceiptsHarness conversationId="A" messages={MESSAGES} markRead={markRead} />);
      act(() => observer.instances[0].trigger([{ target: document.querySelector('[data-chat-message-id="msg-b"]'), isIntersecting: true }]));
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      const attempts = status === 403 ? 1 : 4;
      expect(markRead).toHaveBeenCalledTimes(attempts);
      markRead.mockResolvedValue({ ok: true });
      rerender(<ReadReceiptsHarness conversationId="A" messages={MESSAGES} markRead={markRead} socketStatus="connected" />);
      await act(async () => { await Promise.resolve(); });
      expect(markRead).toHaveBeenCalledTimes(attempts + (status === 503 ? 1 : 0));
    } finally { observer.restore(); }
  });

  it.each(['recover', 'switch', 'unmount', 'forbidden'])('handles online after exhausted reads: %s', async (mode) => {
    const observer = installIntersectionObserverMock();
    const markRead = vi.fn().mockRejectedValue({ response: { status: mode === 'forbidden' ? 403 : 500 } });
    try {
      const { rerender, unmount } = render(<ReadReceiptsHarness conversationId="A" messages={MESSAGES} markRead={markRead} />);
      act(() => observer.instances[0].trigger([{ target: document.querySelector('[data-chat-message-id="msg-b"]'), isIntersecting: true }]));
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      const failedAttempts = mode === 'forbidden' ? 1 : 4;
      expect(markRead).toHaveBeenCalledTimes(failedAttempts);
      markRead.mockResolvedValue({ ok: true });
      if (mode === 'switch') rerender(<ReadReceiptsHarness conversationId="B" messages={[]} markRead={markRead} />);
      if (mode === 'unmount') unmount();
      await act(async () => { window.dispatchEvent(new Event('online')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(markRead).toHaveBeenCalledTimes(failedAttempts + (mode === 'recover' ? 1 : 0));
      if (mode === 'recover') expect(markRead).toHaveBeenLastCalledWith('A', 'msg-b');
      if (mode !== 'unmount') unmount();
    } finally { observer.restore(); }
  });

  it.each([401, 403, 500])('bounds failed reads and coalesces revalidation for HTTP %s', async (status) => {
    const observer = installIntersectionObserverMock();
    const markRead = vi.fn().mockRejectedValue({ response: { status } });
    const onReadSyncError = vi.fn();
    try {
      const { unmount } = render(<ReadReceiptsHarness conversationId="A" messages={MESSAGES} markRead={markRead} onReadSyncError={onReadSyncError} />);
      act(() => observer.instances[0].trigger([{ target: document.querySelector('[data-chat-message-id="msg-b"]'), isIntersecting: true }]));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(markRead).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(999); });
      expect(markRead).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(markRead).toHaveBeenCalledTimes(status === 500 ? 4 : 1);
      expect(onReadSyncError).toHaveBeenCalledTimes(1);
      unmount();
    } finally { observer.restore(); }
  });

  it.each(['switch', 'unmount'])('ignores a late read rejection after %s', async (mode) => {
    const observer = installIntersectionObserverMock();
    let rejectRead;
    const markRead = vi.fn(() => new Promise((_, reject) => { rejectRead = reject; }));
    const onReadSyncError = vi.fn();
    try {
      const { rerender, unmount } = render(<ReadReceiptsHarness conversationId="A" messages={MESSAGES} markRead={markRead} onReadSyncError={onReadSyncError} />);
      act(() => observer.instances[0].trigger([{ target: document.querySelector('[data-chat-message-id="msg-b"]'), isIntersecting: true }]));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      if (mode === 'switch') rerender(<ReadReceiptsHarness conversationId="B" messages={[]} markRead={markRead} onReadSyncError={onReadSyncError} />);
      else unmount();
      await act(async () => { rejectRead(new Error('offline')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(onReadSyncError).not.toHaveBeenCalled();
      if (mode === 'switch') unmount();
    } finally { observer.restore(); }
  });

  beforeEach(() => {
    desktopState.foreground = null;
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('observes only unread incoming messages and batches the latest visible message by list order', async () => {
    const intersectionObserver = installIntersectionObserverMock();
    const markRead = vi.fn().mockResolvedValue({ ok: true });
    const onOptimisticRead = vi.fn();

    try {
      render(
        <ReadReceiptsHarness
          conversationId="conv-1"
          messages={MESSAGES}
          viewerLastReadMessageId=""
          markRead={markRead}
          onOptimisticRead={onOptimisticRead}
        />,
      );

      expect(intersectionObserver.instances).toHaveLength(1);
      expect(intersectionObserver.instances[0].options.threshold).toBe(0.5);
      expect(intersectionObserver.instances[0].observed.size).toBe(2);

      const msgB = document.querySelector('[data-chat-message-id="msg-b"]');
      const msgA = document.querySelector('[data-chat-message-id="msg-a"]');

      act(() => {
        intersectionObserver.instances[0].trigger([
          { target: msgB, isIntersecting: true, intersectionRatio: 0.6 },
          { target: msgA, isIntersecting: true, intersectionRatio: 0.75 },
        ]);
      });

      expect(screen.getByTestId('effective-read-id').textContent).toBe('msg-a');
      expect(onOptimisticRead).toHaveBeenLastCalledWith('msg-a');
      expect(markRead).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(markRead).toHaveBeenCalledTimes(1);
      expect(markRead).toHaveBeenCalledWith('conv-1', 'msg-a');
    } finally {
      intersectionObserver.restore();
    }
  });

  it('clears pending reads when the conversation changes', async () => {
    const intersectionObserver = installIntersectionObserverMock();
    const markRead = vi.fn().mockResolvedValue({ ok: true });

    try {
      const { rerender } = render(
        <ReadReceiptsHarness
          conversationId="conv-1"
          messages={MESSAGES}
          markRead={markRead}
        />,
      );

      const msgB = document.querySelector('[data-chat-message-id="msg-b"]');
      act(() => {
        intersectionObserver.instances[0].trigger([
          { target: msgB, isIntersecting: true, intersectionRatio: 0.9 },
        ]);
      });

      rerender(
        <ReadReceiptsHarness
          conversationId="conv-2"
          messages={MESSAGES.map((message) => ({ ...message, id: `${message.id}-2` }))}
          markRead={markRead}
        />,
      );

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(markRead).not.toHaveBeenCalled();
    } finally {
      intersectionObserver.restore();
    }
  });

  it('keeps one observer across message appends and observes new unread messages', async () => {
    const intersectionObserver = installIntersectionObserverMock();
    const markRead = vi.fn().mockResolvedValue({ ok: true });

    try {
      const { rerender } = render(
        <ReadReceiptsHarness
          conversationId="conv-1"
          messages={MESSAGES}
          markRead={markRead}
        />,
      );

      expect(intersectionObserver.instances).toHaveLength(1);
      expect(intersectionObserver.instances[0].observed.size).toBe(2);

      const appendedMessages = [
        ...MESSAGES,
        {
          id: 'msg-c',
          body: 'Unread C',
          is_own: false,
        },
      ];
      rerender(
        <ReadReceiptsHarness
          conversationId="conv-1"
          messages={appendedMessages}
          markRead={markRead}
        />,
      );

      expect(intersectionObserver.instances).toHaveLength(1);
      expect(intersectionObserver.instances[0].observed.size).toBe(3);

      const msgC = document.querySelector('[data-chat-message-id="msg-c"]');
      act(() => {
        intersectionObserver.instances[0].trigger([
          { target: msgC, isIntersecting: true, intersectionRatio: 0.9 },
        ]);
      });

      expect(screen.getByTestId('effective-read-id').textContent).toBe('msg-c');

      await act(async () => {
        vi.advanceTimersByTime(500);
      });

      expect(markRead).toHaveBeenCalledWith('conv-1', 'msg-c');
    } finally {
      intersectionObserver.restore();
    }
  });

  it('releases callback refs when messages leave the rendered window', () => {
    const intersectionObserver = installIntersectionObserverMock();
    const refsByMessage = new Map();
    const rememberTargetRef = (messageId, targetRef) => {
      if (!targetRef) return;
      const history = refsByMessage.get(messageId) || [];
      history.push(targetRef);
      refsByMessage.set(messageId, history);
    };

    try {
      const { rerender } = render(
        <ReadReceiptsHarness
          conversationId="conv-1"
          messages={MESSAGES}
          onTargetRef={rememberTargetRef}
        />,
      );
      const firstRef = refsByMessage.get('msg-b')?.at(-1);

      rerender(
        <ReadReceiptsHarness
          conversationId="conv-1"
          messages={MESSAGES.filter((message) => message.id !== 'msg-b')}
          onTargetRef={rememberTargetRef}
        />,
      );
      rerender(
        <ReadReceiptsHarness
          conversationId="conv-1"
          messages={MESSAGES}
          onTargetRef={rememberTargetRef}
        />,
      );

      expect(refsByMessage.get('msg-b')?.at(-1)).not.toBe(firstRef);
    } finally {
      intersectionObserver.restore();
    }
  });
});
