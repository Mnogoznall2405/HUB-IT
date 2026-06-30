import { describe, expect, it, vi } from 'vitest';

import {
  CHAT_AI_ACTIVE_POLL_MS,
  CHAT_AI_ACTIVE_POLL_WS_CONNECTED_MS,
  CHAT_ACTIVE_THREAD_INCREMENTAL_POLL_MS,
  CHAT_LIST_POLL_MS,
  CHAT_MESSAGE_HIGHLIGHT_MS,
  CHAT_SEARCH_DEBOUNCE_MS,
  CHAT_SWR_STALE_TIME_MS,
  CHAT_THREAD_POLL_MS,
} from './chatPageConstants';
import {
  readSelectedDatabaseId,
  readSessionStorageValue,
  resolveRestoredMobileView,
} from './chatSessionStorage';
import { emitChatUnreadRefresh } from './chatUnreadRefresh';
import {
  scheduleMessageHighlight,
  scrollThreadToMessage,
} from './useChatMessageScrollHighlight';

describe('chatPageConstants', () => {
  it('exposes stable chat page timing constants', () => {
    expect(CHAT_LIST_POLL_MS).toBe(15_000);
    expect(CHAT_THREAD_POLL_MS).toBeGreaterThan(0);
    expect(CHAT_ACTIVE_THREAD_INCREMENTAL_POLL_MS).toBe(1_000);
    expect(CHAT_AI_ACTIVE_POLL_MS).toBe(1_000);
    expect(CHAT_AI_ACTIVE_POLL_WS_CONNECTED_MS).toBe(10_000);
    expect(CHAT_SEARCH_DEBOUNCE_MS).toBe(250);
    expect(CHAT_SWR_STALE_TIME_MS).toBe(30_000);
    expect(CHAT_MESSAGE_HIGHLIGHT_MS).toBe(2_600);
  });
});

describe('chatSessionStorage helpers', () => {
  it('readSessionStorageValue returns trimmed values', () => {
    window.sessionStorage.setItem('chat:test', ' value ');
    expect(readSessionStorageValue('chat:test')).toBe('value');
    expect(readSessionStorageValue('')).toBe('');
  });

  it('readSessionStorageValue returns empty string on storage errors', () => {
    const getItem = vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readSessionStorageValue('chat:blocked')).toBe('');
    getItem.mockRestore();
  });

  it('readSelectedDatabaseId reads selected_database from localStorage', () => {
    window.localStorage.setItem('selected_database', ' db-main ');
    expect(readSelectedDatabaseId()).toBe('db-main');
  });

  it('resolveRestoredMobileView maps thread session value', () => {
    window.sessionStorage.setItem('chat:mobile', 'thread');
    expect(resolveRestoredMobileView('chat:mobile')).toBe('thread');
    window.sessionStorage.setItem('chat:mobile', 'inbox');
    expect(resolveRestoredMobileView('chat:mobile')).toBe('inbox');
  });
});

describe('chatUnreadRefresh', () => {
  it('dispatches unread and hub refresh events', () => {
    const unreadHandler = vi.fn();
    const hubHandler = vi.fn();
    window.addEventListener('chat-unread-needs-refresh', unreadHandler);
    window.addEventListener('hub-refresh-notifications', hubHandler);
    emitChatUnreadRefresh();
    expect(unreadHandler).toHaveBeenCalledTimes(1);
    expect(hubHandler).toHaveBeenCalledTimes(1);
    window.removeEventListener('chat-unread-needs-refresh', unreadHandler);
    window.removeEventListener('hub-refresh-notifications', hubHandler);
  });
});

describe('useChatMessageScrollHighlight helpers', () => {
  it('scheduleMessageHighlight stores timeout id and updates highlight state', () => {
    vi.useFakeTimers();
    const setHighlightedMessageId = vi.fn();
    const highlightResetTimeoutRef = { current: null };
    expect(scheduleMessageHighlight({
      messageId: ' msg-1 ',
      setHighlightedMessageId,
      highlightResetTimeoutRef,
    })).toBe(true);
    expect(setHighlightedMessageId).toHaveBeenCalledWith('msg-1');
    expect(highlightResetTimeoutRef.current).not.toBeNull();
    vi.advanceTimersByTime(CHAT_MESSAGE_HIGHLIGHT_MS);
    vi.useRealTimers();
  });

  it('scrollThreadToMessage scrolls matching message nodes and highlights them', () => {
    const target = { scrollIntoView: vi.fn() };
    const threadScrollRef = {
      current: {
        querySelector: vi.fn(() => target),
      },
    };
    const highlightMessage = vi.fn();
    expect(scrollThreadToMessage({
      messageId: 'msg-42',
      threadScrollRef,
      cancelPendingInitialAnchor: vi.fn(),
      traceProgrammaticThreadScroll: vi.fn(),
      highlightMessage,
    })).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    expect(highlightMessage).toHaveBeenCalledWith('msg-42');
  });
});
