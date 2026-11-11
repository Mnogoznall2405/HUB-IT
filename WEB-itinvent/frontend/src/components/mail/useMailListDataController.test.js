import { useRef, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
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
    const [cacheScope, setCacheScope] = useState(scope);

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
      mailCacheScope: cacheScope,
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
      setCacheScope,
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

  it('keeps a recently hydrated list while bootstrap refreshes mailbox metadata', async () => {
    const requestContext = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'inbox',
      viewMode: 'messages',
      advancedFilters: { folder_scope: 'current' },
      limit: 50,
      offset: 0,
    });
    const hydratedList = {
      items: [createMessage('cached-msg')],
      total: 324,
      offset: 0,
      limit: 50,
      has_more: true,
      next_offset: 50,
      append_offset: 50,
      loaded_pages: 1,
    };
    const mailAPI = createMailAPI({
      getBootstrap: vi.fn(async () => ({
        selected_mailbox: { id: 'mailbox-1', mailbox_email: 'mailbox@example.com' },
        mailboxes: [{ id: 'mailbox-1', label: 'Mailbox' }],
        folder_summary: { inbox: { total: 324, unread: 1 } },
        folder_tree: { items: [{ id: 'inbox', label: 'Inbox' }] },
        messages: {
          items: [createMessage('older-bootstrap-msg')],
          total: 324,
          offset: 0,
          limit: 20,
          has_more: true,
          next_offset: 20,
        },
      })),
    });
    const { result } = renderController({
      mailAPI,
      initialCurrentListKey: requestContext.contextKey,
      initialState: { listData: hydratedList },
      recentHydratedListContexts: [requestContext.contextKey],
    });

    await act(async () => {
      await result.current.controller.refreshBootstrap({ force: true });
    });

    expect(result.current.state.listData).toEqual(hydratedList);
    expect(result.current.refs.skipNextListRefreshRef.current).toBe(false);
    expect(result.current.state.folderSummary).toEqual({ inbox: { total: 324, unread: 1 } });
  });

  it('does not treat a stale bootstrap list as a fresh list', async () => {
    const mailAPI = createMailAPI({
      getBootstrap: vi.fn(async () => ({
        state: 'stale',
        source: 'app_snapshot',
        selected_mailbox: { id: 'mailbox-1', mailbox_email: 'mailbox@example.com' },
        mailboxes: [{ id: 'mailbox-1', label: 'Mailbox' }],
        folder_summary: { inbox: { total: 324, unread: 1 } },
        folder_tree: { items: [{ id: 'inbox', label: 'Inbox' }] },
        messages: {
          items: [createMessage('stale-bootstrap-msg')],
          total: 324,
          limit: 20,
          has_more: true,
          next_offset: 20,
        },
      })),
      getMessages: vi.fn(async () => ({
        items: [createMessage('fresh-after-stale'), createMessage('stale-bootstrap-msg')],
        total: 324,
        limit: 50,
        has_more: true,
        next_offset: 50,
      })),
    });
    const { result } = renderController({
      mailAPI,
      initialState: { mailAccessReady: true },
    });

    await act(async () => {
      await result.current.controller.refreshBootstrap({ force: true });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Stale snapshot paints first, then a live head refresh merges fresher mail.
    expect(mailAPI.getMessages).toHaveBeenCalled();
    expect(result.current.state.listData.items.map((item) => item.id)).toEqual([
      'fresh-after-stale',
      'stale-bootstrap-msg',
    ]);
    expect(result.current.refs.skipNextListRefreshRef.current).toBe(true);
    // Live refresh may persist the fresh list; the stale bootstrap payload itself must not.
    expect(result.current.props.persistRecentListSnapshot).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ items: [createMessage('stale-bootstrap-msg')] }),
      expect.anything(),
    );
  });

  it('paints app_snapshot bootstrap then silently refreshes the live head', async () => {
    const mailAPI = createMailAPI({
      getBootstrap: vi.fn(async () => ({
        state: 'ok',
        source: 'app_snapshot',
        selected_mailbox: { id: 'mailbox-1', mailbox_email: 'mailbox@example.com' },
        mailboxes: [{ id: 'mailbox-1', label: 'Mailbox' }],
        folder_summary: { inbox: { unread: 1 } },
        folder_tree: { items: [{ id: 'inbox', label: 'Inbox' }] },
        messages: {
          items: [createMessage('snapshot-msg')],
          total: 1,
          limit: 20,
        },
      })),
      getMessages: vi.fn(async () => ({
        items: [createMessage('fresh-msg'), createMessage('snapshot-msg')],
        total: 2,
        limit: 50,
      })),
    });
    const { result } = renderController({
      mailAPI,
      initialState: { mailAccessReady: true },
    });

    await act(async () => {
      await result.current.controller.refreshBootstrap({ force: true });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.state.listData.items.map((item) => item.id)).toEqual([
      'fresh-msg',
      'snapshot-msg',
    ]);
    expect(mailAPI.getMessages).toHaveBeenCalled();
    expect(result.current.refs.skipNextListRefreshRef.current).toBe(true);
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

  it('preserves folder metadata during a transient background refresh failure', async () => {
    const requestError = { response: { status: 503 } };
    const mailAPI = createMailAPI({
      getFolderSummary: vi.fn(async () => { throw requestError; }),
      getFolderTree: vi.fn(async () => { throw requestError; }),
    });
    const initialFolderSummary = { inbox: { unread: 7 } };
    const initialFolderTree = [{ id: 'inbox', label: 'Входящие' }];
    const { result } = renderController({
      mailAPI,
      initialState: {
        folderSummary: initialFolderSummary,
        folderTree: initialFolderTree,
      },
      props: {
        isTransientMailRequestError: vi.fn(() => true),
      },
    });

    await act(async () => {
      await result.current.controller.refreshFolderSummary({ force: true });
      await result.current.controller.refreshFolderTree({ force: true });
    });

    expect(result.current.state.folderSummary).toEqual(initialFolderSummary);
    expect(result.current.state.folderTree).toEqual(initialFolderTree);
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
    }), expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(result.current.state.listData.items).toEqual([
      createMessage('msg-1'),
      createMessage('msg-2'),
    ]);
    expect(result.current.state.loadingMore).toBe(false);
  });

  it('replaces a hydrated expanded list before continuing pagination', async () => {
    const requestContext = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'inbox',
      viewMode: 'messages',
      advancedFilters: { folder_scope: 'current' },
      limit: 50,
      offset: 0,
    });
    const hydratedList = {
      items: [createMessage('msg-1'), createMessage('stale-msg-251')],
      total: 500,
      offset: 0,
      limit: 50,
      has_more: true,
      next_offset: 300,
      append_offset: 300,
      loaded_pages: 6,
    };
    const freshHead = {
      items: [createMessage('msg-1'), createMessage('msg-2')],
      total: 500,
      offset: 0,
      limit: 50,
      has_more: true,
      next_offset: 50,
      append_offset: 50,
      loaded_pages: 1,
    };
    const mailAPI = createMailAPI({
      getMessages: vi.fn(async () => freshHead),
    });
    const { result } = renderController({
      mailAPI,
      initialCurrentListKey: requestContext.contextKey,
      initialState: { listData: hydratedList },
      recentHydratedListContexts: [requestContext.contextKey],
    });

    await act(async () => {
      await result.current.controller.refreshList({ force: true });
    });

    expect(result.current.state.listData.items).toEqual(freshHead.items);
    expect(result.current.state.listData.append_offset).toBe(50);
    expect(result.current.refs.recentHydratedListContextsRef.current.has(requestContext.contextKey)).toBe(false);
  });

  it('opens credentials flow when bootstrap fails with auth error even with recent hydration', async () => {
    const requestError = Object.assign(new Error('auth'), {
      response: {
        status: 409,
        headers: { 'x-mail-error-code': 'MAIL_AUTH_INVALID' },
        data: { detail: 'Пароль корпоративной почты устарел или неверен. Введите новый пароль.' },
      },
    });
    const mailAPI = createMailAPI({
      getBootstrap: vi.fn(async () => {
        throw requestError;
      }),
    });
    const handleMailCredentialsRequired = vi.fn(async () => true);
    const hydratedList = {
      items: [createMessage('cached-msg')],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
      next_offset: null,
      append_offset: 1,
      loaded_pages: 1,
    };
    const { result } = renderController({
      mailAPI,
      initialState: {
        listData: hydratedList,
        mailboxInfo: { id: 'mailbox-1', mailbox_email: 'mailbox@example.com' },
      },
      props: {
        handleMailCredentialsRequired,
        recentHydratedScope: 'mailbox-1',
      },
    });

    await act(async () => {
      await result.current.controller.refreshBootstrap({ force: true });
    });

    expect(handleMailCredentialsRequired).toHaveBeenCalledWith(
      requestError,
      'Не удалось загрузить почтовый экран.'
    );
    expect(result.current.state.listData.items).toEqual([]);
    expect(result.current.state.mailboxInfo).toEqual({
      id: 'mailbox-1',
      mailbox_email: 'mailbox@example.com',
    });
    expect(result.current.props.setError).not.toHaveBeenCalledWith(
      'Не удалось загрузить почтовый экран.'
    );
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

  it('does not paint a late inbox bootstrap list over Sent after a folder switch', async () => {
    const sentContext = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'sent',
      viewMode: 'messages',
      advancedFilters: { folder_scope: 'current' },
      limit: 50,
      offset: 0,
    });
    const sentList = {
      items: [createMessage('sent-1')],
      total: 1,
      offset: 0,
      limit: 50,
      has_more: false,
      next_offset: null,
      append_offset: null,
      loaded_pages: 1,
    };
    const { result } = renderController({
      folder: 'sent',
      initialCurrentListKey: sentContext.contextKey,
      initialState: { listData: sentList },
      props: {
        currentContextUsesBootstrapList: false,
        currentListCacheKey: sentContext.cacheKey,
        currentListContextKey: sentContext.contextKey,
        currentListParams: sentContext.params,
      },
    });

    await act(async () => {
      // Stale bootstrap completion still requests applyList=true (captured before folder switch).
      result.current.controller.applyBootstrapPayload({
        selected_mailbox: { id: 'mailbox-1', mailbox_email: 'mailbox@example.com' },
        mailboxes: [{ id: 'mailbox-1', label: 'Mailbox' }],
        folder_summary: { inbox: { unread: 3 }, sent: { unread: 0 } },
        folder_tree: { items: [{ id: 'inbox', label: 'Inbox' }, { id: 'sent', label: 'Sent' }] },
        messages: {
          items: [createMessage('inbox-late')],
          total: 1,
          limit: 20,
        },
      }, { applyList: true });
    });

    expect(result.current.state.listData.items).toEqual([createMessage('sent-1')]);
    expect(result.current.state.folderSummary).toEqual({ inbox: { unread: 3 }, sent: { unread: 0 } });
    expect(result.current.refs.skipNextListRefreshRef.current).toBe(false);
  });

  it('ignores a late bootstrap await after the user left the inbox context', async () => {
    let resolveBootstrap;
    const mailAPI = createMailAPI({
      getBootstrap: vi.fn(() => new Promise((resolve) => {
        resolveBootstrap = resolve;
      })),
    });
    const inboxContext = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'inbox',
      viewMode: 'messages',
      advancedFilters: { folder_scope: 'current' },
      limit: 50,
      offset: 0,
    });
    const sentContext = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'sent',
      viewMode: 'messages',
      advancedFilters: { folder_scope: 'current' },
      limit: 50,
      offset: 0,
    });
    const { result } = renderController({
      mailAPI,
      initialCurrentListKey: inboxContext.contextKey,
      props: {
        currentContextUsesBootstrapList: true,
      },
    });

    let bootstrapPromise;
    await act(async () => {
      bootstrapPromise = result.current.controller.refreshBootstrap({ force: true });
    });

    // User switched to Sent while bootstrap is still awaiting Exchange.
    result.current.refs.currentListKeyRef.current = sentContext.contextKey;
    await act(async () => {
      result.current.controller.applyResolvedListData({
        items: [createMessage('sent-1')],
        total: 1,
        limit: 50,
      }, {
        reset: true,
        listCacheKey: sentContext.cacheKey,
        listContextKey: sentContext.contextKey,
      });
    });

    await act(async () => {
      resolveBootstrap({
        selected_mailbox: { id: 'mailbox-1', mailbox_email: 'mailbox@example.com' },
        mailboxes: [{ id: 'mailbox-1', label: 'Mailbox' }],
        folder_summary: { inbox: { unread: 1 } },
        folder_tree: { items: [{ id: 'inbox', label: 'Inbox' }] },
        messages: {
          items: [createMessage('inbox-late')],
          total: 1,
          limit: 20,
        },
      });
      await bootstrapPromise;
    });

    expect(result.current.state.listData.items.map((item) => item.id)).toEqual(['sent-1']);
  });

  it('aborts an in-flight list request after the list context changes', async () => {
    let firstSignal;
    let listCalls = 0;
    const mailAPI = createMailAPI({
      getMessages: vi.fn((_params, options) => {
        listCalls += 1;
        if (listCalls === 1) {
          return new Promise((_resolve, reject) => {
            firstSignal = options?.signal;
            const fail = () => reject(Object.assign(new Error('canceled'), {
              code: 'ERR_CANCELED',
              name: 'CanceledError',
            }));
            if (firstSignal?.aborted) {
              fail();
              return;
            }
            firstSignal?.addEventListener?.('abort', fail);
          });
        }
        return Promise.resolve({
          items: [createMessage('sent-1')],
          total: 1,
          limit: 50,
        });
      }),
    });
    const { result } = renderController({ mailAPI });
    const sentContext = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'sent',
      viewMode: 'messages',
      advancedFilters: { folder_scope: 'current' },
      limit: 50,
      offset: 0,
    });

    let firstRefresh;
    await act(async () => {
      firstRefresh = result.current.controller.refreshList({ force: true });
    });
    await waitFor(() => {
      expect(listCalls).toBe(1);
    });

    await act(async () => {
      await result.current.controller.refreshList({
        force: true,
        listParams: sentContext.params,
        listCacheKey: sentContext.cacheKey,
        listContextKey: sentContext.contextKey,
      });
    });
    await act(async () => {
      await firstRefresh;
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(result.current.props.setError).not.toHaveBeenCalled();
    expect(result.current.state.listData.items.map((item) => item.id)).toEqual(['sent-1']);
  });

  it('fetches conversations when refreshList overrides viewMode while the hook is still on messages', async () => {
    const mailAPI = createMailAPI({
      getConversations: vi.fn(async () => ({
        items: [{ conversation_id: 'conv-1', subject: 'Thread' }],
        total: 1,
        offset: 0,
        limit: 50,
        has_more: false,
      })),
    });
    const { result } = renderController({ mailAPI, viewMode: 'messages' });
    const conversationsContext = buildMailListRequestContext({
      scope: 'mailbox-1',
      folder: 'inbox',
      viewMode: 'conversations',
      advancedFilters: { folder_scope: 'current' },
      limit: 50,
      offset: 0,
    });

    await act(async () => {
      await result.current.controller.refreshList({
        force: true,
        listParams: conversationsContext.params,
        listCacheKey: conversationsContext.cacheKey,
        listContextKey: conversationsContext.contextKey,
        viewMode: 'conversations',
      });
    });

    expect(mailAPI.getConversations).toHaveBeenCalledTimes(1);
    expect(mailAPI.getMessages).not.toHaveBeenCalled();
    expect(result.current.state.listData.items[0]?.conversation_id).toBe('conv-1');
  });

  it('aborts in-flight bootstrap after the mailbox scope changes', async () => {
    let firstSignal;
    let bootstrapCalls = 0;
    const mailAPI = createMailAPI({
      getBootstrap: vi.fn((_params, options) => {
        bootstrapCalls += 1;
        if (bootstrapCalls === 1) {
          return new Promise((_resolve, reject) => {
            firstSignal = options?.signal;
            const fail = () => reject(Object.assign(new Error('canceled'), {
              code: 'ERR_CANCELED',
              name: 'CanceledError',
            }));
            if (firstSignal?.aborted) {
              fail();
              return;
            }
            firstSignal?.addEventListener?.('abort', fail);
          });
        }
        return Promise.resolve({
          selected_mailbox: { id: 'mailbox-2', mailbox_email: 'second@example.com' },
          mailboxes: [{ id: 'mailbox-2', label: 'Second' }],
          folder_summary: {},
          folder_tree: { items: [] },
          messages: createEmptyListData(),
        });
      }),
    });
    const { result } = renderController({ mailAPI });

    let firstRefresh;
    await act(async () => {
      firstRefresh = result.current.controller.refreshBootstrap({ force: true });
    });
    await waitFor(() => {
      expect(bootstrapCalls).toBe(1);
    });

    await act(async () => {
      result.current.setCacheScope('mailbox-2');
    });
    await act(async () => {
      await result.current.controller.refreshBootstrap({ force: true });
    });
    await act(async () => {
      await firstRefresh;
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(result.current.props.setError).not.toHaveBeenCalled();
  });
});
