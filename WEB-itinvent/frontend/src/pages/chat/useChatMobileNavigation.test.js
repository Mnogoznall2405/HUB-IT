import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import useChatMobileNavigation from './useChatMobileNavigation';

describe('useChatMobileNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes mobile history helpers', () => {
    const { result } = renderHook(() => useChatMobileNavigation({
      isMobile: true,
      activeConversationIdRef: { current: 'c1' },
      mobileHistoryReadyRef: { current: true },
      mobileHistoryModeRef: { current: '' },
      setMobileView: vi.fn(),
      setMobileTransitionDirection: vi.fn(),
      setMobileBottomNavHidden: vi.fn(),
      setInfoOpen: vi.fn(),
      closeDrawer: vi.fn(),
      location: { pathname: '/chat', search: '', hash: '' },
      requestedConversationId: '',
      requestedMessageId: '',
    }));

    expect(typeof result.current.getMobileHistoryKey).toBe('function');
    expect(typeof result.current.readMobileHistoryState).toBe('function');
    expect(typeof result.current.openMobileThreadView).toBe('function');
    expect(typeof result.current.openMobileInboxView).toBe('function');
  });

  it('openMobileThreadView is no-op on desktop', () => {
    const setMobileView = vi.fn();
    const { result } = renderHook(() => useChatMobileNavigation({
      isMobile: false,
      activeConversationIdRef: { current: 'c1' },
      mobileHistoryReadyRef: { current: true },
      mobileHistoryModeRef: { current: '' },
      setMobileView,
      setMobileTransitionDirection: vi.fn(),
      setMobileBottomNavHidden: vi.fn(),
      setInfoOpen: vi.fn(),
      closeDrawer: vi.fn(),
      location: { pathname: '/chat', search: '', hash: '' },
      requestedConversationId: '',
      requestedMessageId: '',
    }));

    act(() => {
      result.current.openMobileThreadView('c1');
    });
    expect(setMobileView).not.toHaveBeenCalled();
  });
});
