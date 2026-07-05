import { describe, expect, it } from 'vitest';

import {
  buildTracedAutoScrollSource,
  shouldRunChatAutoScrollLayoutEffect,
} from './useChatAutoScrollLayoutEffect';

describe('useChatAutoScrollLayoutEffect helpers', () => {
  it('shouldRunChatAutoScrollLayoutEffect requires container', () => {
    expect(shouldRunChatAutoScrollLayoutEffect({
      scrollMode: 'bottom',
      hasPendingInitialAnchor: false,
      container: null,
    })).toBe(false);
    expect(shouldRunChatAutoScrollLayoutEffect({
      scrollMode: false,
      hasPendingInitialAnchor: true,
      container: {},
    })).toBe(true);
    expect(shouldRunChatAutoScrollLayoutEffect({
      scrollMode: 'bottom_instant',
      hasPendingInitialAnchor: false,
      container: {},
    })).toBe(true);
  });

  it('buildTracedAutoScrollSource preserves mode and source', () => {
    expect(buildTracedAutoScrollSource('bottom', 'send')).toBe('autoScroll:bottom:send');
    expect(buildTracedAutoScrollSource('bottom_instant', '')).toBe('autoScroll:bottom_instant');
    expect(buildTracedAutoScrollSource('', 'send')).toBe('');
  });
});

describe('useChatAutoScrollLayoutEffect', () => {
  it('exports a default hook function', async () => {
    const module = await import('./useChatAutoScrollLayoutEffect');
    expect(typeof module.default).toBe('function');
  });
});
