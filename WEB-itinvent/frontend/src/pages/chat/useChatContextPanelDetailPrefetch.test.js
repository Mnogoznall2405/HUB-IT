import { describe, expect, it, vi } from 'vitest';

import {
  normalizeActiveConversationId,
  shouldPrefetchConversationDetail,
} from './useChatContextPanelDetailPrefetch';
import useChatContextPanelDetailPrefetch from './useChatContextPanelDetailPrefetch';

describe('useChatContextPanelDetailPrefetch helpers', () => {
  it('normalizeActiveConversationId trims ids', () => {
    expect(normalizeActiveConversationId('  c1  ')).toBe('c1');
    expect(normalizeActiveConversationId(null)).toBe('');
  });

  it('shouldPrefetchConversationDetail requires conversation id and open panel', () => {
    expect(shouldPrefetchConversationDetail({
      activeConversationId: '',
      contextPanelOpen: true,
      infoOpen: false,
    })).toBe(false);
    expect(shouldPrefetchConversationDetail({
      activeConversationId: 'c1',
      contextPanelOpen: false,
      infoOpen: false,
    })).toBe(false);
    expect(shouldPrefetchConversationDetail({
      activeConversationId: 'c1',
      contextPanelOpen: true,
      infoOpen: false,
    })).toBe(true);
    expect(shouldPrefetchConversationDetail({
      activeConversationId: 'c1',
      contextPanelOpen: false,
      infoOpen: true,
    })).toBe(true);
  });
});

describe('useChatContextPanelDetailPrefetch', () => {
  it('exports a default hook function', () => {
    expect(typeof useChatContextPanelDetailPrefetch).toBe('function');
  });

  it('loads conversation detail when context panel is open', async () => {
    const { renderHook } = await import('@testing-library/react');
    const loadConversationDetail = vi.fn().mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useChatContextPanelDetailPrefetch({
      activeConversationId: 'c1',
      contextPanelOpen: true,
      infoOpen: false,
      loadConversationDetail,
    }));

    expect(loadConversationDetail).toHaveBeenCalledWith('c1', { signal: expect.any(AbortSignal) });
    unmount();
  });

  it('skips detail load when panels are closed', async () => {
    const { renderHook } = await import('@testing-library/react');
    const loadConversationDetail = vi.fn().mockResolvedValue(undefined);

    const { unmount } = renderHook(() => useChatContextPanelDetailPrefetch({
      activeConversationId: 'c1',
      contextPanelOpen: false,
      infoOpen: false,
      loadConversationDetail,
    }));

    expect(loadConversationDetail).not.toHaveBeenCalled();
    unmount();
  });
});
