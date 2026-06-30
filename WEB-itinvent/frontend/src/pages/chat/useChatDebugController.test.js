import { describe, expect, it, vi } from 'vitest';

import {
  buildChatDebugLogPayload,
  CHAT_DEBUG_STORAGE_KEY,
  isChatDebugEnabled,
} from './useChatDebugController';
import { CHAT_REVEAL_MAX_ITERATIONS, shouldContinueRevealMessageSearch } from './useChatRevealMessage';
import { resolveChatHealthErrorMessage } from './useChatHealthBootstrap';

describe('useChatDebugController helpers', () => {
  it('isChatDebugEnabled respects disabled sentinel values', () => {
    expect(isChatDebugEnabled({ readStorageItem: () => '1' })).toBe(true);
    expect(isChatDebugEnabled({ readStorageItem: () => 'false' })).toBe(false);
    expect(isChatDebugEnabled({ readStorageItem: () => '' })).toBe(false);
    expect(CHAT_DEBUG_STORAGE_KEY).toBe('chat:debug');
  });

  it('buildChatDebugLogPayload increments debug sequence', () => {
    const chatDebugSeqRef = { current: 3 };
    const result = buildChatDebugLogPayload({
      event: 'test',
      chatDebugSeqRef,
      resolveActiveThreadTransportState: () => 'idle',
    });
    expect(result.label).toBe('[chat-debug #4] test');
    expect(chatDebugSeqRef.current).toBe(4);
  });
});

describe('useChatRevealMessage helpers', () => {
  it('shouldContinueRevealMessageSearch stops at max iterations', () => {
    expect(shouldContinueRevealMessageSearch({
      messagesHasMore: true,
      iterations: CHAT_REVEAL_MAX_ITERATIONS,
    })).toBe(false);
    expect(shouldContinueRevealMessageSearch({
      messagesHasMore: false,
      iterations: 0,
    })).toBe(false);
  });
});

describe('useChatHealthBootstrap helpers', () => {
  it('resolveChatHealthErrorMessage prefers API detail', () => {
    expect(resolveChatHealthErrorMessage({ response: { data: { detail: 'down' } } })).toBe('down');
    expect(resolveChatHealthErrorMessage(null)).toContain('chat backend');
  });
});

describe('useChatDebugController hook', () => {
  it('exports a default hook function', async () => {
    const module = await import('./useChatDebugController');
    expect(typeof module.default).toBe('function');
  });
});

describe('useChatRevealMessage hook', () => {
  it('exports a default hook function', async () => {
    const module = await import('./useChatRevealMessage');
    expect(typeof module.default).toBe('function');
  });
});
