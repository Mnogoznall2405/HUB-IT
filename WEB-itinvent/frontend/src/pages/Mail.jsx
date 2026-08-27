import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Suspense, lazy } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import { useLocation, useNavigate } from 'react-router-dom';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { mailAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import useDebounce from '../hooks/useDebounce';
import {
  getOrFetchSWR,
  peekSWRCache,
} from '../lib/swrCache';
import {
  getMailRecentHydration,
} from '../lib/mailRecentCache';
import MailBulkActionBar from '../components/mail/MailBulkActionBar';
import MailConversationReader from '../components/mail/MailConversationReader';
import MailFolderRail from '../components/mail/MailFolderRail';
import MailDedicatedComposeLoadingState from '../components/mail/MailDedicatedComposeLoadingState';
import MailInitialLoadingState from '../components/mail/MailInitialLoadingState';
import MailMessageList from '../components/mail/MailMessageList';
import MailPaneResizeHandle from '../components/mail/MailPaneResizeHandle';
import MailMessageReader from '../components/mail/MailMessageReader';
import MailMobilePreviewChrome from '../components/mail/MailMobilePreviewChrome';
import MailPreviewHeader from '../components/mail/MailPreviewHeader';
import MailPreviewMobileFooter from '../components/mail/MailPreviewMobileFooter';
import MailPreviewMobileReplySection from '../components/mail/MailPreviewMobileReplySection';
import MailShortcutHelpDialog from '../components/mail/MailShortcutHelpDialog';
import MailToolbar from '../components/mail/MailToolbar';
import MailQuotaReport from '../components/mail/MailQuotaReport';
import MailToolsMenu from '../components/mail/MailToolsMenu';
import MailViewSettingsDialog from '../components/mail/MailViewSettingsDialog';
import MailComposeHost from '../components/mail/MailComposeHost';
import MailCredentialsDialog from '../components/mail/MailCredentialsDialog';
import MailCredentialsGate from '../components/mail/MailCredentialsGate';
import MailItRequestDialog from '../components/mail/MailItRequestDialog';
import useMailMobileShell from '../components/mail/useMailMobileShell';
import useMailAdvancedSearch, { DEFAULT_ADVANCED_FILTERS } from '../components/mail/useMailAdvancedSearch';
import {
  getMailNoResultsHint,
  hasActiveMailListFilters,
  isMailAdvancedFiltersActive,
} from '../components/mail/mailListFilterActivity';
import useMailBulkActions from '../components/mail/useMailBulkActions';
import useMailFolderMutations from '../components/mail/useMailFolderMutations';
import useMailItRequest from '../components/mail/useMailItRequest';
import useMailAsyncTaskGate from '../components/mail/useMailAsyncTaskGate';
import useMailKeyboardShortcuts from '../components/mail/useMailKeyboardShortcuts';
import useMailNotifications from '../components/mail/useMailNotifications';
import useMailViewRefreshController from '../components/mail/useMailViewRefreshController';
import useMailViewPreferencesController, {
  DEFAULT_MAIL_PREFERENCES,
} from '../components/mail/useMailViewPreferencesController';
import useMailComposeSessionController from '../components/mail/useMailComposeSessionController';
import useMailCredentialsController from '../components/mail/useMailCredentialsController';
import useMailAutoReadGuard from '../components/mail/useMailAutoReadGuard';
import useMailListDataController from '../components/mail/useMailListDataController';
import useMailListItemActions from '../components/mail/useMailListItemActions';
import useMailMailboxUnreadCounts from '../components/mail/useMailMailboxUnreadCounts';
import useMailMessageFileActions from '../components/mail/useMailMessageFileActions';
import useMailMessageRenderState from '../components/mail/useMailMessageRenderState';
import useMailQuickReply from '../components/mail/useMailQuickReply';
import useMailMessageAi from '../components/mail/useMailMessageAi';
import useMailAiConsentController from '../components/mail/useMailAiConsentController';
import MailAiConsentDialog from '../components/mail/MailAiConsentDialog';
import { createMailTrashUndoNotifier } from '../components/mail/mailTrashUndo';
import { createMailMoveUndoNotifier } from '../components/mail/mailMoveUndo';
import { formatMailFolderCountCaption } from '../components/mail/mailPlural';
import {
  DESKTOP_CAPABILITIES_CHANGED_EVENT,
  DESKTOP_MAIL_COMPOSE_COMPLETED_EVENT,
  isDesktopCapabilityAvailable,
  requestDesktopMailComposeWindow,
  subscribeDesktopMailComposeCloseRequested,
  completeDesktopMailComposeClose,
  notifyDesktopMailComposeSent,
} from '../lib/desktopBridge';
import {
  getMailQuickReplyPlaceholder,
  getMailSelectedReplyMode,
} from '../components/mail/mailReplyIntent';
import useMailReadMutations from '../components/mail/useMailReadMutations';
import useMailRecentSnapshots from '../components/mail/useMailRecentSnapshots';
import useMailRemoteImages from '../components/mail/useMailRemoteImages';
import useMailSelectedDetailLifecycle from '../components/mail/useMailSelectedDetailLifecycle';
import useMailSelectedDetailState from '../components/mail/useMailSelectedDetailState';
import useMailSelectedPreviewActions from '../components/mail/useMailSelectedPreviewActions';
import useMailSignatureSettings from '../components/mail/useMailSignatureSettings';
import useMailTemplateEditor from '../components/mail/useMailTemplateEditor';
import {
  buildMailFolderSummaryCacheKey,
  buildMailFolderTreeCacheKey,
  buildMailListCacheKey,
  buildMailListRequestContext,
  createEmptyListData,
  normalizeMailListResponse,
} from '../components/mail/mailListModel';
import {
  formatFileSize,
  formatFullDate,
  formatMailSyncedAt,
  formatTime,
  getAvatarColor,
  getInitials,
  getMailRenderedContentSx,
  getSenderDisplay,
  sumAttachmentSize,
  sumFilesSize,
} from '../components/mail/mailMessagePresentation';
import { resolveMailFolderTreeView } from '../components/mail/mailFolderTreeModel';
import { serializeMailMoveTargets } from '../components/mail/mailMoveTargets';
import {
  buildMailRoute,
  normalizeMailFolder,
  readStoredMailListViewState,
  readStoredMailViewState,
} from '../components/mail/mailViewStateModel';
import {
  buildComposeFromOptions,
  collectMailboxEmails,
  getMailboxEntryId,
  getMailMailboxPrimaryDomain,
  mergeMailboxEntries,
  normalizeMailboxId,
  writeStoredSelectedMailboxId,
} from '../components/mail/mailMailboxModel';
import { resolveMailAccessState } from '../components/mail/mailAccessState';
import { createMailListRefreshAfterUndo } from '../components/mail/mailListUndoRefresh';
import {
  buildMailUiTokens,
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
  getMailUiFontScopeSx,
} from '../components/mail/mailUiTokens';
import { isMailOutgoingMessage, isOwnConversationMessage as isOwnConversationMessageItem } from '../components/mail/mailCorrespondent';
import {
  MAIL_PANE_DEFAULTS,
  MAIL_PANE_LIMITS,
  getMailPaneCssValue,
  getMailPaneSizes,
} from '../components/mail/mailPaneLayout';
import useMailShellSectionController from '../components/mail/useMailShellSectionController';
import useMailListQuickFilters from '../components/mail/useMailListQuickFilters';
import { buildMailFolderRailUtilityItems } from '../components/mail/mailFolderRailUtilityItems';
import useMailCopySummary from '../components/mail/useMailCopySummary';
import useMailMarkAllRead from '../components/mail/useMailMarkAllRead';
import useMailViewRefreshAction from '../components/mail/useMailViewRefreshAction';
import useMailAdvancedSearchOpen from '../components/mail/useMailAdvancedSearchOpen';
import useMailQuickReplySend from '../components/mail/useMailQuickReplySend';
import useMailComposeSentAction from '../components/mail/useMailComposeSentAction';
import useMailFolderRailFolderActions from '../components/mail/useMailFolderRailFolderActions';
import useMailPaneResize from '../components/mail/useMailPaneResize';
import useMailListScrollState from '../components/mail/useMailListScrollState';
import useMailAdjacentMessageSelection from '../components/mail/useMailAdjacentMessageSelection';
import useMailQuickReplyStatusToasts from '../components/mail/useMailQuickReplyStatusToasts';
import useMailAiErrorHandler from '../components/mail/useMailAiErrorHandler';
import useMailClientCacheInvalidation from '../components/mail/useMailClientCacheInvalidation';
import useMailReadStateOverrideResolvers from '../components/mail/useMailReadStateOverrideResolvers';
import useMailFreshSelectedDetail from '../components/mail/useMailFreshSelectedDetail';
import useMailMailboxConfigRefresh from '../components/mail/useMailMailboxConfigRefresh';
import useMailSilentViewRevalidate from '../components/mail/useMailSilentViewRevalidate';
import useMailMobileHistorySelection from '../components/mail/useMailMobileHistorySelection';
import useMailPendingListScrollRestore from '../components/mail/useMailPendingListScrollRestore';
import useMailPageInitialState from '../components/mail/mailPageInitialState';
import useMailActiveMailboxBindings from '../components/mail/useMailActiveMailboxBindings';
import useMailLastSyncedAt from '../components/mail/useMailLastSyncedAt';
import useMailViewStatePersistence from '../components/mail/useMailViewStatePersistence';
import useMailRecentListHydration from '../components/mail/useMailRecentListHydration';
import useMailDeepLinkSelection from '../components/mail/useMailDeepLinkSelection';
import useMailListAccessRefresh from '../components/mail/useMailListAccessRefresh';
import useMailFolderLabel from '../components/mail/useMailFolderLabel';
import useMailListLoadMoreObserver from '../components/mail/useMailListLoadMoreObserver';
import useMailConversationThreadScroll from '../components/mail/useMailConversationThreadScroll';
import useMailErrorHelpers from '../components/mail/useMailErrorHelpers';
import useMailSelectedMailboxPersistence from '../components/mail/useMailSelectedMailboxPersistence';
import useMailCredentialsDialogGate from '../components/mail/useMailCredentialsDialogGate';
import useMailCredentialsGateFolderClear from '../components/mail/useMailCredentialsGateFolderClear';
import useMailMissingFolderFallback from '../components/mail/useMailMissingFolderFallback';
import useMailSelectedByModeSync from '../components/mail/useMailSelectedByModeSync';
import useMailConversationSelectionGuard from '../components/mail/useMailConversationSelectionGuard';
import useMailComposeDraftSavedAction from '../components/mail/useMailComposeDraftSavedAction';
import useMailComposeCloseThen from '../components/mail/useMailComposeCloseThen';
import useMailListItemSelection from '../components/mail/useMailListItemSelection';
import useMailComposeGatedSelection from '../components/mail/useMailComposeGatedSelection';

const MailAttachmentPreviewDialog = lazy(() => import('../components/mail/MailAttachmentPreviewDialog'));
const MailAdvancedSearchDialog = lazy(() => import('../components/mail/MailAdvancedSearchDialog'));
const MailHeadersDialog = lazy(() => import('../components/mail/MailHeadersDialog'));
const MailSignatureDialog = lazy(() => import('../components/mail/MailSignatureDialog'));
const MailTemplatesDialog = lazy(() => import('../components/mail/MailTemplatesDialog'));

const MAIL_VIEW_REFRESH_COOLDOWN_MS = 4000;
const MAIL_SWR_STALE_TIME_MS = 45000;
const MAIL_DETAIL_SWR_STALE_TIME_MS = 10 * 60 * 1000;
const MAIL_FOLDER_SUMMARY_REFRESH_COOLDOWN_MS = 120000;
const MAIL_AUTO_READ_GUARD_TTL_MS = 120000;
const COMPOSE_DRAFT_STORAGE_KEY = 'mail_compose_draft_v2';
const MAIL_BOOTSTRAP_LIMIT = 20;

function Mail() {
  const theme = useTheme();
  const ui = useMemo(() => buildMailUiTokens(theme), [theme]);
  const mailRenderColorScheme = ui.isDark ? 'dark' : 'light';
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isNarrowMailDesktop = useMediaQuery(theme.breakpoints.down(1100));
  const isSplitMailDesktop = useMediaQuery(theme.breakpoints.down(900));
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, user } = useAuth();
  const { notifySuccess, notifyInfo, notifyWarning } = useNotification();
  const {
    notifyMailSuccess,
    notifyMailInfo,
    notifyMailComposeWarning,
  } = useMailNotifications({
    notifySuccess,
    notifyInfo,
    notifyWarning,
  });
  const {
    initialRouteMailboxId,
    initialSelectedMailboxId,
    initialMailViewState,
    initialMailCacheScope,
    initialMailRecentHydration,
  } = useMailPageInitialState({
    locationSearch: location.search,
    userId: user?.id,
    defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
  });
  const canManageUsers = hasPermission('settings.users.manage');
  const canQuotasRead = hasPermission('mail.quotas.read');
  const {
    handleMailShellSectionChange,
    showQuotasSection,
  } = useMailShellSectionController({ canQuotasRead });

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const [folder, setFolder] = useState(initialMailViewState.folder);
  const [viewMode, setViewMode] = useState(initialMailViewState.viewMode);
  const [search, setSearch] = useState(initialMailViewState.search);
  const debouncedSearch = useDebounce(search, 500);
  const [unreadOnly, setUnreadOnly] = useState(initialMailViewState.unreadOnly);
  const [hasAttachmentsOnly, setHasAttachmentsOnly] = useState(initialMailViewState.hasAttachmentsOnly);
  const [filterDateFrom, setFilterDateFrom] = useState(initialMailViewState.filterDateFrom);
  const [filterDateTo, setFilterDateTo] = useState(initialMailViewState.filterDateTo);

  const [mailboxInfo, setMailboxInfo] = useState(null);
  const [mailboxes, setMailboxes] = useState([]);
  const [selectedMailboxId, setSelectedMailboxId] = useState(initialSelectedMailboxId);
  const [mailConfigLoading, setMailConfigLoading] = useState(true);
  const [folderSummary, setFolderSummary] = useState(() => initialMailRecentHydration?.folderSummary || {});
  const [folderTree, setFolderTree] = useState(() => initialMailRecentHydration?.folderTree || []);
  const {
    mailPreferences,
    setMailPreferences,
    mailPreferencesDraft,
    setMailPreferencesDraft,
    mailPreferencesOpen,
    setMailPreferencesOpen,
    mailPreferencesSaving,
    openMailPreferencesDialog,
    closeMailPreferencesDialog,
    updateMailPreferencesDraft,
    handleSaveMailPreferences,
    persistMailPaneSize,
  } = useMailViewPreferencesController({
    mailAPI,
    onError: setError,
    onMessage: notifyMailSuccess,
  });
  const [listData, setListData] = useState(() => (
    initialMailRecentHydration?.listData
      ? normalizeMailListResponse(initialMailRecentHydration.listData)
      : createEmptyListData()
  ));
  const [recentHydratedScope, setRecentHydratedScope] = useState(initialMailRecentHydration ? initialMailCacheScope : '');
  const [mailBackgroundRefreshing, setMailBackgroundRefreshing] = useState(false);
  const [mailLastSyncedAt, setMailLastSyncedAt] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [moveTarget, setMoveTarget] = useState('');
  const queueListScrollRestoreRef = useRef(null);
  const refreshBootstrapRef = useRef(null);
  const queueListScrollRestoreProxy = useCallback((...args) => {
    queueListScrollRestoreRef.current?.(...args);
  }, []);

  const {
    detailLoading,
    setDetailLoading,
    selectedId,
    setSelectedId,
    selectedMessage,
    setSelectedMessage,
    selectedConversation,
    setSelectedConversation,
    selectedByMode,
    setSelectedByMode,
    detailRequestAbortRef,
    selectedIdRef,
    selectedMessageRef,
    selectedConversationRef,
    detailContextRef,
    suppressNextAutoReadRef,
    clearSelection,
    restoreMobileHistorySelection,
  } = useMailSelectedDetailState({
    viewMode,
    setSelectedItems,
    setMoveTarget,
    queueListScrollRestore: queueListScrollRestoreProxy,
  });

  const {
    advancedSearchOpen,
    setAdvancedSearchOpen,
    advancedFiltersDraft,
    setAdvancedFiltersDraft,
    advancedFiltersApplied,
    setAdvancedFiltersApplied,
    recentSearches,
    handleApplyAdvancedSearch,
    handleResetAdvancedSearch,
    handleApplyRecentSearch,
  } = useMailAdvancedSearch({
    initialFilters: initialMailViewState.advancedFiltersApplied,
    onSearchChange: setSearch,
  });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const [toolsAnchorEl, setToolsAnchorEl] = useState(null);

  const {
    revealedRemoteImagesByMessageId,
    revealRemoteImagesForMessage,
  } = useMailRemoteImages();

  const messageListRef = useRef(null);
  const desktopMailAreaRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const conversationScrollRef = useRef(null);
  const searchInputRef = useRef(null);
  const composeCloseRequestRef = useRef(null);
  const listDataRef = useRef(listData);
  const viewModeRef = useRef(viewMode);
  const folderSummaryRef = useRef(folderSummary);
  const folderLabelMapRef = useRef(null);
  const folderTreeRef = useRef(folderTree);
  const mailboxesRef = useRef(mailboxes);
  const deepLinkKeyRef = useRef('');
  const localReadStateOverridesRef = useRef(new Map());
  const skipNextListRefreshRef = useRef(false);
  const lastListRefreshContextKeyRef = useRef('');
  // Recent hydration should paint immediately, but the first live refresh for that context must still hit the network.
  const recentHydratedListContextsRef = useRef(new Set());
  const currentListKeyRef = useRef('');
  const listViewStateRef = useRef(readStoredMailListViewState());
  const pendingListScrollRestoreRef = useRef(null);
  const previousMailCacheScopeRef = useRef(initialMailCacheScope);
  const lastAppliedMailboxViewStateRef = useRef('');
  const folderSummaryRefreshCompletedAtRef = useRef(0);

  const activeMailboxId = useMemo(
    () => normalizeMailboxId(selectedMailboxId || mailboxInfo?.mailbox_id || initialRouteMailboxId),
    [initialRouteMailboxId, mailboxInfo?.mailbox_id, selectedMailboxId]
  );
  useMailSelectedMailboxPersistence({ activeMailboxId });
  const {
    begin: beginAutoReadGuard,
    settle: settleAutoReadGuard,
  } = useMailAutoReadGuard({ ttlMs: MAIL_AUTO_READ_GUARD_TTL_MS });
  const {
    run: runMailViewRefreshGate,
  } = useMailAsyncTaskGate({ cooldownMs: MAIL_VIEW_REFRESH_COOLDOWN_MS });
  const composeDraftKey = useMemo(
    () => `${COMPOSE_DRAFT_STORAGE_KEY}:${activeMailboxId || 'default'}`,
    [activeMailboxId]
  );
  const selectedMessageRenderState = useMailMessageRenderState(selectedMessage, {
    revealedRemoteImagesByMessageId,
    colorScheme: mailRenderColorScheme,
    formatFileSize,
    sumAttachmentSize,
    resetKey: `${selectedMessage?.id || ''}:${selectedConversation?.conversation_id || ''}`,
  });
  const { renderResult: selectedMessageRenderResult } = selectedMessageRenderState;
  const mailboxEmails = useMemo(
    () => collectMailboxEmails(mailboxInfo),
    [mailboxInfo?.effective_mailbox_login, mailboxInfo?.mailbox_email, mailboxInfo?.mailbox_login],
  );
  const {
    mailRequiresRelogin,
    mailRequiresPassword,
    mailAccessReady,
    mailboxUsesPrimaryCredentials,
    canSaveMailForAllDevices,
    showSaveMailForAllDevicesBanner,
  } = resolveMailAccessState(mailboxInfo);
  const composeFromOptions = useMemo(
    () => buildComposeFromOptions({ mailboxes, mailboxInfo }),
    [mailboxes, mailboxInfo],
  );
  const {
    refreshMailboxUnreadCounts,
    handleOpenMailboxList,
  } = useMailMailboxUnreadCounts({
    mailAPI,
    mailboxes,
    activeMailboxId,
    setMailboxes,
  });
  const {
    withActiveMailboxParams,
    withActiveMailboxPayload,
    resolveItemMailboxId,
    resolveComposeMailboxId,
  } = useMailActiveMailboxBindings({
    activeMailboxId,
    composeFromOptions,
  });
  const mailCacheScope = useMemo(
    () => activeMailboxId || initialMailCacheScope || 'mailbox:pending',
    [activeMailboxId, initialMailCacheScope]
  );
  const {
    persistBootstrapSnapshot: persistRecentBootstrapSnapshot,
    persistListSnapshot: persistRecentListSnapshot,
    persistMessageDetailSnapshot: persistRecentMessageDetailSnapshot,
    getMessageDetailSnapshot: getRecentMessageDetailSnapshot,
  } = useMailRecentSnapshots({
    scope: mailCacheScope,
    initialScope: initialMailCacheScope,
  });
  const currentListRequestContext = useMemo(() => buildMailListRequestContext({
    scope: mailCacheScope,
    folder,
    viewMode,
    search: debouncedSearch,
    unreadOnly,
    hasAttachmentsOnly,
    dateFrom: filterDateFrom,
    dateTo: filterDateTo,
    advancedFilters: advancedFiltersApplied,
    limit: 50,
    offset: 0,
  }), [
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    mailCacheScope,
    unreadOnly,
    viewMode,
    advancedFiltersApplied,
  ]);
  const currentContextUsesBootstrapList = currentListRequestContext.usesBootstrapList;
  const currentFolderScope = currentListRequestContext.folderScope;
  const currentListParams = currentListRequestContext.params;
  const currentListCacheKey = currentListRequestContext.cacheKey;
  const currentListContextKey = currentListRequestContext.contextKey;
  const currentFolderSummaryCacheKey = useMemo(
    () => buildMailFolderSummaryCacheKey({ scope: mailCacheScope }),
    [mailCacheScope]
  );
  const currentFolderTreeCacheKey = useMemo(
    () => buildMailFolderTreeCacheKey({ scope: mailCacheScope }),
    [mailCacheScope]
  );
  const hasMobileSelection = isMobile && Boolean(selectedId);
  const isMobileFullscreenPreview = hasMobileSelection;

  const {
    getMailErrorDetail,
    getMailErrorDetailAsync,
    isMissingMailDetailError,
    getMailErrorCode,
    isTransientMailRequestError,
  } = useMailErrorHelpers();

  useEffect(() => { listDataRef.current = listData; }, [listData]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { mailboxesRef.current = mailboxes; }, [mailboxes]);
  useEffect(() => { folderSummaryRef.current = folderSummary; }, [folderSummary]);
  useEffect(() => { folderTreeRef.current = folderTree; }, [folderTree]);
  useMailLastSyncedAt({
    mailBackgroundRefreshing,
    loading,
    listItems: listData?.items,
    mailLastSyncedAt,
    setMailLastSyncedAt,
  });
  useEffect(() => {
    const previousScope = String(previousMailCacheScopeRef.current || '').trim();
    if (previousScope && previousScope !== mailCacheScope) {
      // Prefer cached paint for the next mailbox; never flash a blank "Нет писем" while loading.
      const hydration = getMailRecentHydration({
        scope: mailCacheScope,
        contextKey: currentListContextKey,
      });
      if (hydration?.listData && Array.isArray(hydration.listData.items) && hydration.listData.items.length > 0) {
        setFolderSummary(hydration.folderSummary || {});
        setFolderTree(Array.isArray(hydration.folderTree) ? hydration.folderTree : []);
        setListData(normalizeMailListResponse(hydration.listData));
        setRecentHydratedScope(mailCacheScope);
        setLoading(false);
      } else {
        setRecentHydratedScope('');
        // Keep previous mailbox rows clickable; Exchange refresh is background-only.
        const hasPaintedItems = Array.isArray(listDataRef.current?.items) && listDataRef.current.items.length > 0;
        if (hasPaintedItems) {
          setLoading(false);
          setMailBackgroundRefreshing(true);
        } else {
          setLoading(true);
        }
      }
    }
    previousMailCacheScopeRef.current = mailCacheScope;
  }, [currentListContextKey, mailCacheScope]);
  useEffect(() => {
    if (!activeMailboxId) return;
    if (lastAppliedMailboxViewStateRef.current === activeMailboxId) return;
    const searchParams = new URLSearchParams(location.search || '');
    const rawRouteFolder = String(searchParams.get('folder') || '').trim();
    const routeFolder = rawRouteFolder ? normalizeMailFolder(rawRouteFolder) : '';
    const routeMessageId = String(searchParams.get('message') || '').trim();
    const storedState = readStoredMailViewState(activeMailboxId, { defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS });
    lastAppliedMailboxViewStateRef.current = activeMailboxId;
    setFolder(routeFolder || storedState.folder);
    setViewMode(routeMessageId ? 'messages' : storedState.viewMode);
    if (!routeFolder && !routeMessageId) {
      setSearch(storedState.search);
      setUnreadOnly(storedState.unreadOnly);
      setHasAttachmentsOnly(storedState.hasAttachmentsOnly);
      setFilterDateFrom(storedState.filterDateFrom);
      setFilterDateTo(storedState.filterDateTo);
      setAdvancedFiltersDraft(storedState.advancedFiltersApplied);
      setAdvancedFiltersApplied(storedState.advancedFiltersApplied);
    }
  }, [activeMailboxId, location.search]);
  useMailViewStatePersistence({
    activeMailboxId,
    folder,
    viewMode,
    search,
    unreadOnly,
    hasAttachmentsOnly,
    filterDateFrom,
    filterDateTo,
    advancedFiltersApplied,
    defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
  });
  const {
    saveCurrentListScrollPosition,
    queueListScrollRestore,
  } = useMailListScrollState({
    listViewStateRef,
    pendingListScrollRestoreRef,
    messageListRef,
    currentListKeyRef,
    currentListContextKey,
  });
  queueListScrollRestoreRef.current = queueListScrollRestore;
  const {
    resolveListDataReadStateOverrides,
    resolveMessageReadStateOverrides,
    resolveConversationReadStateOverrides,
  } = useMailReadStateOverrideResolvers({
    localReadStateOverridesRef,
    ttlMs: MAIL_AUTO_READ_GUARD_TTL_MS,
    viewMode,
  });
  const hasFreshSelectedMailDetail = useMailFreshSelectedDetail({
    mailAccessReady,
    selectedId,
    viewMode,
    folderScope: advancedFiltersApplied?.folder_scope,
    mailCacheScope,
    folder,
    staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS,
  });
  useMailRecentListHydration({
    mailCacheScope,
    currentListContextKey,
    currentListCacheKey,
    recentHydratedScope,
    currentListKeyRef,
    listDataRef,
    recentHydratedListContextsRef,
    setListData,
    setFolderSummary,
    setFolderTree,
    setRecentHydratedScope,
    setLoading,
    staleTimeMs: MAIL_SWR_STALE_TIME_MS,
  });
  useMailPendingListScrollRestore({
    isMobile,
    hasMobileSelection,
    currentListContextKey,
    pendingListScrollRestoreRef,
    messageListRef,
    listItemCount: listData?.items?.length,
    listTotal: listData?.total,
  });

  useMailDeepLinkSelection({
    locationSearch: location.search,
    activeMailboxId,
    folder,
    viewMode,
    lastAppliedMailboxViewStateRef,
    deepLinkKeyRef,
    selectedIdRef,
    setSelectedMailboxId,
    setFolder,
    setViewMode,
    setSelectedItems,
    setSelectedByMode,
    setSelectedId,
  });

  const restoreMobileHistorySelectionWithMode = useMailMobileHistorySelection({
    viewModeRef,
    setViewMode,
    restoreMobileHistorySelection,
  });

  const {
    closeMobileNavigationIfNeeded,
    handleBackToList,
    mobileNavigationOpen,
    mobilePreviewSwipeAnimationMs,
    mobilePreviewSwipeOffset,
    mobilePreviewSwipeTransition,
    previewEdgeTouchHandlers,
    setMobileNavigationOpen,
  } = useMailMobileShell({
    isMobile,
    selectedId,
    viewMode,
    isPreviewOpen: isMobileFullscreenPreview,
    onClearSelection: clearSelection,
    onRestoreSelection: restoreMobileHistorySelectionWithMode,
  });

  const handleManageMailboxes = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleSelectMailbox = useCallback((nextMailboxId) => {
    const normalizedMailboxId = normalizeMailboxId(nextMailboxId);
    if (!normalizedMailboxId || normalizedMailboxId === activeMailboxId) return;
    void refreshMailboxUnreadCounts({ mailboxIds: [normalizedMailboxId], force: true });
    const storedState = readStoredMailViewState(normalizedMailboxId, { defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS });
    lastAppliedMailboxViewStateRef.current = normalizedMailboxId;
    if (detailRequestAbortRef.current) {
      detailRequestAbortRef.current.abort();
      detailRequestAbortRef.current = null;
    }
    clearSelection({ allModes: true });
    setSelectedItems([]);
    setMoveTarget('');
    // Keep previous mailboxInfo until bootstrap applies the next one — nulling
    // drops mailAccessReady and lets overlapping refresh/bootstrap thrash the UI.
    setSelectedMailboxId(normalizedMailboxId);
    writeStoredSelectedMailboxId(normalizedMailboxId);
    setMailConfigLoading(true);
    setMailBackgroundRefreshing(true);
    const nextFolder = storedState.folder || 'inbox';
    const nextViewMode = storedState.viewMode || 'messages';
    const nextContextKey = buildMailListRequestContext({
      scope: normalizedMailboxId,
      folder: nextFolder,
      viewMode: nextViewMode,
      search: '',
      unreadOnly: false,
      hasAttachmentsOnly: false,
      dateFrom: '',
      dateTo: '',
      advancedFilters: DEFAULT_ADVANCED_FILTERS,
      limit: 50,
      offset: 0,
    }).contextKey;
    const hydration = getMailRecentHydration({
      scope: normalizedMailboxId,
      contextKey: nextContextKey,
    });
    if (hydration?.listData && Array.isArray(hydration.listData.items) && hydration.listData.items.length > 0) {
      setFolderSummary(hydration.folderSummary || {});
      setFolderTree(Array.isArray(hydration.folderTree) ? hydration.folderTree : []);
      setListData(normalizeMailListResponse(hydration.listData));
      setRecentHydratedScope(normalizedMailboxId);
      setLoading(false);
      setMailBackgroundRefreshing(true);
    } else {
      // Keep previous rows interactive; MailMessageList hides items when loading=true.
      setRecentHydratedScope('');
      const hasPaintedItems = Array.isArray(listDataRef.current?.items) && listDataRef.current.items.length > 0;
      if (hasPaintedItems) {
        setLoading(false);
        setMailBackgroundRefreshing(true);
      } else {
        setLoading(true);
      }
    }
    setFolder(nextFolder);
    setViewMode(nextViewMode);
    setSearch('');
    setUnreadOnly(false);
    setHasAttachmentsOnly(false);
    setFilterDateFrom('');
    setFilterDateTo('');
    setAdvancedFiltersDraft(DEFAULT_ADVANCED_FILTERS);
    setAdvancedFiltersApplied(DEFAULT_ADVANCED_FILTERS);
    navigate(buildMailRoute({
      folder: nextFolder,
      mailboxId: normalizedMailboxId,
    }), { replace: true });
  }, [activeMailboxId, clearSelection, navigate, refreshMailboxUnreadCounts]);

  const refreshConfig = useMailMailboxConfigRefresh({
    mailAPI,
    activeMailboxId,
    mergeMailboxEntries,
    getMailboxEntryId,
    getMailErrorDetail,
    setMailConfigLoading,
    setMailboxInfo,
    setMailboxes,
    setSelectedMailboxId,
    setError,
  });

  const invalidateMailClientCache = useMailClientCacheInvalidation({ mailCacheScope });

  const {
    mailCredentialsOpen,
    mailCredentialsSaving,
    mailCredentialsError,
    mailCredentialsReason,
    mailCredentialsLogin,
    mailCredentialsPassword,
    mailCredentialsEmail,
    setMailCredentialsLogin,
    setMailCredentialsPassword,
    setMailCredentialsEmail,
    openMailCredentialsDialog,
    closeMailCredentialsDialog,
    handleMailCredentialsRequired,
    handleSaveMailCredentials,
  } = useMailCredentialsController({
    mailAPI,
    activeMailboxId,
    mailboxInfo,
    setMailboxInfo,
    setMailboxes,
    setSelectedMailboxId,
    mergeMailboxEntries,
    getMailboxEntryId,
    getMailErrorCode,
    getMailErrorDetail,
    refreshConfig,
    refreshBootstrap: (options) => refreshBootstrapRef.current?.(options),
    invalidateMailClientCache,
    onError: setError,
    onMessage: notifyMailSuccess,
  });

  useMailCredentialsDialogGate({
    mailboxInfo,
    mailRequiresRelogin,
    mailRequiresPassword,
    mailboxUsesPrimaryCredentials,
    canSaveMailForAllDevices,
    mailCredentialsOpen,
    mailCredentialsReason,
    mailCredentialsError,
    selectedIdRef,
    openMailCredentialsDialog,
    closeMailCredentialsDialog,
    setError,
    setSelectedId,
    setSelectedMessage,
    setSelectedConversation,
    setSelectedItems,
    setSelectedByMode,
  });

  const templateEditor = useMailTemplateEditor({
    mailAPI,
    canManageTemplates: canManageUsers,
    onError: setError,
    onMessage: notifyMailSuccess,
  });
  const {
    templates,
    templatesOpen,
    dialogProps: templateDialogProps,
    ensureTemplatesLoaded: ensureTemplatesLoadedForItRequest,
    openTemplatesDialog,
  } = templateEditor;

  const {
    itOpen,
    itTemplateId,
    itFieldValues,
    itSending,
    activeTemplate,
    openItRequest,
    closeItRequest,
    clearItRequest,
    selectItTemplate,
    updateItFieldValue,
    submitItRequest,
  } = useMailItRequest({
    templates,
    ensureTemplatesLoaded: ensureTemplatesLoadedForItRequest,
    sendItRequest: mailAPI.sendItRequest,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    onError: setError,
    onMessage: notifyMailSuccess,
  });

  const refreshMailPreferences = useCallback(async () => {
    try {
      const data = await mailAPI.getPreferences();
      const nextValue = { ...DEFAULT_MAIL_PREFERENCES, ...((data?.preferences || data) || {}) };
      setMailPreferences(nextValue);
      setMailPreferencesDraft(nextValue);
    } catch {
      setMailPreferences(DEFAULT_MAIL_PREFERENCES);
      setMailPreferencesDraft(DEFAULT_MAIL_PREFERENCES);
    }
  }, []);

  const {
    loadMoreMessages,
    refreshBootstrap,
    refreshFolderSummary,
    refreshFolderTree,
    refreshList,
  } = useMailListDataController({
    activeMailboxId,
    advancedFiltersApplied,
    clearSelection,
    currentContextUsesBootstrapList,
    currentFolderScope,
    currentFolderSummaryCacheKey,
    currentFolderTreeCacheKey,
    currentListCacheKey,
    currentListContextKey,
    currentListParams,
    debouncedSearch,
    defaultMailPreferences: DEFAULT_MAIL_PREFERENCES,
    filterDateFrom,
    filterDateTo,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    hasAttachmentsOnly,
    isMobile,
    isTransientMailRequestError,
    listData,
    loadingMore,
    mailAccessReady,
    mailAPI,
    mailBootstrapLimit: MAIL_BOOTSTRAP_LIMIT,
    mailCacheScope,
    mailSwrStaleTimeMs: MAIL_SWR_STALE_TIME_MS,
    persistRecentBootstrapSnapshot,
    persistRecentListSnapshot,
    recentHydratedScope,
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
    resolveListDataReadStateOverrides,
    setError,
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
    unreadOnly,
    viewMode,
    withActiveMailboxParams,
  });
  refreshBootstrapRef.current = refreshBootstrap;

  const {
    handleQuickReplySendingStart,
    handleQuickReplySent,
  } = useMailQuickReplyStatusToasts({
    notifyMailInfo,
    notifyMailSuccess,
  });

  const {
    draftEpoch: quickReplyDraftEpoch,
    quickReplySending,
    sendQuickReply,
  } = useMailQuickReply({
    mailAPI,
    resolveComposeMailboxId,
    invalidateMailClientCache,
    refreshList,
    refreshFolderSummary,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    onError: setError,
    onSendingStart: handleQuickReplySendingStart,
    onSent: handleQuickReplySent,
  });

  const {
    applyConversationReadStateLocally,
    applyMessageReadStateLocally,
    performMailReadMutation,
  } = useMailReadMutations({
    activeMailboxId,
    advancedFiltersApplied,
    folder,
    getMailErrorDetail,
    getRecentMessageDetailSnapshot,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    persistRecentMessageDetailSnapshot,
    readStateOverrideTtlMs: MAIL_AUTO_READ_GUARD_TTL_MS,
    refreshFolderSummary,
    refreshList,
    refs: {
      listDataRef,
      selectedMessageRef,
      selectedConversationRef,
      localReadStateOverridesRef,
      folderSummaryRef,
    },
    setError,
    setFolderSummary,
    setListData,
    setSelectedConversation,
    setSelectedMessage,
    settleAutoReadGuard,
    unreadOnly,
    withActiveMailboxPayload,
  });
  const {
    revalidateSelectedMailDetail,
  } = useMailSelectedDetailLifecycle({
    activeMailboxId,
    advancedFiltersApplied,
    beginAutoReadGuard,
    clearSelection,
    folder,
    getMailErrorDetail,
    getRecentMessageDetailSnapshot,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    isMissingMailDetailError,
    isTransientMailRequestError,
    mailAPI,
    mailAccessReady,
    mailCacheScope,
    mailDetailStaleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS,
    navigate,
    performMailReadMutation,
    persistRecentMessageDetailSnapshot,
    refreshList,
    refs: {
      selectedIdRef,
      selectedMessageRef,
      selectedConversationRef,
      detailContextRef,
      detailRequestAbortRef,
      suppressNextAutoReadRef,
    },
    resolveConversationReadStateOverrides,
    resolveMessageReadStateOverrides,
    selectedId,
    setDetailLoading,
    setError,
    setSelectedConversation,
    setSelectedMessage,
    viewMode,
    withActiveMailboxParams,
  });
  const silentRevalidateCurrentMailView = useMailSilentViewRevalidate({
    mailAccessReady,
    mailConfigLoading,
    mailCacheScope,
    currentListContextKey,
    viewMode,
    folder,
    mailboxInfo,
    folderTreeRef,
    folderSummaryRef,
    folderSummaryRefreshCompletedAtRef,
    selectedIdRef,
    hasFreshSelectedMailDetail,
    refreshBootstrap,
    refreshList,
    refreshFolderSummary,
    revalidateSelectedMailDetail,
    runMailViewRefreshGate,
    setMailBackgroundRefreshing,
    folderSummaryRefreshCooldownMs: MAIL_FOLDER_SUMMARY_REFRESH_COOLDOWN_MS,
  });

  useEffect(() => {
    refreshBootstrap({ force: false });
  }, [mailCacheScope]);

  useMailCredentialsGateFolderClear({
    mailAccessReady,
    mailConfigLoading,
    mailRequiresPassword,
    mailRequiresRelogin,
    setFolderSummary,
    setFolderTree,
  });

  useMailListAccessRefresh({
    mailAccessReady,
    currentListContextKey,
    lastListRefreshContextKeyRef,
    skipNextListRefreshRef,
    refreshList,
  });

  useMailMissingFolderFallback({
    folderTree,
    folder,
    clearSelection,
    setFolder,
  });

  useMailSelectedByModeSync({
    selectedId,
    viewMode,
    setSelectedByMode,
  });

  useMailViewRefreshController({ silentRevalidateCurrentMailView });
  useMailConversationSelectionGuard({
    viewMode,
    selectedId,
    listItems: listData?.items,
    clearSelection,
  });

  useMailListLoadMoreObserver({
    loadMoreSentinelRef,
    hasMore: listData.has_more,
    loadMoreMessages,
  });

  useMailConversationThreadScroll({
    viewMode,
    selectedId,
    selectedConversationItemCount: selectedConversation?.items?.length,
    conversationScrollRef,
  });

  const {
    composeSession,
    composeOpen,
    openCompose,
    openComposeFromMessage,
    openComposeFromDraftMessage,
    openComposeFromDraft,
    openComposeToPerson,
    closeComposeSession,
  } = useMailComposeSessionController({
    composeDraftKey,
    resolveComposeMailboxId,
    selectedMessage,
    locationSearch: location.search,
    navigate,
  });
  const [composeExpanded, setComposeExpanded] = useState(false);
  const nativeComposeSaveHandlerRef = useRef(null);
  const dedicatedDraftLoadedRef = useRef('');
  const dedicatedCompose = location.pathname === '/mail/compose';
  const [desktopComposeAvailable, setDesktopComposeAvailable] = useState(
    () => isDesktopCapabilityAvailable('mail-compose-window'),
  );

  useEffect(() => {
    const update = () => setDesktopComposeAvailable(isDesktopCapabilityAvailable('mail-compose-window'));
    window.addEventListener(DESKTOP_CAPABILITIES_CHANGED_EVENT, update);
    update();
    return () => window.removeEventListener(DESKTOP_CAPABILITIES_CHANGED_EVENT, update);
  }, []);

  useEffect(() => {
    if (!composeOpen) setComposeExpanded(false);
  }, [composeOpen]);

  useEffect(() => {
    if (!dedicatedCompose) return undefined;
    const searchParams = new URLSearchParams(location.search || '');
    const draftId = String(searchParams.get('draft_id') || '').trim();
    const mailboxId = String(searchParams.get('mailbox_id') || '').trim();
    if (!draftId || dedicatedDraftLoadedRef.current === draftId) return undefined;
    dedicatedDraftLoadedRef.current = draftId;
    const controller = new AbortController();
    mailAPI.getMessage(draftId, { mailboxId, signal: controller.signal })
      .then((message) => openComposeFromDraftMessage(message))
      .catch((requestError) => {
        if (requestError?.name !== 'AbortError') {
          dedicatedDraftLoadedRef.current = '';
          setError(getMailErrorDetail(requestError, 'Не удалось открыть черновик.'));
        }
      });
    return () => controller.abort();
  }, [dedicatedCompose, getMailErrorDetail, location.search, openComposeFromDraftMessage]);

  useEffect(() => {
    if (!dedicatedCompose) return undefined;
    return subscribeDesktopMailComposeCloseRequested(async (requestId) => {
      const saved = await nativeComposeSaveHandlerRef.current?.();
      completeDesktopMailComposeClose(requestId, { saved: saved === true });
    });
  }, [dedicatedCompose]);

  useEffect(() => {
    if (dedicatedCompose) return undefined;
    const onCompleted = async () => {
      invalidateMailClientCache();
      await Promise.allSettled([refreshList(), refreshFolderSummary()]);
      notifyMailSuccess('Письмо отправлено из отдельного окна.');
    };
    window.addEventListener(DESKTOP_MAIL_COMPOSE_COMPLETED_EVENT, onCompleted);
    return () => window.removeEventListener(DESKTOP_MAIL_COMPOSE_COMPLETED_EVENT, onCompleted);
  }, [dedicatedCompose, invalidateMailClientCache, notifyMailSuccess, refreshFolderSummary, refreshList]);

  const openDesktopComposeWindow = useCallback(async ({ draftId, mailboxId }) => {
    const query = new URLSearchParams({ draft_id: draftId });
    if (mailboxId) query.set('mailbox_id', mailboxId);
    const result = await requestDesktopMailComposeWindow(`/mail/compose?${query.toString()}`);
    if (result.status === 'opened' || result.status === 'activated') {
      closeComposeSession();
      return;
    }
    notifyMailComposeWarning({
      id: 'desktop_compose_window_failed',
      severity: 'warning',
      title: result.status === 'busy' ? 'Редактор уже открыт' : 'Не удалось открыть окно',
      message: result.status === 'busy'
        ? 'Завершите письмо в уже открытом отдельном окне.'
        : 'Черновик сохранён. Продолжите редактирование в текущем окне.',
    });
  }, [closeComposeSession, notifyMailComposeWarning]);

  const handleComposeSent = useMailComposeSentAction({
    closeComposeSession,
    notifyMailSuccess,
    invalidateMailClientCache,
    refreshList,
    refreshFolderSummary,
  });

  const handleComposeDraftSaved = useMailComposeDraftSavedAction({
    notifyMailSuccess,
    invalidateMailClientCache,
    refreshFolderSummary,
  });

  const {
    signatureOpen,
    signatureSaving,
    signatureHtml,
    signatureMailboxId,
    setSignatureHtml,
    openSignatureEditor,
    closeSignatureEditor,
    clearSignature,
    handleSaveSignature,
  } = useMailSignatureSettings({
    mailAPI,
    activeMailboxId,
    mailboxInfo,
    resolveComposeMailboxId,
    mergeMailboxEntries,
    setMailboxInfo,
    setMailboxes,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    onError: setError,
    onMessage: notifyMailSuccess,
  });

  const {
    folderDialogOpen,
    closeFolderDialog,
    folderDialogMode,
    folderDialogTarget,
    folderDialogName,
    setFolderDialogName,
    folderDialogSaving,
    handleOpenCreateFolderDialog,
    handleOpenRenameFolderDialog,
    handleSubmitFolderDialog,
    handleDeleteFolder,
    handleToggleFavoriteFolder,
  } = useMailFolderMutations({
    mailAPI,
    activeMailboxId,
    folder,
    folderTree,
    setFolder,
    clearSelection,
    invalidateMailClientCache,
    refreshFolderTree,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    onError: setError,
    onMessage: notifyMailSuccess,
  });

  const notifyRecoverableMailDelete = useMemo(() => createMailTrashUndoNotifier({
    notifySuccess: notifyMailSuccess,
    mailAPI,
    withActiveMailboxPayload,
    afterUndo: createMailListRefreshAfterUndo({
      invalidateMailClientCache,
      refreshList,
      refreshFolderSummary,
    }),
    handleMailCredentialsRequired,
    getMailErrorDetail,
    onError: setError,
  }), [
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    notifyMailSuccess,
    refreshFolderSummary,
    refreshList,
    withActiveMailboxPayload,
  ]);

  const getFolderLabel = useMailFolderLabel(folderLabelMapRef);

  const notifyRecoverableMailMove = useMemo(() => createMailMoveUndoNotifier({
    notifySuccess: notifyMailSuccess,
    mailAPI,
    withActiveMailboxPayload,
    afterUndo: createMailListRefreshAfterUndo({
      invalidateMailClientCache,
      refreshList,
      refreshFolderSummary,
    }),
    handleMailCredentialsRequired,
    getMailErrorDetail,
    onError: setError,
  }), [
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    notifyMailSuccess,
    refreshFolderSummary,
    refreshList,
    withActiveMailboxPayload,
  ]);

  const {
    selectedMessageIds,
    bulkActionLoading,
    clearBulkSelection,
    afterListMutation,
    runBulkAction,
    handleStartDragItems,
    handleDropMessagesToFolder,
  } = useMailBulkActions({
    mailAPI,
    activeMailboxId,
    folder,
    selectedItems,
    setSelectedItems,
    setMoveTarget,
    selectedMessage,
    viewMode,
    clearSelection,
    invalidateMailClientCache,
    refreshList,
    refreshFolderSummary,
    withActiveMailboxPayload,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    onError: setError,
    onMessage: notifyMailSuccess,
    onRecoverableDelete: notifyRecoverableMailDelete,
    onRecoverableMove: notifyRecoverableMailMove,
    getFolderLabel,
  });

  const {
    messageActionLoading,
    handleArchiveSelectedMessage,
    handleDeleteSelectedMessage,
    handleMoveSelectedMessage,
    handleRestoreSelectedMessage,
    handleToggleImportance,
    handleToggleReadState,
  } = useMailSelectedPreviewActions({
    afterListMutation,
    clearSelection,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    moveTarget,
    onRecoverableDelete: notifyRecoverableMailDelete,
    onRecoverableMove: notifyRecoverableMailMove,
    getFolderLabel,
    performMailReadMutation,
    selectedConversation,
    selectedMessage,
    setError,
    setSelectedMessage,
    viewMode,
    withActiveMailboxPayload,
  });

  const handleMailAiError = useMailAiErrorHandler({
    getMailErrorDetail,
    setError,
  });

  const {
    mailAiEnabled,
    mailAiConsentOpen,
    mailAiSmartRepliesActive,
    handleMailAiEnabledChange,
    openMailAiConsentDialog,
    closeMailAiConsentDialog,
    confirmMailAiConsent,
  } = useMailAiConsentController();
  const {
    summary: mailAiSummary,
    summaryLoading: mailAiSummaryLoading,
    smartReplies: mailAiSmartReplies,
    smartRepliesLoading: mailAiSmartRepliesLoading,
    loadSummary: loadMailAiSummary,
    loadSmartReplies: loadMailAiSmartReplies,
  } = useMailMessageAi({
    messageId: selectedMessage?.id,
    mailboxId: activeMailboxId,
    enabled: Boolean(selectedMessage?.id) && mailAiEnabled,
    onError: handleMailAiError,
  });

  const handleCopyMailSummary = useMailCopySummary({
    notifyMailSuccess,
    setError,
  });

  const handleQuickReplySend = useMailQuickReplySend({
    selectedMessage,
    mailboxEmails,
    selectedConversation,
    viewMode,
    sendQuickReply,
  });

  const defaultReplyMode = useMemo(() => getMailSelectedReplyMode({
    message: selectedMessage,
    mailboxEmails,
    selectedConversation,
    viewMode,
  }), [mailboxEmails, selectedConversation, selectedMessage, viewMode]);
  const quickReplyPlaceholder = getMailQuickReplyPlaceholder(defaultReplyMode);

  const handleMarkAllRead = useMailMarkAllRead({
    mailAPI,
    activeMailboxId,
    folder,
    folderScope: advancedFiltersApplied?.folder_scope,
    viewMode,
    selectedConversation,
    selectedMessage,
    applyConversationReadStateLocally,
    applyMessageReadStateLocally,
    afterListMutation,
    notifyMailSuccess,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    setError,
  });

  const {
    getMessageDetailForListAction,
    handleSwipeRead,
    handleSwipeDelete,
    handleListRestoreMessage,
    handleListArchiveMessage,
    handleListMoveMessage,
  } = useMailListItemActions({
    mailAPI,
    viewMode,
    folder,
    selectedMessage,
    performMailReadMutation,
    afterListMutation,
    clearSelection,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    getRecentMessageDetailSnapshot,
    persistRecentMessageDetailSnapshot,
    resolveItemMailboxId,
    withActiveMailboxPayload,
    setError,
    onRecoverableDelete: notifyRecoverableMailDelete,
    onRecoverableMove: notifyRecoverableMailMove,
    getFolderLabel,
  });

  const {
    headersOpen,
    headersForDialog,
    closeHeadersDialog,
    attachmentPreview,
    closeAttachmentPreview,
    downloadAttachmentPreview,
    downloadAttachmentPreviewPdf,
    handleOpenHeaders,
    handleDownloadMessageSource,
    handlePrintSelectedMessage,
    handleListOpenHeaders,
    handleListDownloadMessageSource,
    handleListPrintMessage,
    openAttachmentPreview,
    downloadAttachmentFile,
    maxPreviewFileBytes,
  } = useMailMessageFileActions({
    mailAPI,
    selectedMessage,
    selectedRenderedHtml: selectedMessageRenderResult.html,
    viewMode,
    resolveItemMailboxId,
    getMessageDetailForListAction,
    handleMailCredentialsRequired,
    getMailErrorDetail,
    getMailErrorDetailAsync,
    setError,
    formatFullDate,
  });

  const requestCloseComposeThen = useMailComposeCloseThen({
    composeCloseRequestRef,
    closeComposeSession,
  });

  const selectMailListItem = useMailListItemSelection({
    isMobile,
    viewMode,
    folder,
    selectedMessageIds,
    selectedIdRef,
    selectedMessageRef,
    activeMailboxId,
    mailAPI,
    getRecentMessageDetailSnapshot,
    getMailErrorDetail,
    openComposeFromDraftMessage,
    saveCurrentListScrollPosition,
    revalidateSelectedMailDetail,
    closeMobileNavigationIfNeeded,
    setSelectedItems,
    setDetailLoading,
    setSelectedConversation,
    setSelectedMessage,
    setSelectedId,
    setSelectedByMode,
    setMoveTarget,
    setError,
  });

  const selectAdjacentMessageRaw = useMailAdjacentMessageSelection({
    listData,
    selectedId,
    selectedIdRef,
    setSelectedId,
    setSelectedByMode,
    setSelectedConversation,
    setSelectedMessage,
    viewMode,
    folder,
  });

  const {
    handleSelectMailListItem,
    selectAdjacentMessage,
  } = useMailComposeGatedSelection({
    composeOpen,
    requestCloseComposeThen,
    selectMailListItem,
    selectAdjacentMessageRaw,
  });

  useMailKeyboardShortcuts({
    searchInputRef,
    shortcutsOpen,
    setShortcutsOpen,
    openCompose,
    invalidateMailClientCache,
    refreshList,
    refreshFolderSummary,
    selectedMessageId: selectedMessage?.id,
    selectedMessageIds,
    selectAdjacentMessage,
    folder,
    runBulkAction,
    handleDeleteSelectedMessage,
    mobileNavigationOpen,
    setMobileNavigationOpen,
    composeOpen,
    composeCloseRequestRef,
    advancedSearchOpen,
    setAdvancedSearchOpen,
    mailPreferencesOpen,
    setMailPreferencesOpen,
    headersOpen,
    closeHeadersDialog,
  });

  const isOwnConversationMessage = useCallback((item) => (
    isOwnConversationMessageItem(item, { folder, mailboxEmails })
  ), [folder, mailboxEmails]);

  const {
    effectiveFolderTreeItems,
    currentFolderLabel,
    folderLabelMap,
  } = useMemo(
    () => resolveMailFolderTreeView({ folderTree, folderSummary, folder }),
    [folder, folderSummary, folderTree],
  );
  folderLabelMapRef.current = folderLabelMap;
  const moveTargets = useMemo(
    () => serializeMailMoveTargets(effectiveFolderTreeItems, folder),
    [effectiveFolderTreeItems, folder]
  );
  const advancedFiltersActive = isMailAdvancedFiltersActive(advancedFiltersApplied);
  const hasActiveFilters = hasActiveMailListFilters({
    search,
    unreadOnly,
    hasAttachmentsOnly,
    filterDateFrom,
    filterDateTo,
    advancedFiltersActive,
  });
  const noResultsHint = useMemo(
    () => getMailNoResultsHint({ hasActiveFilters, viewMode }),
    [hasActiveFilters, viewMode],
  );
  const readingPaneMode = isMobile ? 'stacked' : (mailPreferences?.reading_pane || 'right');
  const hideDesktopFolderColumn = !isMobile && isNarrowMailDesktop;
  const stackedDesktopPanes = !isMobile && isSplitMailDesktop;
  const mailPaneSizes = useMemo(() => getMailPaneSizes(mailPreferences), [
    mailPreferences?.bottom_list_percent,
    mailPreferences?.folder_pane_width,
    mailPreferences?.message_list_width,
  ]);
  const {
    handleFolderPaneResize,
    handleMessageListResize,
    handleBottomListResize,
  } = useMailPaneResize({
    desktopMailAreaRef,
    persistMailPaneSize,
  });
  const mailboxPrimaryDomain = useMemo(
    () => getMailMailboxPrimaryDomain(mailboxEmails),
    [mailboxEmails],
  );
  const folderRailUtilityItems = useMemo(
    () => buildMailFolderRailUtilityItems({
      canManageUsers,
      onItRequest: openItRequest,
      onOpenTemplates: openTemplatesDialog,
      onAfterClick: closeMobileNavigationIfNeeded,
    }),
    [canManageUsers, closeMobileNavigationIfNeeded, openItRequest, openTemplatesDialog],
  );
  const handleRefreshMailView = useMailViewRefreshAction({
    invalidateMailClientCache,
    refreshList,
    refreshFolderSummary,
    refreshFolderTree,
  });
  const handleOpenAdvancedSearch = useMailAdvancedSearchOpen({
    advancedFiltersApplied,
    search,
    setAdvancedFiltersDraft,
    setAdvancedSearchOpen,
  });
  const handleFolderChange = useCallback((value) => {
    const nextFolder = normalizeMailFolder(value);
    if (nextFolder === folder) {
      closeMobileNavigationIfNeeded();
      return;
    }
    const startedAt = Date.now();
    const nextContext = buildMailListRequestContext({
      scope: mailCacheScope,
      folder: nextFolder,
      viewMode,
      search: debouncedSearch,
      unreadOnly,
      hasAttachmentsOnly,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
      advancedFilters: advancedFiltersApplied,
      limit: 50,
      offset: 0,
    });
    const cachedList = peekSWRCache(nextContext.cacheKey, { staleTimeMs: MAIL_SWR_STALE_TIME_MS });
    const hydration = getMailRecentHydration({
      scope: mailCacheScope,
      contextKey: nextContext.contextKey,
    });
    const cachedPayload = hydration?.listData || cachedList?.data || null;
    clearSelection({ allModes: true });
    setSelectedItems([]);
    skipNextListRefreshRef.current = false;
    lastListRefreshContextKeyRef.current = nextContext.contextKey;
    currentListKeyRef.current = nextContext.contextKey;
    if (cachedPayload) {
      const normalizedList = normalizeMailListResponse(cachedPayload);
      listDataRef.current = normalizedList;
      setListData(normalizedList);
      setLoading(false);
      recentHydratedListContextsRef.current.add(nextContext.contextKey);
    } else {
      const emptyList = createEmptyListData();
      listDataRef.current = emptyList;
      setListData(emptyList);
      setLoading(true);
      recentHydratedListContextsRef.current.delete(nextContext.contextKey);
    }
    setFolder(nextFolder);
    closeMobileNavigationIfNeeded();
    void refreshList({
      force: true,
      listParams: nextContext.params,
      listCacheKey: nextContext.cacheKey,
      listContextKey: nextContext.contextKey,
      reason: 'folder-click',
      startedAt,
    });
  }, [
    advancedFiltersApplied,
    clearSelection,
    closeMobileNavigationIfNeeded,
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    mailCacheScope,
    refreshList,
    unreadOnly,
    viewMode,
  ]);
  const handleViewModeChange = useCallback((value) => {
    const nextMode = value === 'conversations' ? 'conversations' : 'messages';
    if (nextMode === viewMode) {
      closeMobileNavigationIfNeeded();
      return;
    }
    const startedAt = Date.now();
    const nextContext = buildMailListRequestContext({
      scope: mailCacheScope,
      folder,
      viewMode: nextMode,
      search: debouncedSearch,
      unreadOnly,
      hasAttachmentsOnly,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
      advancedFilters: advancedFiltersApplied,
      limit: 50,
      offset: 0,
    });
    const cachedList = peekSWRCache(nextContext.cacheKey, { staleTimeMs: MAIL_SWR_STALE_TIME_MS });
    const hydration = getMailRecentHydration({
      scope: mailCacheScope,
      contextKey: nextContext.contextKey,
    });
    const cachedPayload = hydration?.listData || cachedList?.data || null;
    const nextSelectedId = String(selectedByMode?.[nextMode] || '');
    detailContextRef.current = '';
    selectedIdRef.current = nextSelectedId;
    setSelectedItems([]);
    skipNextListRefreshRef.current = false;
    lastListRefreshContextKeyRef.current = nextContext.contextKey;
    currentListKeyRef.current = nextContext.contextKey;
    if (cachedPayload) {
      const normalizedList = normalizeMailListResponse(cachedPayload);
      listDataRef.current = normalizedList;
      setListData(normalizedList);
      setLoading(false);
      recentHydratedListContextsRef.current.add(nextContext.contextKey);
    } else {
      const emptyList = createEmptyListData();
      listDataRef.current = emptyList;
      setListData(emptyList);
      setLoading(true);
      recentHydratedListContextsRef.current.delete(nextContext.contextKey);
    }
    setViewMode(nextMode);
    setSelectedId(nextSelectedId);
    setSelectedMessage(null);
    setSelectedConversation(null);
    closeMobileNavigationIfNeeded();
    void refreshList({
      force: true,
      listParams: nextContext.params,
      listCacheKey: nextContext.cacheKey,
      listContextKey: nextContext.contextKey,
      viewMode: nextMode,
      reason: 'view-mode-click',
      startedAt,
    });
  }, [
    advancedFiltersApplied,
    closeMobileNavigationIfNeeded,
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    mailCacheScope,
    refreshList,
    selectedByMode,
    unreadOnly,
    viewMode,
  ]);
  const {
    handleUnreadToggle,
    handleToggleHasAttachmentsOnly,
    handleToggleTodayFilter,
    handleToggleLast7DaysFilter,
  } = useMailListQuickFilters({
    setUnreadOnly,
    setHasAttachmentsOnly,
    filterDateFrom,
    filterDateTo,
    setFilterDateFrom,
    setFilterDateTo,
    onAfterChange: closeMobileNavigationIfNeeded,
  });
  const {
    handleCreateFolderRequest,
    handleRenameFolderRequest,
    handleDeleteFolderRequest,
    handleToggleFavoriteFolderFromRail,
  } = useMailFolderRailFolderActions({
    closeMobileNavigationIfNeeded,
    handleOpenCreateFolderDialog,
    handleOpenRenameFolderDialog,
    handleDeleteFolder,
    handleToggleFavoriteFolder,
  });

  const listPanel = (
    <Box
      data-testid="mail-list-panel"
      sx={{
        height: isMobile ? 0 : '100%',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        flex: '1 1 0%',
        display: stackedDesktopPanes && Boolean(selectedId) ? 'none' : 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: ui.panelBg,
        borderRight: !isMobile ? '1px solid' : 'none',
        borderColor: ui.borderSoft,
      }}
    >
      {viewMode === 'messages' && selectedMessageIds.length > 0 ? (
        <MailBulkActionBar
          count={selectedMessageIds.length}
          moveTarget={moveTarget}
          moveTargets={moveTargets}
          loading={bulkActionLoading}
          onMoveTargetChange={setMoveTarget}
          onMarkRead={() => runBulkAction({ action: 'mark_read', successMessage: 'Выбранные письма отмечены как прочитанные.' })}
          onMarkUnread={() => runBulkAction({ action: 'mark_unread', successMessage: 'Выбранные письма отмечены как непрочитанные.' })}
          onArchive={() => runBulkAction({ action: 'archive', successMessage: 'Выбранные письма отправлены в архив.' })}
          onMove={() => runBulkAction({ action: 'move', targetFolder: moveTarget, successMessage: 'Выбранные письма перемещены.' })}
          onDelete={() => runBulkAction({
            action: 'delete',
            permanent: folder === 'trash',
            successMessage: folder === 'trash' ? 'Выбранные письма удалены навсегда.' : 'Выбранные письма перемещены в удаленные.',
          })}
          onClear={clearBulkSelection}
          isMobile={isMobile}
          mobilePlacement={isMobile ? 'header' : 'all'}
        />
      ) : null}
      <Box
        sx={{
          px: { xs: 1.2, md: 1.1 },
          py: { xs: 0.45, md: 0.4 },
          minHeight: 32,
          borderBottom: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: alpha(ui.panelBg, ui.isDark ? 0.98 : 0.94),
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
              <Typography
                variant="subtitle2"
                data-testid="mail-list-current-folder"
                noWrap
                sx={{ fontWeight: 700, minWidth: 0, fontSize: '0.9rem' }}
              >
                {currentFolderLabel}
                {hasActiveFilters ? ` · ${formatMailFolderCountCaption({
                  total: listData.total,
                  viewMode,
                  hasActiveFilters: true,
                })}` : ''}
              </Typography>
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ flexShrink: 0 }}>
                {mailBackgroundRefreshing ? (
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label="Обновляем..."
                    data-testid="mail-background-refresh-chip"
                    sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
                  />
                ) : null}
                {!hasActiveFilters ? (
                  <Typography
                    data-testid="mail-list-folder-count"
                    sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.78rem' }}
                  >
                    {formatMailFolderCountCaption({
                      total: listData.total,
                      viewMode,
                    })}
                  </Typography>
                ) : null}
              </Stack>
            </Stack>
            {advancedFiltersApplied?.folder_scope === 'all' || advancedFiltersActive ? (
              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap sx={{ mt: 0.3 }}>
                {advancedFiltersApplied?.folder_scope === 'all' ? (
                  <Chip size="small" variant="outlined" label="Все папки" />
                ) : null}
                {advancedFiltersActive ? (
                  <Chip size="small" variant="outlined" label="Фильтры" />
                ) : null}
              </Stack>
            ) : null}
          </Box>
        </Stack>
      </Box>
      <MailMessageList
        listSx={{ flex: '1 1 0%', minHeight: 0, minWidth: 0, height: isMobile ? 0 : undefined }}
        folder={folder}
        viewMode={viewMode}
        listData={listData}
        loading={Boolean(loading || (mailConfigLoading && !(Array.isArray(listData?.items) && listData.items.length > 0)))}
        loadingMore={loadingMore}
        selectedItems={selectedItems}
        selectedId={selectedId}
        density={mailPreferences?.density || 'comfortable'}
        showPreviewSnippets={Boolean(mailPreferences?.show_preview_snippets)}
        onPrefetchId={undefined}
        onSelectId={handleSelectMailListItem}
        onToggleSelectedListItem={(id) => setSelectedItems((prev) => (prev.includes(String(id)) ? prev.filter((item) => item !== String(id)) : [...prev, String(id)]))}
        onStartDragItems={handleStartDragItems}
        formatTime={formatTime}
        getAvatarColor={getAvatarColor}
        getInitials={getInitials}
        hasActiveFilters={hasActiveFilters}
        onClearListFilters={() => {
          setSearch('');
          setUnreadOnly(false);
          setHasAttachmentsOnly(false);
          setFilterDateFrom('');
          setFilterDateTo('');
          setAdvancedFiltersDraft(DEFAULT_ADVANCED_FILTERS);
          setAdvancedFiltersApplied(DEFAULT_ADVANCED_FILTERS);
        }}
        noResultsHint={noResultsHint}
        onLoadMoreMessages={loadMoreMessages}
        messageListRef={messageListRef}
        loadMoreSentinelRef={loadMoreSentinelRef}
        isMobile={isMobile}
        isSearch={Boolean(String(debouncedSearch || '').trim()) || advancedFiltersApplied?.folder_scope === 'all'}
        mailboxEmails={mailboxEmails}
        onSwipeRead={isMobile ? undefined : handleSwipeRead}
        onSwipeDelete={isMobile ? undefined : handleSwipeDelete}
        onRestoreMessage={handleListRestoreMessage}
        onArchiveMessage={handleListArchiveMessage}
        onMoveMessage={handleListMoveMessage}
        onOpenHeaders={handleListOpenHeaders}
        onDownloadSource={handleListDownloadMessageSource}
        onPrintMessage={handleListPrintMessage}
        moveTargets={moveTargets}
        onPullToRefresh={undefined}
      />
      {viewMode === 'messages' && selectedMessageIds.length > 0 && isMobile ? (
        <MailBulkActionBar
          count={selectedMessageIds.length}
          moveTarget={moveTarget}
          moveTargets={moveTargets}
          loading={bulkActionLoading}
          onMoveTargetChange={setMoveTarget}
          onMarkRead={() => runBulkAction({ action: 'mark_read', successMessage: 'Выбранные письма отмечены как прочитанные.' })}
          onMarkUnread={() => runBulkAction({ action: 'mark_unread', successMessage: 'Выбранные письма отмечены как непрочитанные.' })}
          onArchive={() => runBulkAction({ action: 'archive', successMessage: 'Выбранные письма отправлены в архив.' })}
          onMove={() => runBulkAction({ action: 'move', targetFolder: moveTarget, successMessage: 'Выбранные письма перемещены.' })}
          onDelete={() => runBulkAction({
            action: 'delete',
            permanent: folder === 'trash',
            successMessage: folder === 'trash' ? 'Выбранные письма удалены навсегда.' : 'Выбранные письма перемещены в удаленные.',
          })}
          onClear={clearBulkSelection}
          isMobile={isMobile}
          mobilePlacement="footer"
        />
      ) : null}
    </Box>
  );
  const dedicatedComposeLoading = <MailDedicatedComposeLoadingState ui={ui} />;
  const previewContent = composeOpen && !isMobile ? (
    <Suspense fallback={dedicatedCompose ? dedicatedComposeLoading : null}>
      <MailComposeHost
        session={composeSession}
        layoutMode={dedicatedCompose || composeExpanded ? 'desktop-fullscreen' : 'desktop-inline'}
        expanded={dedicatedCompose || composeExpanded}
        onToggleExpanded={!dedicatedCompose && !desktopComposeAvailable ? () => setComposeExpanded((value) => !value) : undefined}
        onOpenDesktopWindow={!dedicatedCompose && desktopComposeAvailable ? openDesktopComposeWindow : undefined}
        activeMailboxId={activeMailboxId}
        composeFromOptions={composeFromOptions}
        composeDraftKey={composeDraftKey}
        resolveComposeMailboxId={resolveComposeMailboxId}
        mailboxPrimaryDomain={mailboxPrimaryDomain}
        mailboxSignatureHtml={mailboxInfo?.mail_signature_html}
        signatureOpen={signatureOpen}
        signatureHtml={signatureHtml}
        signatureMailboxId={signatureMailboxId}
        formatFullDate={formatFullDate}
        formatFileSize={formatFileSize}
        sumFilesSize={sumFilesSize}
        sumAttachmentSize={sumAttachmentSize}
        onOpenSignatureEditor={openSignatureEditor}
        onCloseSession={closeComposeSession}
        onRegisterCloseHandler={(handler) => { composeCloseRequestRef.current = handler; }}
        onSendSuccess={dedicatedCompose ? async () => {
          await handleComposeSent();
          notifyDesktopMailComposeSent();
        } : handleComposeSent}
        onDraftSaved={handleComposeDraftSaved}
        onRegisterNativeSaveHandler={dedicatedCompose ? (handler) => { nativeComposeSaveHandlerRef.current = handler; } : undefined}
        onComposeWarning={notifyMailComposeWarning}
        handleMailCredentialsRequired={handleMailCredentialsRequired}
        getMailErrorDetail={getMailErrorDetail}
      />
    </Suspense>
  ) : detailLoading && selectedMessage ? (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {isMobile ? (
        <MailMobilePreviewChrome
          selectedMessage={selectedMessage}
          selectedConversation={selectedConversation}
          viewMode={viewMode}
          folder={folder}
          onBackToList={handleBackToList}
          getAvatarColor={getAvatarColor}
          getInitials={getInitials}
          formatFullDate={formatFullDate}
          formatTime={formatTime}
        />
      ) : (
        <MailPreviewHeader
          selectedMessage={selectedMessage}
          selectedConversation={selectedConversation}
          viewMode={viewMode}
          folder={folder}
          messageActionLoading
          onOpenComposeFromDraft={openComposeFromDraft}
          onOpenComposeFromMessage={openComposeFromMessage}
          onToggleReadState={() => {}}
          onRestoreSelectedMessage={() => {}}
          onDeleteSelectedMessage={() => {}}
          onArchiveSelectedMessage={() => {}}
          moveTarget={moveTarget}
          onMoveTargetChange={() => {}}
          onMoveSelectedMessage={() => {}}
          moveTargets={moveTargets}
          onOpenHeaders={() => {}}
          onDownloadSource={() => {}}
          onPrintSelectedMessage={() => {}}
          getAvatarColor={getAvatarColor}
          getInitials={getInitials}
          formatFullDate={formatFullDate}
          showBackButton={readingPaneMode === 'off' || (!isMobile && isSplitMailDesktop)}
          compactMobile={false}
          onBackToList={handleBackToList}
          mailboxEmails={mailboxEmails}
          onComposeToPerson={openComposeToPerson}
        />
      )}
      <Box
        className="mail-scroll-hidden"
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <Box sx={{ p: 2 }}>
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="rectangular" height={280} sx={{ mt: 1, borderRadius: '8px' }} />
        </Box>
        <MailPreviewMobileReplySection quickReplyDisabled />
      </Box>
      {isMobile ? (
        <MailPreviewMobileFooter
          actionBarProps={{
            selectedMessage,
            selectedConversation,
            viewMode,
            folder,
            messageActionLoading: true,
            onOpenComposeFromDraft: openComposeFromDraft,
            onOpenComposeFromMessage: openComposeFromMessage,
            onToggleReadState: () => {},
            onRestoreSelectedMessage: () => {},
            onDeleteSelectedMessage: () => {},
            onArchiveSelectedMessage: () => {},
            moveTarget,
            onMoveTargetChange: () => {},
            onMoveSelectedMessage: () => {},
            moveTargets,
            onOpenHeaders: () => {},
            onDownloadSource: () => {},
            onPrintSelectedMessage: () => {},
            mailboxEmails,
          }}
        />
      ) : null}
    </Box>
  ) : detailLoading ? (
    <Box sx={{ p: 2 }}><Skeleton variant="text" width="60%" /><Skeleton variant="rectangular" height={280} sx={{ mt: 1, borderRadius: '8px' }} /></Box>
  ) : !selectedMessage ? (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <MailOutlineIcon sx={{ fontSize: 58, color: 'text.disabled', mb: 1.2 }} />
      <Typography variant="body2" color="text.secondary">{viewMode === 'conversations' ? 'Выберите цепочку' : 'Выберите письмо'}</Typography>
    </Box>
  ) : (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {isMobile ? (
        <MailMobilePreviewChrome
          selectedMessage={selectedMessage}
          selectedConversation={selectedConversation}
          viewMode={viewMode}
          folder={folder}
          onBackToList={handleBackToList}
          getAvatarColor={getAvatarColor}
          getInitials={getInitials}
          formatFullDate={formatFullDate}
          formatTime={formatTime}
          summarizeLoading={mailAiSummaryLoading}
          summarizeText={mailAiSummary}
          onSummarize={loadMailAiSummary}
          onCopySummary={handleCopyMailSummary}
          aiEnabled={mailAiEnabled}
          onRequestAiEnable={openMailAiConsentDialog}
        />
      ) : (
        <MailPreviewHeader
          selectedMessage={selectedMessage}
          selectedConversation={selectedConversation}
          viewMode={viewMode}
          folder={folder}
          messageActionLoading={messageActionLoading}
          onOpenComposeFromDraft={openComposeFromDraft}
          onOpenComposeFromMessage={openComposeFromMessage}
          onToggleReadState={handleToggleReadState}
          onRestoreSelectedMessage={handleRestoreSelectedMessage}
          onDeleteSelectedMessage={handleDeleteSelectedMessage}
          onArchiveSelectedMessage={handleArchiveSelectedMessage}
          moveTarget={moveTarget}
          onMoveTargetChange={setMoveTarget}
          onMoveSelectedMessage={handleMoveSelectedMessage}
          moveTargets={moveTargets}
          onOpenHeaders={handleOpenHeaders}
          onDownloadSource={handleDownloadMessageSource}
          onPrintSelectedMessage={handlePrintSelectedMessage}
          getAvatarColor={getAvatarColor}
          getInitials={getInitials}
          formatFullDate={formatFullDate}
          showBackButton={readingPaneMode === 'off' || (!isMobile && isSplitMailDesktop)}
          compactMobile={false}
          summarizeLoading={mailAiSummaryLoading}
          summarizeText={mailAiSummary}
          onSummarize={loadMailAiSummary}
          onCopySummary={handleCopyMailSummary}
          onBackToList={handleBackToList}
          aiEnabled={mailAiEnabled}
          onRequestAiEnable={openMailAiConsentDialog}
          mailboxEmails={mailboxEmails}
          onComposeToPerson={openComposeToPerson}
        />
      )}
      {viewMode === 'conversations' ? (
        <MailConversationReader
          conversation={selectedConversation}
          selectedMessage={selectedMessage}
          scrollRef={conversationScrollRef}
          ui={ui}
          isMobile={isMobile}
          quickReplyDraftKey={selectedMessage?.id}
          quickReplyDraftEpoch={quickReplyDraftEpoch}
          quickReplySending={quickReplySending}
          quickReplyDisabled={folder === 'drafts'}
          onSendQuickReply={handleQuickReplySend}
          onQuickReplyFocus={mailAiSmartRepliesActive ? loadMailAiSmartReplies : undefined}
          smartReplySuggestions={mailAiSmartRepliesActive ? mailAiSmartReplies : []}
          smartReplyLoading={mailAiSmartRepliesActive ? mailAiSmartRepliesLoading : false}
          smartReplyChipsEnabled={mailAiSmartRepliesActive}
          placeholder={quickReplyPlaceholder}
          onOpenComposeFromMessage={openComposeFromMessage}
          onSelectMessage={setSelectedMessage}
          isOwnMessage={isOwnConversationMessage}
          getSenderDisplay={getSenderDisplay}
          getAvatarColor={getAvatarColor}
          getInitials={getInitials}
          formatTime={formatTime}
          formatFileSize={formatFileSize}
          revealedRemoteImagesByMessageId={revealedRemoteImagesByMessageId}
          mailRenderColorScheme={mailRenderColorScheme}
          getRenderedContentSx={(options = {}) => getMailRenderedContentSx({ ...options, theme })}
          onRevealRemoteImages={revealRemoteImagesForMessage}
          onOpenAttachment={openAttachmentPreview}
          onDownloadAttachment={downloadAttachmentFile}
        />
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <Box
            className="mail-scroll-hidden"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <MailMessageReader
              message={selectedMessage}
              renderState={selectedMessageRenderState}
              ui={ui}
              isMobile={isMobile}
              scrollRoot={false}
              formatFileSize={formatFileSize}
              formatFullDate={formatFullDate}
              getRenderedContentSx={(options = {}) => getMailRenderedContentSx({ ...options, theme })}
              onRevealRemoteImages={revealRemoteImagesForMessage}
              onOpenAttachment={openAttachmentPreview}
              onDownloadAttachment={downloadAttachmentFile}
            />
          </Box>
          {!isMailOutgoingMessage(selectedMessage, { folder, mailboxEmails }) && folder !== 'drafts' ? (
            <Box data-testid="mail-preview-quick-reply" sx={{ flexShrink: 0 }}>
              <MailPreviewMobileReplySection
                startCollapsed={!isMobile}
                quickReplyDraftKey={selectedMessage?.id}
                quickReplyDraftEpoch={quickReplyDraftEpoch}
                quickReplySending={quickReplySending}
                quickReplyDisabled={false}
                onSendQuickReply={handleQuickReplySend}
                onQuickReplyFocus={mailAiSmartRepliesActive ? loadMailAiSmartReplies : undefined}
                smartReplySuggestions={mailAiSmartRepliesActive ? mailAiSmartReplies : []}
                smartReplyLoading={mailAiSmartRepliesActive ? mailAiSmartRepliesLoading : false}
                smartReplyChipsEnabled={mailAiSmartRepliesActive}
                placeholder={quickReplyPlaceholder}
              />
            </Box>
          ) : null}
        </Box>
      )}
      {isMobile ? (
        <MailPreviewMobileFooter
          actionBarProps={{
            selectedMessage,
            selectedConversation,
            viewMode,
            folder,
            messageActionLoading,
            onOpenComposeFromDraft: openComposeFromDraft,
            onOpenComposeFromMessage: openComposeFromMessage,
            onToggleReadState: handleToggleReadState,
            onToggleImportance: handleToggleImportance,
            onRestoreSelectedMessage: handleRestoreSelectedMessage,
            onDeleteSelectedMessage: handleDeleteSelectedMessage,
            onArchiveSelectedMessage: handleArchiveSelectedMessage,
            moveTarget,
            onMoveTargetChange: setMoveTarget,
            onMoveSelectedMessage: handleMoveSelectedMessage,
            moveTargets,
            onOpenHeaders: handleOpenHeaders,
            onDownloadSource: handleDownloadMessageSource,
            onPrintSelectedMessage: handlePrintSelectedMessage,
            mailboxEmails,
          }}
        />
      ) : null}
    </Box>
  );
  if (dedicatedCompose) {
    return (
      <Box
        data-testid="mail-dedicated-compose-route"
        sx={{
          ...getMailUiFontScopeSx(),
          width: '100vw',
          height: '100dvh',
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          bgcolor: ui.panelBg,
          '--mail-shell-bg': ui.shellBg,
          '--mail-panel-bg': ui.panelBg,
          '--mail-panel-solid': ui.panelSolid,
          '--mail-divider': ui.borderSoft,
          '--mail-radius-sm': ui.radiusSm,
          '--mail-radius-md': ui.radiusMd,
          '--mail-radius-lg': ui.radiusLg,
        }}
      >
        {error ? (
          <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: 0 }}>
            {error}
          </Alert>
        ) : null}
        {composeOpen ? previewContent : dedicatedComposeLoading}

        <MailCredentialsDialog
          open={mailCredentialsOpen}
          reason={mailCredentialsReason}
          ui={ui}
          login={mailCredentialsLogin}
          email={mailCredentialsEmail}
          password={mailCredentialsPassword}
          error={mailCredentialsError}
          saving={mailCredentialsSaving}
          loginPlaceholder={mailboxInfo?.effective_mailbox_login}
          emailPlaceholder={mailboxInfo?.mailbox_email}
          onLoginChange={setMailCredentialsLogin}
          onEmailChange={setMailCredentialsEmail}
          onPasswordChange={setMailCredentialsPassword}
          onSave={handleSaveMailCredentials}
        />

        {signatureOpen ? (
          <Suspense fallback={null}>
            <MailSignatureDialog
              open={signatureOpen}
              onClose={closeSignatureEditor}
              signatureHtml={signatureHtml}
              onSignatureChange={setSignatureHtml}
              signatureSaving={signatureSaving}
              onClear={clearSignature}
              onSave={handleSaveSignature}
            />
          </Suspense>
        ) : null}
      </Box>
    );
  }

  const previewPanel = (
    <Box
      data-testid="mail-preview-panel"
      sx={{
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        maxWidth: '100%',
        display: ((isMobile || stackedDesktopPanes) && !selectedId) ? 'none' : 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: ui.panelSolid || ui.panelBg,
      }}
    >
      {previewContent}
    </Box>
  );
  const renderFolderRail = (
    <Box
      sx={{
        minHeight: 0,
        height: '100%',
        overflow: 'hidden',
        borderRight: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: ui.panelInset || ui.panelBg,
      }}
    >
      <MailFolderRail
        compact={false}
        folder={folder}
        folderTreeItems={effectiveFolderTreeItems}
        onFolderChange={handleFolderChange}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        unreadOnly={unreadOnly}
        onUnreadToggle={handleUnreadToggle}
        hasAttachmentsOnly={hasAttachmentsOnly}
        onToggleHasAttachmentsOnly={handleToggleHasAttachmentsOnly}
        filterDateFrom={filterDateFrom}
        filterDateTo={filterDateTo}
        onToggleToday={handleToggleTodayFilter}
        onToggleLast7Days={handleToggleLast7DaysFilter}
        onCreateFolderRequest={handleCreateFolderRequest}
        onRenameFolderRequest={handleRenameFolderRequest}
        onDeleteFolderRequest={handleDeleteFolderRequest}
        onToggleFavorite={handleToggleFavoriteFolderFromRail}
        onDropMessagesToFolder={handleDropMessagesToFolder}
        showFavoritesFirst={Boolean(mailPreferences?.show_favorites_first)}
        onCompose={openCompose}
        utilityItems={folderRailUtilityItems}
      />
    </Box>
  );
  const desktopMailArea = readingPaneMode === 'right' ? (
    <Box
      ref={desktopMailAreaRef}
      data-testid="mail-desktop-area"
      data-folder-pane-width={mailPaneSizes.folder_pane_width}
      data-message-list-width={mailPaneSizes.message_list_width}
      data-bottom-list-percent={mailPaneSizes.bottom_list_percent}
      sx={{
        '--mail-folder-pane-width': getMailPaneCssValue('folder_pane_width', mailPaneSizes.folder_pane_width),
        '--mail-message-list-width': getMailPaneCssValue('message_list_width', mailPaneSizes.message_list_width),
        '--mail-bottom-list-percent': getMailPaneCssValue('bottom_list_percent', mailPaneSizes.bottom_list_percent),
        display: 'grid',
        gap: 0,
        gridTemplateColumns: hideDesktopFolderColumn
          ? (stackedDesktopPanes
            ? 'minmax(0, 1fr)'
            : 'minmax(280px, min(var(--mail-message-list-width), 46%)) 7px minmax(480px, 1fr)')
          : 'minmax(180px, min(var(--mail-folder-pane-width), 32%)) 7px minmax(280px, min(var(--mail-message-list-width), 46%)) 7px minmax(0, 1fr)',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: ui.panelBg,
      }}
    >
      {hideDesktopFolderColumn ? null : renderFolderRail}
      {hideDesktopFolderColumn ? null : (
        <MailPaneResizeHandle
          testId="mail-folder-pane-resizer"
          label="Изменить ширину панели папок"
          orientation="vertical"
          value={mailPaneSizes.folder_pane_width}
          min={MAIL_PANE_LIMITS.folder_pane_width.min}
          max={MAIL_PANE_LIMITS.folder_pane_width.max}
          step={MAIL_PANE_LIMITS.folder_pane_width.step}
          defaultValue={MAIL_PANE_DEFAULTS.folder_pane_width}
          onResize={handleFolderPaneResize}
        />
      )}
      {listPanel}
      {stackedDesktopPanes ? null : (
        <MailPaneResizeHandle
          testId="mail-message-list-resizer"
          label="Изменить ширину списка писем"
          orientation="vertical"
          value={mailPaneSizes.message_list_width}
          min={MAIL_PANE_LIMITS.message_list_width.min}
          max={MAIL_PANE_LIMITS.message_list_width.max}
          step={MAIL_PANE_LIMITS.message_list_width.step}
          defaultValue={MAIL_PANE_DEFAULTS.message_list_width}
          onResize={handleMessageListResize}
        />
      )}
      {previewPanel}
    </Box>
  ) : (
    <Box
      ref={desktopMailAreaRef}
      data-testid="mail-desktop-area"
      data-folder-pane-width={mailPaneSizes.folder_pane_width}
      data-message-list-width={mailPaneSizes.message_list_width}
      data-bottom-list-percent={mailPaneSizes.bottom_list_percent}
      sx={{
        '--mail-folder-pane-width': getMailPaneCssValue('folder_pane_width', mailPaneSizes.folder_pane_width),
        '--mail-message-list-width': getMailPaneCssValue('message_list_width', mailPaneSizes.message_list_width),
        '--mail-bottom-list-percent': getMailPaneCssValue('bottom_list_percent', mailPaneSizes.bottom_list_percent),
        display: 'grid',
        gap: 0,
        gridTemplateColumns: hideDesktopFolderColumn
          ? 'minmax(0, 1fr)'
          : 'minmax(180px, min(var(--mail-folder-pane-width), 32%)) 7px minmax(0, 1fr)',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: ui.panelBg,
      }}
    >
      {hideDesktopFolderColumn ? null : renderFolderRail}
      {hideDesktopFolderColumn ? null : (
        <MailPaneResizeHandle
          testId="mail-folder-pane-resizer"
          label="Изменить ширину панели папок"
          orientation="vertical"
          value={mailPaneSizes.folder_pane_width}
          min={MAIL_PANE_LIMITS.folder_pane_width.min}
          max={MAIL_PANE_LIMITS.folder_pane_width.max}
          step={MAIL_PANE_LIMITS.folder_pane_width.step}
          defaultValue={MAIL_PANE_DEFAULTS.folder_pane_width}
          onResize={handleFolderPaneResize}
        />
      )}
      {readingPaneMode === 'bottom' ? (
        <Box
          sx={{
            minHeight: 0,
            height: '100%',
            display: 'grid',
            gap: 0,
            gridTemplateRows: 'minmax(220px, var(--mail-bottom-list-percent)) 7px minmax(0, 1fr)',
          }}
        >
          {listPanel}
          <MailPaneResizeHandle
            testId="mail-bottom-list-resizer"
            label="Изменить высоту списка писем"
            orientation="horizontal"
            value={mailPaneSizes.bottom_list_percent}
            min={MAIL_PANE_LIMITS.bottom_list_percent.min}
            max={MAIL_PANE_LIMITS.bottom_list_percent.max}
            step={MAIL_PANE_LIMITS.bottom_list_percent.step}
            defaultValue={MAIL_PANE_DEFAULTS.bottom_list_percent}
            onResize={handleBottomListResize}
          />
          {previewPanel}
        </Box>
      ) : (
        listPanel
      )}
    </Box>
  );
  const mobileListScreen = (
    <Box
      data-testid="mail-mobile-list-screen"
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        pt: isMobileFullscreenPreview ? 'var(--app-shell-header-offset)' : 0,
        pointerEvents: isMobileFullscreenPreview ? 'none' : 'auto',
        userSelect: isMobileFullscreenPreview ? 'none' : undefined,
      }}
    >
      {listPanel}
    </Box>
  );
  const mobilePreviewScreen = isMobileFullscreenPreview ? (
    <Box
      data-testid="mail-mobile-preview-screen"
      {...previewEdgeTouchHandlers}
      sx={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        width: '100%',
        maxWidth: '100vw',
        zIndex: theme.zIndex.drawer - 1,
        display: 'flex',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        boxSizing: 'border-box',
        bgcolor: ui.panelBg,
        touchAction: 'pan-y',
        pt: 'env(safe-area-inset-top, 0px)',
        pb: 'env(safe-area-inset-bottom, 0px)',
        overscrollBehaviorY: 'contain',
        transform: `translateX(${Math.max(0, Number(mobilePreviewSwipeOffset || 0))}px)`,
        transition: mobilePreviewSwipeTransition
          ? `transform ${mobilePreviewSwipeAnimationMs}ms ease-out, box-shadow ${mobilePreviewSwipeAnimationMs}ms ease-out`
          : 'none',
        boxShadow: mobilePreviewSwipeOffset > 0
          ? `-12px 0 28px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.34 : 0.16)}`
          : 'none',
      }}
    >
      {previewPanel}
    </Box>
  ) : null;
  const mainMailArea = isMobile ? (
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        flex: '1 1 0%',
        height: 0,
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {mobileListScreen}
      {mobilePreviewScreen}
    </Box>
  ) : desktopMailArea;
  const mailCredentialsPanel = (
    <MailCredentialsGate
      ui={ui}
      requiresRelogin={mailRequiresRelogin}
      canSaveForAllDevices={canSaveMailForAllDevices}
      reason={mailCredentialsReason}
      login={mailCredentialsLogin || mailboxInfo?.effective_mailbox_login}
      email={mailCredentialsEmail || mailboxInfo?.mailbox_email}
      onEnterPassword={() => openMailCredentialsDialog(mailboxInfo, { reason: canSaveMailForAllDevices ? 'shared' : 'missing' })}
    />
  );
  const hasHydratedMailScreen = Boolean(
    mailboxInfo
    || (Array.isArray(folderTree) && folderTree.length > 0)
    || (Array.isArray(listData?.items) && listData.items.length > 0)
  );
  // Password / relogin gate only after bootstrap/config finished — never flash it while checking.
  const showMailCredentialsGate = Boolean(
    !mailConfigLoading
    && (mailRequiresPassword || mailRequiresRelogin)
  );
  const showRecentMailFallback = Boolean(
    !showMailCredentialsGate
    && hasHydratedMailScreen
    && (
      mailConfigLoading
      || !mailboxInfo
      || recentHydratedScope === mailCacheScope
      || recentHydratedScope === initialMailCacheScope
    )
  );
  const canRenderMailArea = Boolean(
    !showMailCredentialsGate
    && (mailAccessReady || showRecentMailFallback)
  );
  const showInitialMailLoading = Boolean(
    !showMailCredentialsGate
    && !canRenderMailArea
    && (mailConfigLoading || loading)
  );
  const showSearchToolbar = (!isMobile || !hasMobileSelection) && !showInitialMailLoading;
  const showPageChrome = !isMobileFullscreenPreview;
  const mailToolbar = showPageChrome && showSearchToolbar ? (
    <MailToolbar
      activeMailbox={mailboxInfo}
      mailboxes={mailboxes}
      onOpenMailboxList={handleOpenMailboxList}
      onSelectMailbox={handleSelectMailbox}
      onManageMailboxes={handleManageMailboxes}
      search={search}
      onSearchChange={setSearch}
      onRefresh={handleRefreshMailView}
      onCompose={openCompose}
      onOpenAdvancedSearch={handleOpenAdvancedSearch}
      onOpenToolsMenu={(event) => setToolsAnchorEl(event.currentTarget)}
      onOpenNavigation={() => setMobileNavigationOpen(true)}
      storageActive={showQuotasSection}
      onOpenStorage={canQuotasRead ? () => handleMailShellSectionChange('quotas') : undefined}
      onBackFromStorage={() => handleMailShellSectionChange('inbox')}
      onOpenSignatures={openSignatureEditor}
      onOpenMailSettings={openMailPreferencesDialog}
      canOpenStorage={canQuotasRead}
      hasActiveFilters={hasActiveFilters}
      mobile={isMobile}
      embedded={!isMobile}
      showNavigationButton={hideDesktopFolderColumn}
      loading={loading}
      refreshTooltip={mailBackgroundRefreshing
        ? 'Обновляем...'
        : (formatMailSyncedAt(mailLastSyncedAt) || 'Обновить')}
      searchInputRef={searchInputRef}
    />
  ) : null;

  return (
    <MainLayout
      contentMode={isMobile ? 'edge-to-edge-mobile' : 'edge-to-edge'}
      mobileBottomNavMode={isMobileFullscreenPreview ? 'hidden' : 'auto'}
      headerInlineContent={!isMobile ? mailToolbar : null}
    >
      <PageShell
        fullHeight={!isMobile}
        sx={{
          ...getMailUiFontScopeSx(),
          flex: '1 1 0%',
          height: isMobile ? 0 : '100%',
          gap: 0,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
          bgcolor: isMobileFullscreenPreview ? ui.panelBg : 'transparent',
          '--mail-shell-bg': ui.shellBg,
          '--mail-panel-bg': ui.panelBg,
          '--mail-panel-solid': ui.panelSolid,
          '--mail-divider': ui.borderSoft,
          '--mail-radius-sm': ui.radiusSm,
          '--mail-radius-md': ui.radiusMd,
          '--mail-radius-lg': ui.radiusLg,
        }}
      >
        {showPageChrome && error ? <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: ui.radiusMd, mb: 1 }}>{error}</Alert> : null}
        {showPageChrome && showSaveMailForAllDevicesBanner ? (
          <Alert
            severity="info"
            sx={{ borderRadius: ui.radiusMd, mb: 1, alignItems: 'center' }}
            action={(
              <Button
                color="inherit"
                size="small"
                onClick={() => openMailCredentialsDialog(mailboxInfo, { reason: 'shared' })}
              >
                Сохранить пароль для всех устройств
              </Button>
            )}
          >
            Почта сейчас открыта через текущую веб-сессию. Если сохранить корпоративный пароль в профиле, этот ящик будет работать на всех ваших устройствах.
          </Alert>
        ) : null}
        {isMobile ? mailToolbar : null}

        {(isMobile || hideDesktopFolderColumn) ? (
        <Drawer
          anchor="left"
          open={mobileNavigationOpen}
          onClose={() => setMobileNavigationOpen(false)}
          ModalProps={{ keepMounted: true }}
          PaperProps={{
            'data-testid': 'mail-mobile-navigation-drawer',
            sx: {
              width: { xs: '80vw', sm: 360 },
              maxWidth: { xs: '80vw', sm: 360 },
              p: 0,
              bgcolor: ui.panelBg,
              backgroundImage: 'none',
              overflow: 'hidden',
            },
          }}
        >
          <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <Box
              sx={{
                px: 1.2,
                py: 1.1,
                borderBottom: '1px solid',
                borderColor: ui.borderSoft,
                bgcolor: ui.panelBg,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    Навигация
                  </Typography>
                </Box>
                <IconButton
                  size="small"
                  aria-label="Закрыть навигацию"
                  data-testid="mail-mobile-navigation-close"
                  onClick={() => setMobileNavigationOpen(false)}
                  sx={{
                    width: 34,
                    height: 34,
                    borderRadius: ui.iconButtonRadius,
                  }}
                >
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap sx={{ mt: 0.9 }}>
                {currentFolderLabel ? (
                  <Chip
                    size="small"
                    label={currentFolderLabel}
                    sx={{
                      maxWidth: '100%',
                      '& .MuiChip-label': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      },
                    }}
                  />
                ) : null}
                {hasActiveFilters ? <Chip size="small" color="primary" variant="outlined" label="Есть фильтры" /> : null}
              </Stack>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, p: 1, pb: 'calc(8px + env(safe-area-inset-bottom, 0px))' }}>
              {renderFolderRail}
            </Box>
          </Box>
        </Drawer>
        ) : null}

        <MailToolsMenu
          anchorEl={toolsAnchorEl}
          open={Boolean(toolsAnchorEl)}
          onClose={() => setToolsAnchorEl(null)}
          onOpenViewSettings={openMailPreferencesDialog}
          onMarkAllRead={handleMarkAllRead}
          mobile={isMobile}
        />

        {showQuotasSection ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Box
              className="mail-safe-top"
              data-testid="mail-quotas-section-header"
              sx={{
                px: 1.25,
                py: 0.7,
                bgcolor: ui.panelBg,
                borderBottom: '1px solid',
                borderColor: ui.borderSoft,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
              }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: '0.95rem' }}>Хранилище</Typography>
              <Button
                variant="contained"
                color="primary"
                startIcon={<ArrowBackRoundedIcon />}
                onClick={() => handleMailShellSectionChange('inbox')}
                data-testid="mail-quotas-back-to-mail"
                aria-label="К письмам"
                sx={{
                  minHeight: 36,
                  px: 1.5,
                  flexShrink: 0,
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: ui.radiusSm || '8px',
                  boxShadow: 'none',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  whiteSpace: 'nowrap',
                  '&:hover': { bgcolor: 'primary.dark', boxShadow: 'none' },
                }}
              >
                К письмам
              </Button>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: { xs: 0.5, md: 1 } }}>
              <MailQuotaReport isMobile={isMobile} />
            </Box>
          </Box>
        ) : showMailCredentialsGate ? (
          mailCredentialsPanel
        ) : canRenderMailArea ? (
          mainMailArea
        ) : (
          <MailInitialLoadingState ui={ui} />
        )}

        <Drawer
          anchor="right"
          open={!isMobile && readingPaneMode === 'off' && Boolean(selectedMessage)}
          onClose={() => clearSelection({ mode: viewMode })}
          PaperProps={{ sx: { width: { xs: '100vw', sm: 720, lg: 840 }, maxWidth: '100vw' } }}
        >
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {previewContent}
          </Box>
        </Drawer>

        {advancedSearchOpen ? (
          <Suspense fallback={null}>
            <MailAdvancedSearchDialog
              open={advancedSearchOpen}
              filters={advancedFiltersDraft}
              recentSearches={recentSearches}
              onClose={() => setAdvancedSearchOpen(false)}
              onChange={(key, value) => setAdvancedFiltersDraft((prev) => ({ ...(prev || {}), [key]: value }))}
              onApply={handleApplyAdvancedSearch}
              onReset={handleResetAdvancedSearch}
              onApplyRecent={handleApplyRecentSearch}
            />
          </Suspense>
        ) : null}

        <MailShortcutHelpDialog
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />

        <MailViewSettingsDialog
          open={mailPreferencesOpen}
          value={mailPreferencesDraft}
          saving={mailPreferencesSaving}
          mobileHint={isMobile}
          aiEnabled={mailAiEnabled}
          onAiEnabledChange={handleMailAiEnabledChange}
          onClose={closeMailPreferencesDialog}
          onChange={updateMailPreferencesDraft}
          onSave={handleSaveMailPreferences}
        />

        <MailAiConsentDialog
          open={mailAiConsentOpen}
          onClose={closeMailAiConsentDialog}
          onConfirm={confirmMailAiConsent}
        />

        {headersOpen ? (
          <Suspense fallback={null}>
            <MailHeadersDialog
              open={headersOpen}
              onClose={closeHeadersDialog}
              headers={headersForDialog}
            />
          </Suspense>
        ) : null}

        <Dialog open={folderDialogOpen} onClose={closeFolderDialog} maxWidth="xs" fullWidth PaperProps={{ sx: getMailDialogPaperSx(ui) }}>
          <DialogTitle sx={getMailDialogTitleSx(ui)}>{folderDialogMode === 'rename' ? 'Переименовать папку' : 'Новая папка'}</DialogTitle>
          <DialogContent dividers sx={getMailDialogContentSx(ui)}>
            <Stack spacing={1.2} sx={{ mt: 0.5 }}>
              {folderDialogMode === 'create' && folderDialogTarget ? (
                <Alert severity="info" sx={{ borderRadius: ui.radiusMd }}>
                  {`Родительская папка: ${folderDialogTarget.label || folderDialogTarget.name || '-'}`}
                </Alert>
              ) : null}
              <TextField
                size="small"
                label="Название папки"
                value={folderDialogName}
                onChange={(event) => setFolderDialogName(event.target.value)}
                fullWidth
                autoFocus
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={getMailDialogActionsSx(ui)}>
            <Button onClick={closeFolderDialog}>Отмена</Button>
            <Button variant="contained" onClick={handleSubmitFolderDialog} disabled={folderDialogSaving}>
              {folderDialogSaving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogActions>
        </Dialog>

        <MailCredentialsDialog
          open={mailCredentialsOpen}
          reason={mailCredentialsReason}
          ui={ui}
          login={mailCredentialsLogin}
          email={mailCredentialsEmail}
          password={mailCredentialsPassword}
          error={mailCredentialsError}
          saving={mailCredentialsSaving}
          loginPlaceholder={mailboxInfo?.effective_mailbox_login}
          emailPlaceholder={mailboxInfo?.mailbox_email}
          onLoginChange={setMailCredentialsLogin}
          onEmailChange={setMailCredentialsEmail}
          onPasswordChange={setMailCredentialsPassword}
          onSave={handleSaveMailCredentials}
        />

        {attachmentPreview?.open ? (
          <Suspense fallback={null}>
            <MailAttachmentPreviewDialog
              attachmentPreview={attachmentPreview}
              onClose={closeAttachmentPreview}
              onDownload={downloadAttachmentPreview}
              onDownloadPreviewPdf={downloadAttachmentPreviewPdf}
              formatFileSize={formatFileSize}
              maxPreviewFileBytes={maxPreviewFileBytes}
            />
          </Suspense>
        ) : null}

        {signatureOpen ? (
          <Suspense fallback={null}>
            <MailSignatureDialog
              open={signatureOpen}
              onClose={closeSignatureEditor}
              signatureHtml={signatureHtml}
              onSignatureChange={setSignatureHtml}
              signatureSaving={signatureSaving}
              onClear={clearSignature}
              onSave={handleSaveSignature}
            />
          </Suspense>
        ) : null}

        {composeOpen && isMobile ? (
          <Suspense fallback={null}>
            <MailComposeHost
              session={composeSession}
              layoutMode="mobile"
              activeMailboxId={activeMailboxId}
              composeFromOptions={composeFromOptions}
              composeDraftKey={composeDraftKey}
              resolveComposeMailboxId={resolveComposeMailboxId}
              mailboxPrimaryDomain={mailboxPrimaryDomain}
              mailboxSignatureHtml={mailboxInfo?.mail_signature_html}
              signatureOpen={signatureOpen}
              signatureHtml={signatureHtml}
              signatureMailboxId={signatureMailboxId}
              formatFullDate={formatFullDate}
              formatFileSize={formatFileSize}
              sumFilesSize={sumFilesSize}
              sumAttachmentSize={sumAttachmentSize}
              onOpenSignatureEditor={openSignatureEditor}
              onCloseSession={closeComposeSession}
              onRegisterCloseHandler={(handler) => { composeCloseRequestRef.current = handler; }}
              onSendSuccess={handleComposeSent}
              onDraftSaved={handleComposeDraftSaved}
              onComposeWarning={notifyMailComposeWarning}
              handleMailCredentialsRequired={handleMailCredentialsRequired}
              getMailErrorDetail={getMailErrorDetail}
            />
          </Suspense>
        ) : null}

        <MailItRequestDialog
          open={itOpen}
          ui={ui}
          templates={templates}
          templateId={itTemplateId}
          fieldValues={itFieldValues}
          activeTemplate={activeTemplate}
          sending={itSending}
          onClose={closeItRequest}
          onClear={clearItRequest}
          onTemplateChange={selectItTemplate}
          onFieldValueChange={updateItFieldValue}
          onSubmit={submitItRequest}
        />

        {templatesOpen ? (
          <Suspense fallback={null}>
            <MailTemplatesDialog {...templateDialogProps} />
          </Suspense>
        ) : null}
      </PageShell>
    </MainLayout>
  );
}

export default Mail;
