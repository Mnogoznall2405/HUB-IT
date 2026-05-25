import { useRef, useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSWRCache, setSWRCache } from '../../lib/swrCache';
import {
  buildMailBootstrapCacheKey,
  buildMailFolderSummaryCacheKey,
  buildMailFolderTreeCacheKey,
  buildMailListRequestContext,
  createEmptyListData,
} from './mailListModel';
import useMailListDataController from './useMailListDataController';

const DEFAULT_MAIL_PREFERENCES = { compact: false };

const createMailAPI = (overrides = {}) => ({
  getBootstrap: vi.fn(async () => ({})),
  getConversations: vi.fn(async () => createEmptyListData()),
  getFolderSummary: vi.fn(async () => ({ items: {} })),
  getFolderTree: vi.fn(async () => ({ items: [] })),
  getMessages: vi.fn(async () => createEmptyListData()),
  ...overrides,
});

const createMessage = (id, overrides = {}) => ({
  id,
  subject: id,
  is_read: false,
  received_at: `2026-01-01T00:00:0${id.length}Z`,
  ...overrides,
});

const renderController = (options = {}) => {
  const scope = options.scope || 'mailbox-1';
  const folder = options.folder || 'inbox';
  const viewMode = options.viewMode || 'messages';
  const advancedFiltersApplied = options.advancedFiltersApplied || { folder_scope: 'current' };
  const requestContext = buildMailListRequestContext({
    scope,
    folder,
    viewMode,
    advancedFilters: advancedFiltersApplied,
    limit: 50,
    offset: 0,
  });
  const mailAPI = options.mailAPI || createMailAPI();
  const props = {
    activeMailboxId: scope,
    advancedFiltersApplied,
    clearSelection: vi.fn(),
    currentContextUsesBootstrapList: true,
    currentFolderScope: requestContext.folderScope,
    currentFolderSummaryCacheKey: buildMailFolderSummaryCacheKey({ scope }),
    currentFolderTreeCacheKey: buildMailFolderTreeCacheKey({ scope }),
    currentListCacheKey: requestContext.cacheKey,
    currentListContextKey: requestContext.contextKey,
    currentListParams: requestContext.params,
    debouncedSearch: '',
    defaultMailPreferences: DEFAULT_MAIL_PREFERENCES,
    filterDateFrom: '',
    filterDateTo: '',
    folder,
    getMailErrorDetail: vi.fn((error, fallback) => fallback),
    handleMailCredentialsRequired: vi.fn(async () => false),
    hasAttachmentsOnly: false,
    isMobile: false,
    isTransientMailRequestError: vi.fn(() => false),
    mailAccessReady: true,
    mailAPI,
    mailBootstrapLimit: 20,
    mailCacheScope: scope,
    mailSwrStaleTimeMs: 45000,
    persistRecentBootstrapSnapshot: vi.fn(),
    persistRecentListSnapshot: vi.fn(),
    recentHydratedScope: '',
    resolveListDataReadStateOverrides: vi.fn((listData) => listData),
    setError: vi.fn(),
    unreadOnly: false,
    viewMode,
    withActiveMailboxParams: vi.fn((params) => ({ mailbox_id: scope, ...params })),
    ...options.props,
  };
  const initialState = {
    folderSummary: {},
    folderTree: [],
    listData: createEmptyListData(),
    loading: false,
    loadingMore: false,
    mailBackgroundRefreshing: false,
    mailConfigLoading: true,
    mailPreferences: DEFAULT_MAIL_PREFERENCES,
    mailPreferencesDraft: DEFAULT_MAIL_PREFERENCES,
    mailboxInfo: null,
    mailboxes: [],
    selectedByMode: { messages: '', conversations: '' },
    selectedId: '',
    selectedMailboxId: scope,
    ...(options.initialState || {}),
  };

  return renderHook(() => {
    const [folderSummary, setFolderSummary] = useState(initialState.folderSummary);
    const [folderTree, setFolderTree] = useState(initialState.folderTree);
    const [listData, setListData] = useState(initialState.listData);
    const [loading, setLoading] = useState(initialState.loading);
    const [loadingMore, setLoadingMore] = useState(initialState.loadingMore);
    const [mailBackgroundRefreshing, setMailBackgroundRefreshing] = useState(initialState.mailBackgroundRefreshing);
    const [mailConfigLoading, setMailConfigLoading] = useState(initialState.mailConfigLoading);
    const [mailPreferences, setMailPreferences] = useState(initialState.mailPreferences);
    const [mailPreferencesDraft, setMailPreferencesDraft] = useState(initialState.mailPreferencesDraft);
    const [mailboxInfo, setMailboxInfo] = useState(initialState.mailboxInfo);
    const [mailboxes, setMailboxes] = useState(initialState.mailboxes);
    const [selectedByMode, setSelectedByMode] = useState(initialState.selectedByMode);
    const [selectedId, setSelectedId] = useState(initialState.selectedId);
    const [selectedMailboxId, setSelectedMailboxId] = useState(initialState.selectedMailboxId);

    const currentListKeyRef = useRef(options.initialCurrentListKey || '');
    const folderSummaryRef = useRef(folderSummary);
    const folderSummaryRefreshCompletedAtRef = useRef(0);
    const folderTreeRef = useRef(folderTree);
    const listDataRef = useRef(listData);
    const mailboxesRef = useRef(mailboxes);
    const recentHydratedListContextsRef = useRef(new Set(options.recentHydratedListContexts || []));
    const selectedConversationRef = useRef(options.selectedConversation || null);
    const selectedIdRef = useRef(options.selectedIdRefValue || '');
    const selectedMessageRef = useRef(options.selectedMessage || null);
    const skipNextListRefreshRef = useRef(false);
    const suppressNextAutoReadRef = useRef('');

    folderSummaryRef.current = folderSummary;
    folderTreeRef.current = folderTree;
    listDataRef.current = listData;
    mailboxesRef.current = mailboxes;

    const controller = useMailListDataController({
      ...props,
      listData,
      loadingMore,
      refs: {
        currentListKeyRef,
        folderSummaryRef,
        folderSummaryRefreshCompletedAtRef,
        folderTreeRef,
        listDataRef,
        mailboxesRef,
        recentHydratedListContextsRef,
        selectedConversationRef,
        selectedIdRef,
        selectedMessageRef,
        skipNextListRefreshRef,
        suppressNextAutoReadRef,
      },
      setFolderSummary,
      setFolderTree,
      setListData,
      setLoading,
      setLoadingMore,
      setMailBackgroundRefreshing,
      setMailConfigLoading,
      setMailPreferences,
      setMailPreferencesDraft,
      setMailboxInfo,
      setMailboxes,
      setSelectedByMode,
      setSelectedId,
      setSelectedMailboxId,
    });

    return {
      controller,
      refs: {
        currentListKeyRef,
        folderSummaryRefreshCompletedAtRef,
        recentHydratedListContextsRef,
        selectedIdRef,
        skipNextListRefreshRef,
        suppressNextAutoReadRef,
      },
      state: {
        folderSummary,
        folderTree,
        listData,
        loading,
        loadingMore,
        mailBackgroundRefreshing,
        mailConfigLoading,
        mailPreferences,
        mailPreferencesDraft,
        mailboxInfo,
        mailboxes,
        selectedByMode,
        selectedId,
        selectedMailboxId,
      },
      props,
    };
  });
};

