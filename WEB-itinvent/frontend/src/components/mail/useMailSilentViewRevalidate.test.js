import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailSilentViewRevalidate from './useMailSilentViewRevalidate';

const createDeps = (overrides = {}) => ({
  mailAccessReady: true,
  mailConfigLoading: false,
  mailCacheScope: 'mailbox-1',
  currentListContextKey: 'messages:inbox',
  viewMode: 'messages',
  folder: 'inbox',
  mailboxInfo: { id: 'mailbox-1' },
  folderTreeRef: { current: [{ id: 'inbox' }] },
  folderSummaryRef: { current: { inbox: { unread: 1 } } },
  folderSummaryRefreshCompletedAtRef: { current: Date.now() },
  selectedIdRef: { current: 'msg-1' },
  hasFreshSelectedMailDetail: vi.fn(() => true),
  refreshBootstrap: vi.fn(async () => undefined),
  refreshList: vi.fn(async () => undefined),
  refreshFolderSummary: vi.fn(async () => undefined),
  revalidateSelectedMailDetail: vi.fn(async () => undefined),
  runMailViewRefreshGate: vi.fn((_key, task, options) => task().then(() => options)),
  setMailBackgroundRefreshing: vi.fn(),
  folderSummaryRefreshCooldownMs: 120000,
  ...overrides,
});

describe('useMailSilentViewRevalidate', () => {
  it('does nothing when mail is not ready or config is still loading', async () => {
    const blocked = createDeps({ mailAccessReady: false });
    const { result: blockedResult } = renderHook(() => useMailSilentViewRevalidate(blocked));
    await blockedResult.current();
    expect(blocked.runMailViewRefreshGate).not.toHaveBeenCalled();

    const loading = createDeps({ mailConfigLoading: true });
    const { result: loadingResult } = renderHook(() => useMailSilentViewRevalidate(loading));
    await loadingResult.current();
    expect(loading.runMailViewRefreshGate).not.toHaveBeenCalled();
  });

  it('falls back to bootstrap when folder tree or summary is missing', async () => {
    const deps = createDeps({
      mailboxInfo: null,
      selectedIdRef: { current: '' },
    });
    const { result } = renderHook(() => useMailSilentViewRevalidate(deps));

    await result.current({ reason: 'timer' });

    expect(deps.refreshBootstrap).toHaveBeenCalledWith({ force: true });
    expect(deps.refreshList).not.toHaveBeenCalled();
    expect(deps.setMailBackgroundRefreshing).toHaveBeenNthCalledWith(1, true);
    expect(deps.setMailBackgroundRefreshing).toHaveBeenLastCalledWith(false);
  });

  it('silently refreshes the list and stale selected detail', async () => {
    const deps = createDeps({
      hasFreshSelectedMailDetail: vi.fn(() => false),
    });
    const { result } = renderHook(() => useMailSilentViewRevalidate(deps));

    await result.current({ reason: 'auto' });

    expect(deps.refreshList).toHaveBeenCalledWith({ silent: true, force: true });
    expect(deps.revalidateSelectedMailDetail).toHaveBeenCalledWith({ force: false });
    expect(deps.refreshBootstrap).not.toHaveBeenCalled();
  });
});
