import { describe, expect, it, vi } from 'vitest';

import {
  buildPinnedMessagePayloadFromMessage,
  parseStoredPinnedMessage,
  readLocalStorageJsonObject,
  resolveHeavyChatSurfacePrefetchTargets,
  scheduleHeavyChatSurfacePrefetch,
  shouldSkipPinnedMessageReconcile,
} from './useChatActiveConversationSurfaceEffects';
import useChatActiveConversationSurfaceEffects from './useChatActiveConversationSurfaceEffects';

describe('useChatActiveConversationSurfaceEffects helpers', () => {
  it('readLocalStorageJsonObject returns parsed objects only', () => {
    window.localStorage.setItem('valid', '{"id":"m1"}');
    window.localStorage.setItem('array', '[]');
    window.localStorage.setItem('bad', '{');
    try {
      expect(readLocalStorageJsonObject('valid')).toEqual({ id: 'm1' });
      expect(readLocalStorageJsonObject('array')).toBeNull();
      expect(readLocalStorageJsonObject('bad')).toBeNull();
      expect(readLocalStorageJsonObject('')).toBeNull();
    } finally {
      window.localStorage.removeItem('valid');
      window.localStorage.removeItem('array');
      window.localStorage.removeItem('bad');
    }
  });

  it('buildPinnedMessagePayloadFromMessage maps message fields', () => {
    expect(buildPinnedMessagePayloadFromMessage(null)).toBeNull();
    expect(buildPinnedMessagePayloadFromMessage({ id: '' })).toBeNull();
    const payload = buildPinnedMessagePayloadFromMessage({
      id: 'm-42',
      sender: { full_name: 'Alice', username: 'alice' },
      body: 'Hello',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(payload?.id).toBe('m-42');
    expect(payload?.senderName).toBe('Alice');
    expect(payload?.createdAt).toBe('2026-01-01T00:00:00Z');
  });

  it('parseStoredPinnedMessage normalizes storage payload', () => {
    expect(parseStoredPinnedMessage(null)).toBeNull();
    expect(parseStoredPinnedMessage({ id: '  ' })).toBeNull();
    expect(parseStoredPinnedMessage({
      id: 'm1',
      senderName: ' Bob ',
      preview: ' hi ',
      createdAt: ' t ',
    })).toEqual({
      id: 'm1',
      senderName: 'Bob',
      preview: 'hi',
      createdAt: 't',
    });
  });

  it('shouldSkipPinnedMessageReconcile detects unchanged payloads', () => {
    const current = {
      id: 'm1',
      senderName: 'Alice',
      preview: 'Hi',
      createdAt: 't1',
    };
    expect(shouldSkipPinnedMessageReconcile(current, null)).toBe(true);
    expect(shouldSkipPinnedMessageReconcile(current, { ...current })).toBe(true);
    expect(shouldSkipPinnedMessageReconcile(current, {
      ...current,
      preview: 'Updated',
    })).toBe(false);
  });

  it('resolveHeavyChatSurfacePrefetchTargets respects mobile and panel flags', () => {
    expect(resolveHeavyChatSurfacePrefetchTargets({
      isMobile: true,
      showContextPanel: true,
      showTaskPanel: true,
    })).toEqual({ prefetchContextPanel: false, prefetchTaskPanel: false });
    expect(resolveHeavyChatSurfacePrefetchTargets({
      isMobile: false,
      showContextPanel: true,
      showTaskPanel: false,
    })).toEqual({ prefetchContextPanel: true, prefetchTaskPanel: false });
  });

  it('scheduleHeavyChatSurfacePrefetch prefers requestIdleCallback', () => {
    const callback = vi.fn();
    const requestIdleCallback = vi.fn((cb) => {
      cb();
      return 11;
    });
    const cancelIdleCallback = vi.fn();
    const cleanup = scheduleHeavyChatSurfacePrefetch(callback, {
      requestIdleCallback,
      cancelIdleCallback,
      setTimeoutFn: vi.fn(),
      clearTimeoutFn: vi.fn(),
    });
    expect(requestIdleCallback).toHaveBeenCalledWith(callback, { timeout: 1500 });
    expect(callback).toHaveBeenCalledTimes(1);
    cleanup();
    expect(cancelIdleCallback).toHaveBeenCalledWith(11);
  });

  it('scheduleHeavyChatSurfacePrefetch falls back to setTimeout', () => {
    const callback = vi.fn();
    const setTimeoutFn = vi.fn((cb) => {
      cb();
      return 22;
    });
    const clearTimeoutFn = vi.fn();
    const cleanup = scheduleHeavyChatSurfacePrefetch(callback, {
      requestIdleCallback: undefined,
      setTimeoutFn,
      clearTimeoutFn,
    });
    expect(setTimeoutFn).toHaveBeenCalledWith(callback, 900);
    expect(callback).toHaveBeenCalledTimes(1);
    cleanup();
    expect(clearTimeoutFn).toHaveBeenCalledWith(22);
  });
});

describe('useChatActiveConversationSurfaceEffects', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatActiveConversationSurfaceEffects).toBe('function');
  });

  it('mounts without throwing when AI status is skipped', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { unmount } = renderHook(() => useChatActiveConversationSurfaceEffects({
      activeConversationId: '',
      activeConversationKind: 'direct',
      canUseAiChat: false,
      isMobile: false,
      messages: [],
      persistPinnedMessage: vi.fn(),
      pinnedMessage: null,
      pinnedMessageStorageKey: '',
      setAiStatusByConversation: vi.fn(),
      setPinnedMessage: vi.fn(),
      showContextPanel: false,
      showTaskPanel: false,
    }));
    unmount();
  });
});
