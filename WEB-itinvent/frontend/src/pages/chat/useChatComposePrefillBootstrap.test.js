import { describe, expect, it, vi } from 'vitest';

import {
  bootstrapComposePrefill,
  resolveComposePrefillConversationId,
  shouldHandleComposePrefillRoute,
  stripComposePrefillSearch,
} from './useChatComposePrefillBootstrap';
import useChatComposePrefillBootstrap from './useChatComposePrefillBootstrap';

describe('useChatComposePrefillBootstrap helpers', () => {
  it('stripComposePrefillSearch removes compose query param', () => {
    expect(stripComposePrefillSearch('?compose=prefill&conversation=c1')).toBe('?conversation=c1');
    expect(stripComposePrefillSearch('?compose=prefill')).toBe('');
  });

  it('resolveComposePrefillConversationId prefers loaded conversation id', () => {
    expect(resolveComposePrefillConversationId({ id: 'c1' }, [{ id: 'c1' }])).toBe('c1');
    expect(resolveComposePrefillConversationId({ id: 'c2' }, [{ id: 'c1' }])).toBe('c2');
    expect(resolveComposePrefillConversationId(null, [])).toBe('');
  });

  it('shouldHandleComposePrefillRoute gates feature flag, route, and handled state', () => {
    expect(shouldHandleComposePrefillRoute({
      chatFeatureEnabled: false,
      locationSearch: '?compose=prefill',
      handled: false,
    })).toBe(false);
    expect(shouldHandleComposePrefillRoute({
      locationSearch: '?conversation=c1',
      handled: false,
    })).toBe(false);
    expect(shouldHandleComposePrefillRoute({
      locationSearch: '?compose=prefill',
      handled: true,
    })).toBe(false);
    expect(shouldHandleComposePrefillRoute({
      locationSearch: '?compose=prefill',
      handled: false,
    })).toBe(true);
  });

  it('bootstrapComposePrefill clears invalid prefill and strips compose from url', async () => {
    const navigate = vi.fn();
    const clearPrefill = vi.fn();
    const readPrefill = vi.fn(() => ({ peerUserId: 0, bodyText: '' }));

    await bootstrapComposePrefill({
      locationSearch: '?compose=prefill',
      navigate,
      readPrefill,
      clearPrefill,
      resetSidebarSearch: vi.fn(),
      loadConversations: vi.fn(),
      shareComposeDraftRef: { current: null },
      openConversation: vi.fn(),
      focusComposer: vi.fn(),
      notifyApiError: vi.fn(),
    });

    expect(clearPrefill).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      { pathname: '/chat', search: '' },
      { replace: true },
    );
  });

  it('bootstrapComposePrefill opens conversation and seeds share draft', async () => {
    const navigate = vi.fn();
    const clearPrefill = vi.fn();
    const readPrefill = vi.fn(() => ({ peerUserId: 42, bodyText: 'hello share' }));
    const createDirectConversation = vi.fn().mockResolvedValue({ id: 'c1' });
    const resetSidebarSearch = vi.fn();
    const loadConversations = vi.fn().mockResolvedValue([{ id: 'c1' }]);
    const shareComposeDraftRef = { current: null };
    const openConversation = vi.fn();
    const focusComposer = vi.fn();
    const setTimeoutFn = vi.fn((callback) => {
      callback();
      return 1;
    });

    await bootstrapComposePrefill({
      locationSearch: '?compose=prefill',
      navigate,
      readPrefill,
      clearPrefill,
      createDirectConversation,
      resetSidebarSearch,
      loadConversations,
      shareComposeDraftRef,
      openConversation,
      focusComposer,
      notifyApiError: vi.fn(),
      setTimeoutFn,
    });

    expect(createDirectConversation).toHaveBeenCalledWith(42);
    expect(resetSidebarSearch).toHaveBeenCalledTimes(1);
    expect(loadConversations).toHaveBeenCalledWith({ silent: true, force: true });
    expect(shareComposeDraftRef.current).toEqual({ conversationId: 'c1', bodyText: 'hello share' });
    expect(openConversation).toHaveBeenCalledWith('c1');
    expect(focusComposer).toHaveBeenCalledTimes(1);
    expect(clearPrefill).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      { pathname: '/chat', search: '' },
      { replace: true },
    );
  });

  it('bootstrapComposePrefill notifies on createDirectConversation failure', async () => {
    const notifyApiError = vi.fn();
    const error = new Error('network');

    await bootstrapComposePrefill({
      locationSearch: '?compose=prefill',
      navigate: vi.fn(),
      readPrefill: vi.fn(() => ({ peerUserId: 42, bodyText: 'hello share' })),
      clearPrefill: vi.fn(),
      createDirectConversation: vi.fn().mockRejectedValue(error),
      resetSidebarSearch: vi.fn(),
      loadConversations: vi.fn(),
      shareComposeDraftRef: { current: null },
      openConversation: vi.fn(),
      focusComposer: vi.fn(),
      notifyApiError,
    });

    expect(notifyApiError).toHaveBeenCalledWith(error, 'Не удалось открыть чат для отправки файла.');
  });
});

describe('useChatComposePrefillBootstrap', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatComposePrefillBootstrap).toBe('function');
  });

  it('mounts without throwing when compose prefill route is absent', async () => {
    const { renderHook } = await import('@testing-library/react');

    const { unmount } = renderHook(() => useChatComposePrefillBootstrap({
      focusComposer: vi.fn(),
      loadConversations: vi.fn(),
      locationSearch: '?conversation=c1',
      navigate: vi.fn(),
      notifyApiError: vi.fn(),
      openConversation: vi.fn(),
      resetSidebarSearch: vi.fn(),
      shareComposeDraftRef: { current: null },
    }));

    unmount();
  });
});
