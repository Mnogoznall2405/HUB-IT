import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useMailSelectedDetailLifecycle from './useMailSelectedDetailLifecycle';
import {
  getOrFetchSWR,
  peekSWRCache,
  setSWRCache,
} from '../../lib/swrCache';

vi.mock('../../lib/swrCache', () => ({
  getOrFetchSWR: vi.fn(async (cacheKey, fetcher) => ({
    data: await fetcher(),
    cacheKey,
    fromCache: false,
    isFresh: true,
  })),
  peekSWRCache: vi.fn(() => null),
  setSWRCache: vi.fn(),
}));

const createRefs = (overrides = {}) => ({
  selectedIdRef: { current: 'msg-1' },
  selectedMessageRef: { current: null },
  selectedConversationRef: { current: null },
  detailContextRef: { current: '' },
  detailRequestAbortRef: { current: null },
  suppressNextAutoReadRef: { current: '' },
  ...overrides,
});

const createProps = (overrides = {}) => ({
  activeMailboxId: 'mailbox-1',
  advancedFiltersApplied: { folder_scope: 'current' },
  beginAutoReadGuard: vi.fn(() => true),
  clearSelection: vi.fn(),
  folder: 'inbox',
  getMailErrorDetail: vi.fn(() => 'load failed'),
  getRecentMessageDetailSnapshot: vi.fn(() => null),
  handleMailCredentialsRequired: vi.fn(async () => false),
  invalidateMailClientCache: vi.fn(),
  isMissingMailDetailError: vi.fn(() => false),
  isTransientMailRequestError: vi.fn(() => false),
  mailAPI: {
    getConversation: vi.fn(),
    getMessage: vi.fn(async () => ({
      id: 'msg-1',
      is_read: false,
      body_text: 'Loaded body',
    })),
  },
  mailAccessReady: true,
  mailCacheScope: 'mailbox-1',
  mailDetailStaleTimeMs: 120000,
  navigate: vi.fn(),
  performMailReadMutation: vi.fn(),
  persistRecentMessageDetailSnapshot: vi.fn(),
  refreshList: vi.fn(),
  refs: createRefs(),
  resolveConversationReadStateOverrides: vi.fn((conversation) => conversation),
  resolveMessageReadStateOverrides: vi.fn((message) => message),
  selectedId: 'msg-1',
  setDetailLoading: vi.fn(),
  setError: vi.fn(),
  setSelectedConversation: vi.fn(),
  setSelectedMessage: vi.fn(),
  viewMode: 'messages',
  withActiveMailboxParams: vi.fn((params) => params),
  ...overrides,
});

