import { describe, expect, it } from 'vitest';

import {
  capturePrependScrollRestoreState,
  computePrependScrollRestoreTop,
  shouldDeferPinnedBottomScroll,
  shouldRetryPrependRestore,
} from './chatThreadScrollModel';

describe('chatThreadScrollModel prepend restore', () => {
  const restoreAtTop = {
    mode: 'scrollHeight',
    virtual: false,
    scrollHeight: 1000,
    scrollTop: 0,
  };

  it('retries until scrollHeight grows after prepend', () => {
    const containerBeforeLayout = {
      scrollHeight: 1000,
      scrollTop: 0,
    };

    expect(shouldRetryPrependRestore(containerBeforeLayout, restoreAtTop, 0)).toBe(true);

    const containerAfterLayout = {
      scrollHeight: 1600,
      scrollTop: 0,
    };

    expect(shouldRetryPrependRestore(containerAfterLayout, restoreAtTop, 1)).toBe(true);
    expect(computePrependScrollRestoreTop(containerAfterLayout, restoreAtTop)).toBe(600);
    expect(shouldRetryPrependRestore({
      scrollHeight: 1600,
      scrollTop: 600,
    }, restoreAtTop, 2)).toBe(false);
  });

  it('regression: must not treat premature restore as settled while reading at scrollTop 0', () => {
    const container = {
      scrollHeight: 1000,
      scrollTop: 0,
    };

    expect(computePrependScrollRestoreTop(container, restoreAtTop)).toBe(0);
    expect(shouldRetryPrependRestore(container, restoreAtTop, 0)).toBe(true);
  });

  it('compensates prepend height when user was reading near the top', () => {
    const container = {
      scrollHeight: 2200,
      scrollTop: 12,
    };
    const restore = {
      mode: 'scrollHeight',
      virtual: false,
      scrollHeight: 1000,
      scrollTop: 12,
    };

    expect(computePrependScrollRestoreTop(container, restore)).toBe(1212);
  });

  it('captures anchor viewport offset for visible message nodes', () => {
    const anchor = {
      getAttribute: (attr) => attr === 'data-chat-message-id' ? 'msg-anchor' : '',
      getBoundingClientRect: () => ({ top: 180, bottom: 220 }),
    };
    const container = {
      scrollTop: 80,
      scrollHeight: 900,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: () => null,
      querySelectorAll: (selector) => (
        String(selector || '').includes('data-chat-message-id') ? [anchor] : []
      ),
    };

    expect(capturePrependScrollRestoreState(container)).toEqual({
      mode: 'anchor',
      virtual: false,
      scrollHeight: 900,
      scrollTop: 80,
      anchorMessageId: 'msg-anchor',
      anchorViewportOffset: 80,
    });
  });

  it('restores anchor position after prepend using viewport offset delta', () => {
    const anchor = {
      getAttribute: (attr) => attr === 'data-chat-message-id' ? 'msg-anchor' : '',
      getBoundingClientRect: () => ({ top: 280, bottom: 320 }),
    };
    const container = {
      scrollTop: 200,
      scrollHeight: 1500,
      clientHeight: 400,
      getBoundingClientRect: () => ({ top: 100 }),
      querySelector: (selector) => (
        String(selector || '').includes('msg-anchor') ? anchor : null
      ),
    };
    const restore = {
      mode: 'anchor',
      virtual: false,
      scrollHeight: 900,
      scrollTop: 80,
      anchorMessageId: 'msg-anchor',
      anchorViewportOffset: 80,
    };

    expect(computePrependScrollRestoreTop(container, restore)).toBe(300);
  });

  it('defers pinned-bottom scroll while older history load or restore is pending', () => {
    expect(shouldDeferPinnedBottomScroll({ loadingOlder: true })).toBe(true);
    expect(shouldDeferPinnedBottomScroll({ prependRestorePending: true })).toBe(true);
    expect(shouldDeferPinnedBottomScroll({ loadingOlder: false, prependRestorePending: false })).toBe(false);
  });
});
