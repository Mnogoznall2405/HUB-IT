import React, { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
}) {
  const scrollRootRef = useRef(null);
  const { effectiveLastReadMessageId, getReadTargetRef } = useReadReceipts({
    conversationId,
    messages,
    enabled: true,
    scrollRootRef,
    viewerLastReadMessageId,
    markRead,
    onOptimisticRead,
    onReadSyncError,
  });

  return (
    <div>
      <div ref={scrollRootRef}>
        {messages.map((message) => (
          <div
            key={message.id}
            ref={getReadTargetRef(message.id)}
            data-chat-message-id={message.id}
          >
            {message.body}
          </div>
        ))}
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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
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
});