describe('useMailSelectedDetailLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    peekSWRCache.mockReturnValue(null);
    getOrFetchSWR.mockImplementation(async (cacheKey, fetcher) => ({
      data: await fetcher(),
      cacheKey,
      fromCache: false,
      isFresh: true,
    }));
  });

  it('aborts active detail requests and clears selected detail when selection is unavailable', () => {
    const abort = vi.fn();
    const refs = createRefs({
      detailContextRef: { current: 'messages:inbox:msg-1' },
      detailRequestAbortRef: { current: { abort } },
    });
    const props = createProps({
      mailAccessReady: false,
      selectedId: '',
      refs,
    });

    renderHook(() => useMailSelectedDetailLifecycle(props));

    expect(abort).toHaveBeenCalledTimes(1);
    expect(refs.detailRequestAbortRef.current).toBeNull();
    expect(refs.detailContextRef.current).toBe('');
    expect(props.setDetailLoading).toHaveBeenCalledWith(false);
    expect(props.setSelectedMessage).toHaveBeenCalledWith(null);
    expect(props.setSelectedConversation).toHaveBeenCalledWith(null);
    expect(getOrFetchSWR).not.toHaveBeenCalled();
  });

  it('loads selected message detail and triggers the existing auto-read mutation path', async () => {
    const refs = createRefs();
    const props = createProps({ refs });

    renderHook(() => useMailSelectedDetailLifecycle(props));

    await waitFor(() => {
      expect(props.setSelectedMessage).toHaveBeenCalledWith(expect.objectContaining({
        id: 'msg-1',
        body_text: 'Loaded body',
      }));
    });

    expect(peekSWRCache).toHaveBeenCalledWith(
      ['mail', 'mailbox-1', 'message-detail', 'msg-1'],
      { staleTimeMs: 120000 }
    );
    expect(props.mailAPI.getMessage).toHaveBeenCalledWith(
      'msg-1',
      expect.objectContaining({ mailboxId: 'mailbox-1' })
    );
    expect(refs.detailContextRef.current).toBe('messages:inbox:msg-1');
    expect(setSWRCache).toHaveBeenCalledWith(
      ['mail', 'mailbox-1', 'message-detail', 'msg-1'],
      expect.objectContaining({ id: 'msg-1' })
    );
    expect(props.persistRecentMessageDetailSnapshot).toHaveBeenCalledWith(expect.objectContaining({ id: 'msg-1' }));
    expect(props.performMailReadMutation).toHaveBeenCalledWith({
      mode: 'messages',
      targetId: 'msg-1',
      nextIsRead: true,
      currentUnreadCount: 1,
      currentMessageCount: 1,
      errorMessage: 'Не удалось отметить письмо как прочитанное.',
      autoReadGuardKey: 'messages:inbox:msg-1:auto-read',
    });
    expect(props.setDetailLoading).toHaveBeenLastCalledWith(false);
  });

  it('returns fresh cached detail from revalidate without calling the API', async () => {
    const cachedMessage = {
      id: 'msg-1',
      is_read: true,
      body_text: 'Fresh cached body',
    };
    const refs = createRefs({
      detailContextRef: { current: 'messages:inbox:msg-1' },
    });
    const props = createProps({ refs });
    peekSWRCache.mockReturnValue({ data: cachedMessage, isFresh: true });
    getOrFetchSWR.mockResolvedValue({ data: cachedMessage, fromCache: true, isFresh: true });

    const { result } = renderHook(() => useMailSelectedDetailLifecycle(props));

    await waitFor(() => {
      expect(getOrFetchSWR).toHaveBeenCalled();
    });
    vi.clearAllMocks();
    peekSWRCache.mockReturnValue({ data: cachedMessage, isFresh: true });

    let revalidated;
    await act(async () => {
      revalidated = await result.current.revalidateSelectedMailDetail();
    });

    expect(revalidated).toBe(cachedMessage);
    expect(props.mailAPI.getMessage).not.toHaveBeenCalled();
    expect(getOrFetchSWR).not.toHaveBeenCalled();
    expect(props.performMailReadMutation).not.toHaveBeenCalled();
  });

  it('force refreshes message detail while preserving the previous body and without aborting active detail requests', async () => {
    const previousMessage = {
      id: 'msg-1',
      is_read: true,
      body_html: '<p>Existing body</p>',
      body_text: 'Existing body',
      attachments: [{ id: 'att-1' }],
    };
    const abort = vi.fn();
    const refs = createRefs({
      selectedMessageRef: { current: previousMessage },
      detailContextRef: { current: 'messages:inbox:msg-1' },
    });
    const props = createProps({ refs });
    getOrFetchSWR.mockResolvedValue({
      data: {
        id: 'msg-1',
        is_read: true,
        subject: 'Fresh metadata',
        body_html: '',
        body_text: '',
        attachments: [],
      },
      fromCache: false,
      isFresh: true,
    });

    const { result } = renderHook(() => useMailSelectedDetailLifecycle(props));

    await waitFor(() => {
      expect(props.setDetailLoading).toHaveBeenCalledWith(false);
    });
    vi.clearAllMocks();
    refs.selectedMessageRef.current = previousMessage;
    refs.detailContextRef.current = 'messages:inbox:msg-1';
    refs.detailRequestAbortRef.current = { abort };
    props.mailAPI.getMessage.mockResolvedValue({
      id: 'msg-1',
      is_read: true,
      subject: 'Fresh metadata',
      body_html: '',
      body_text: '',
      attachments: [],
    });
    getOrFetchSWR.mockImplementation(async (cacheKey, fetcher) => ({
      data: await fetcher(),
      cacheKey,
      fromCache: false,
      isFresh: true,
    }));

    let revalidated;
    await act(async () => {
      revalidated = await result.current.revalidateSelectedMailDetail({ force: true });
    });

    expect(abort).not.toHaveBeenCalled();
    expect(refs.detailRequestAbortRef.current).toEqual({ abort });
    expect(props.mailAPI.getMessage).toHaveBeenCalledWith('msg-1', { mailboxId: 'mailbox-1' });
    expect(getOrFetchSWR).toHaveBeenCalledWith(
      ['mail', 'mailbox-1', 'message-detail', 'msg-1'],
      expect.any(Function),
      {
        staleTimeMs: 120000,
        force: true,
        revalidateStale: false,
      }
    );
    expect(revalidated).toEqual(expect.objectContaining({
        id: 'msg-1',
        subject: 'Fresh metadata',
      body_html: '<p>Existing body</p>',
      body_text: 'Existing body',
      attachments: [{ id: 'att-1' }],
    }));
    expect(setSWRCache).toHaveBeenCalledWith(
      ['mail', 'mailbox-1', 'message-detail', 'msg-1'],
      expect.objectContaining({ body_html: '<p>Existing body</p>' })
    );
    expect(props.persistRecentMessageDetailSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-1',
      body_html: '<p>Existing body</p>',
    }));
    expect(props.setSelectedConversation).toHaveBeenCalledWith(null);
    expect(props.setSelectedMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-1',
      body_html: '<p>Existing body</p>',
    }));
    expect(props.performMailReadMutation).not.toHaveBeenCalled();
  });
});
