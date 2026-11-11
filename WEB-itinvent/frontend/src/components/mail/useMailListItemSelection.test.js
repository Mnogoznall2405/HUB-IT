import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailListItemSelection from './useMailListItemSelection';

const createDeps = (overrides = {}) => ({
  isMobile: false,
  viewMode: 'messages',
  folder: 'inbox',
  selectedMessageIds: [],
  selectedIdRef: { current: '' },
  selectedMessageRef: { current: null },
  activeMailboxId: 'mb-1',
  mailAPI: { getMessage: vi.fn() },
  getRecentMessageDetailSnapshot: vi.fn(() => null),
  getMailErrorDetail: vi.fn((error, fallback) => fallback),
  openComposeFromDraftMessage: vi.fn(),
  saveCurrentListScrollPosition: vi.fn(),
  revalidateSelectedMailDetail: vi.fn(),
  performMailReadMutation: vi.fn(),
  closeMobileNavigationIfNeeded: vi.fn(),
  setSelectedItems: vi.fn(),
  setDetailLoading: vi.fn(),
  setSelectedConversation: vi.fn(),
  setSelectedMessage: vi.fn(),
  setSelectedId: vi.fn(),
  setSelectedByMode: vi.fn(),
  setMoveTarget: vi.fn(),
  setError: vi.fn(),
  ...overrides,
});

describe('useMailListItemSelection', () => {
  it('starts marking an unread message read as soon as it is selected', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useMailListItemSelection(deps));

    await act(async () => {
      await result.current('msg-1', { id: 'msg-1', is_read: false });
    });

    expect(deps.performMailReadMutation).toHaveBeenCalledWith({
      mode: 'messages',
      targetId: 'msg-1',
      nextIsRead: true,
      currentUnreadCount: 1,
      currentMessageCount: 1,
      errorMessage: 'Не удалось отметить письмо как прочитанное.',
    });
    expect(deps.performMailReadMutation.mock.invocationCallOrder[0])
      .toBeLessThan(deps.setSelectedId.mock.invocationCallOrder[0]);
  });

  it('starts marking an unread conversation read before opening its detail', async () => {
    const deps = createDeps({ viewMode: 'conversations' });
    const { result } = renderHook(() => useMailListItemSelection(deps));

    await act(async () => {
      await result.current('conv-1', {
        conversation_id: 'conv-1',
        unread_count: 2,
        messages_count: 4,
      });
    });

    expect(deps.performMailReadMutation).toHaveBeenCalledWith({
      mode: 'conversations',
      targetId: 'conv-1',
      nextIsRead: true,
      currentUnreadCount: 2,
      currentMessageCount: 4,
      errorMessage: 'Не удалось отметить диалог как прочитанный.',
    });
    expect(deps.performMailReadMutation.mock.invocationCallOrder[0])
      .toBeLessThan(deps.setSelectedId.mock.invocationCallOrder[0]);
  });

  it('does not mark an already read message again when it is selected', async () => {
    const deps = createDeps();
    const { result } = renderHook(() => useMailListItemSelection(deps));

    await act(async () => {
      await result.current('msg-1', { id: 'msg-1', is_read: true });
    });

    expect(deps.performMailReadMutation).not.toHaveBeenCalled();
  });

  it('toggles bulk selection on mobile instead of opening a message', async () => {
    const deps = createDeps({
      isMobile: true,
      selectedMessageIds: ['msg-1'],
    });
    const { result } = renderHook(() => useMailListItemSelection(deps));
    await act(async () => {
      await result.current('msg-2', { id: 'msg-2' });
    });
    const updater = deps.setSelectedItems.mock.calls[0][0];
    expect(updater(['msg-1'])).toEqual(['msg-1', 'msg-2']);
    expect(deps.setSelectedId).not.toHaveBeenCalled();
  });

  it('opens a draft in compose from recent cache', async () => {
    const draftDetail = { id: 'draft-1', subject: 'Draft' };
    const deps = createDeps({
      folder: 'drafts',
      getRecentMessageDetailSnapshot: vi.fn(() => draftDetail),
    });
    const { result } = renderHook(() => useMailListItemSelection(deps));
    await act(async () => {
      await result.current('draft-1', { id: 'draft-1' });
    });
    expect(deps.mailAPI.getMessage).not.toHaveBeenCalled();
    expect(deps.openComposeFromDraftMessage).toHaveBeenCalledWith(draftDetail);
    expect(deps.setSelectedId).toHaveBeenCalledWith('draft-1');
    expect(deps.setDetailLoading).toHaveBeenNthCalledWith(1, true);
    expect(deps.setDetailLoading).toHaveBeenLastCalledWith(false);
  });

  it('paints a preview shell and revalidates when the same preview is already selected', async () => {
    const item = { id: 'msg-9', subject: 'Hello', sender: 'a@b.c' };
    const deps = createDeps({
      selectedIdRef: { current: 'msg-9' },
      selectedMessageRef: { current: { id: 'msg-9', __previewOnly: true } },
    });
    const { result } = renderHook(() => useMailListItemSelection(deps));
    await act(async () => {
      await result.current('msg-9', item);
    });
    expect(deps.saveCurrentListScrollPosition).toHaveBeenCalledWith({ selectedMessageIdAtOpen: 'msg-9' });
    expect(deps.setSelectedMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-9',
      subject: 'Hello',
    }));
    expect(deps.revalidateSelectedMailDetail).toHaveBeenCalledWith({ force: true });
  });

  it('does not replace a fully opened message with a preview shell', async () => {
    const deps = createDeps({
      selectedIdRef: { current: 'msg-9' },
      selectedMessageRef: { current: { id: 'msg-9' } },
    });
    const { result } = renderHook(() => useMailListItemSelection(deps));
    await act(async () => {
      await result.current('msg-9', { id: 'msg-9' });
    });
    expect(deps.setSelectedMessage).not.toHaveBeenCalled();
    expect(deps.revalidateSelectedMailDetail).not.toHaveBeenCalled();
    expect(deps.setSelectedId).toHaveBeenCalledWith('msg-9');
  });
});
