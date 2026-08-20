import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import useMailDeepLinkSelection from './useMailDeepLinkSelection';

const createDeps = (overrides = {}) => ({
  locationSearch: '',
  activeMailboxId: 'mb-1',
  folder: 'inbox',
  viewMode: 'messages',
  lastAppliedMailboxViewStateRef: { current: 'mb-1' },
  deepLinkKeyRef: { current: '' },
  selectedIdRef: { current: '' },
  setSelectedMailboxId: vi.fn(),
  setFolder: vi.fn(),
  setViewMode: vi.fn(),
  setSelectedItems: vi.fn(),
  setSelectedByMode: vi.fn(),
  setSelectedId: vi.fn(),
  persistSelectedMailboxId: vi.fn(),
  ...overrides,
});

describe('useMailDeepLinkSelection', () => {
  it('switches mailbox from the route without applying the message yet', () => {
    const deps = createDeps({
      locationSearch: '?mailbox_id=mb-2&folder=sent&message=msg-9',
    });

    renderHook(() => useMailDeepLinkSelection(deps));

    expect(deps.lastAppliedMailboxViewStateRef.current).toBe('');
    expect(deps.setSelectedMailboxId).toHaveBeenCalledWith('mb-2');
    expect(deps.persistSelectedMailboxId).toHaveBeenCalledWith('mb-2');
    expect(deps.setSelectedId).not.toHaveBeenCalled();
    expect(deps.setFolder).not.toHaveBeenCalled();
  });

  it('clears the deep-link key when the route has no message', () => {
    const deps = createDeps({
      locationSearch: '?folder=inbox',
      deepLinkKeyRef: { current: 'inbox:msg-1' },
    });

    renderHook(() => useMailDeepLinkSelection(deps));

    expect(deps.deepLinkKeyRef.current).toBe('');
    expect(deps.setSelectedId).not.toHaveBeenCalled();
  });

  it('selects the deep-linked message and forces messages view', () => {
    const deps = createDeps({
      locationSearch: '?folder=sent&message=msg-9',
      folder: 'inbox',
      viewMode: 'conversations',
    });

    renderHook(() => useMailDeepLinkSelection(deps));

    expect(deps.deepLinkKeyRef.current).toBe('sent:msg-9');
    expect(deps.setFolder).toHaveBeenCalledWith('sent');
    expect(deps.setViewMode).toHaveBeenCalledWith('messages');
    expect(deps.setSelectedItems).toHaveBeenCalledWith([]);
    expect(deps.setSelectedId).toHaveBeenCalledWith('msg-9');
    expect(deps.selectedIdRef.current).toBe('msg-9');

    const updater = deps.setSelectedByMode.mock.calls[0][0];
    expect(updater({ conversations: 'c-1' })).toEqual({
      conversations: 'c-1',
      messages: 'msg-9',
    });
  });

  it('does not re-apply the same deep-link key', () => {
    const deps = createDeps({
      locationSearch: '?folder=inbox&message=msg-9',
      deepLinkKeyRef: { current: 'inbox:msg-9' },
    });

    renderHook(() => useMailDeepLinkSelection(deps));

    expect(deps.setSelectedId).not.toHaveBeenCalled();
    expect(deps.setFolder).not.toHaveBeenCalled();
  });
});