describe('useMailListDataController', () => {
  beforeEach(() => {
    clearSWRCache();
    vi.clearAllMocks();
  });

  it('applies cached bootstrap list, folder summary, and folder tree', async () => {
    const scope = 'mailbox-1';
    const requestContext = buildMailListRequestContext({ scope, folder: 'inbox', viewMode: 'messages', limit: 50, offset: 0 });
    const bootstrapPayload = {
      selected_mailbox: { id: scope, mailbox_email: 'mailbox@example.com' },
      mailboxes: [{ id: scope, label: 'Mailbox' }],
      preferences: { compact: true },
      folder_summary: { inbox: { unread: 2 } },
      folder_tree: { items: [{ id: 'inbox', label: 'Inbox' }] },
      messages: {
        items: [createMessage('msg-1')],
        total: 1,
        limit: 50,
      },
    };
    setSWRCache(buildMailBootstrapCacheKey({ scope, limit: 20 }), bootstrapPayload);
    const { result } = renderController({ scope });

    await act(async () => {
      await result.current.controller.refreshBootstrap();
    });

    expect(result.current.state.mailboxInfo).toEqual(bootstrapPayload.selected_mailbox);
    expect(result.current.state.folderSummary).toEqual({ inbox: { unread: 2 } });
    expect(result.current.state.folderTree).toEqual([{ id: 'inbox', label: 'Inbox' }]);
    expect(result.current.state.listData.items).toEqual([createMessage('msg-1')]);
    expect(result.current.refs.skipNextListRefreshRef.current).toBe(true);
    expect(result.current.props.persistRecentBootstrapSnapshot).toHaveBeenCalledWith(
      { inbox: { unread: 2 } },
      [{ id: 'inbox', label: 'Inbox' }],
      scope
    );
    expect(result.current.props.persistRecentListSnapshot).toHaveBeenCalledWith(
      requestContext.contextKey,
      expect.objectContaining({ items: [createMessage('msg-1')] }),
      scope
    );
    expect(result.current.props.mailAPI.getBootstrap).not.toHaveBeenCalled();
  });

  it('does not replace an explicit active mailbox with a different bootstrap-selected mailbox', async () => {
    const mailAPI = createMailAPI({
      getBootstrap: vi.fn(async () => ({
        selected_mailbox: { id: 'primary', mailbox_email: 'primary@example.com' },
        mailboxes: [
          { id: 'primary', label: 'Primary' },
          { id: 'shared', label: 'Shared' },
        ],
        messages: createEmptyListData(),
      })),
    });
    const { result } = renderController({
      scope: 'shared',
      mailAPI,
      initialState: {
        selectedMailboxId: 'shared',
      },
    });

    await act(async () => {
      await result.current.controller.refreshBootstrap({ force: true });
    });

    expect(result.current.state.selectedMailboxId).toBe('shared');
  });

  it('preserves visible items during a silent transient list refresh failure', async () => {
    const visibleList = {
      items: [createMessage('msg-visible')],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
      next_offset: null,
      append_offset: null,
      loaded_pages: 1,
    };
    const requestError = new Error('network');
    const mailAPI = createMailAPI({
      getMessages: vi.fn(async () => {
        throw requestError;
      }),
    });
    const { result } = renderController({
      mailAPI,
      initialState: { listData: visibleList },
      props: {
        isTransientMailRequestError: vi.fn(() => true),
      },
    });

    let refreshResult;
    await act(async () => {
      refreshResult = await result.current.controller.refreshList({ silent: true, force: true });
    });

    expect(refreshResult.items).toEqual([createMessage('msg-visible')]);
    expect(result.current.state.listData.items).toEqual([createMessage('msg-visible')]);
    expect(result.current.props.setError).not.toHaveBeenCalled();
  });

  it('loads more messages with append offset and appends the response', async () => {
    const initialList = {
      items: [createMessage('msg-1')],
      total: 2,
      offset: 0,
      limit: 50,
      has_more: true,
      next_offset: 50,
      append_offset: 50,
      loaded_pages: 1,
    };
    const mailAPI = createMailAPI({
      getMessages: vi.fn(async () => ({
        items: [createMessage('msg-2')],
        total: 2,
        offset: 50,
        limit: 50,
        has_more: false,
        next_offset: null,
        append_offset: null,
        loaded_pages: 1,
      })),
    });
    const { result } = renderController({
      mailAPI,
      initialState: { listData: initialList },
    });

    await act(async () => {
      await result.current.controller.loadMoreMessages();
    });

    expect(mailAPI.getMessages).toHaveBeenCalledWith(expect.objectContaining({
      folder: 'inbox',
      limit: 50,
      mailbox_id: 'mailbox-1',
      offset: 50,
    }));
    expect(result.current.state.listData.items).toEqual([
      createMessage('msg-1'),
      createMessage('msg-2'),
    ]);
    expect(result.current.state.loadingMore).toBe(false);
  });

  it('clears visible items but preserves list metadata when credentials are required', async () => {
    const initialList = {
      items: [createMessage('msg-1')],
      total: 42,
      offset: 0,
      limit: 50,
      has_more: true,
      next_offset: 50,
      append_offset: 50,
      loaded_pages: 1,
    };
    const requestError = new Error('credentials');
    const mailAPI = createMailAPI({
      getMessages: vi.fn(async () => {
        throw requestError;
      }),
    });
    const handleMailCredentialsRequired = vi.fn(async () => true);
    const contextKey = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'inbox',
      viewMode: 'messages',
      limit: 50,
      offset: 0,
    }).contextKey;
    const { result } = renderController({
      mailAPI,
      initialCurrentListKey: contextKey,
      initialState: { listData: initialList },
      props: { handleMailCredentialsRequired },
    });

    await act(async () => {
      await result.current.controller.refreshList({ force: true });
    });

    expect(handleMailCredentialsRequired).toHaveBeenCalledWith(requestError);
    expect(result.current.state.listData).toEqual({
      ...initialList,
      items: [],
    });
  });
});
