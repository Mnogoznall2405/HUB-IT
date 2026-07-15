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
  Paper,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Suspense, lazy } from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import InboxIcon from '@mui/icons-material/Inbox';
import SendIcon from '@mui/icons-material/Send';
import FolderIcon from '@mui/icons-material/Folder';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
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
  invalidateSWRCacheByPrefix,
  peekSWRCache,
  setSWRCache,
} from '../lib/swrCache';
import {
  clearMailRecentCacheForScope,
  getMailRecentHydration,
} from '../lib/mailRecentCache';
import MailBulkActionBar from '../components/mail/MailBulkActionBar';
import MailConversationReader from '../components/mail/MailConversationReader';
import MailFolderRail from '../components/mail/MailFolderRail';
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
import MailSectionTabs from '../components/mail/MailSectionTabs';
import MailToolsMenu from '../components/mail/MailToolsMenu';
import MailViewSettingsDialog from '../components/mail/MailViewSettingsDialog';
import MailComposeHost, { loadMailComposeDialog } from '../components/mail/MailComposeHost';
import MailItRequestDialog from '../components/mail/MailItRequestDialog';
import useMailMobileShell from '../components/mail/useMailMobileShell';
import useMailAdvancedSearch, { DEFAULT_ADVANCED_FILTERS } from '../components/mail/useMailAdvancedSearch';
import useMailBulkActions from '../components/mail/useMailBulkActions';
import useMailFolderMutations from '../components/mail/useMailFolderMutations';
import useMailItRequest from '../components/mail/useMailItRequest';
import useMailAsyncTaskGate from '../components/mail/useMailAsyncTaskGate';
import useMailAutoReadGuard from '../components/mail/useMailAutoReadGuard';
import useMailListDataController from '../components/mail/useMailListDataController';
import useMailListItemActions from '../components/mail/useMailListItemActions';
import useMailMailboxUnreadCounts from '../components/mail/useMailMailboxUnreadCounts';
import useMailMessageFileActions from '../components/mail/useMailMessageFileActions';
import useMailMessageRenderState from '../components/mail/useMailMessageRenderState';
import useMailQuickReply from '../components/mail/useMailQuickReply';
import useMailMessageAi from '../components/mail/useMailMessageAi';
import useMailReadMutations from '../components/mail/useMailReadMutations';
import useMailRecentSnapshots from '../components/mail/useMailRecentSnapshots';
import useMailRemoteImages from '../components/mail/useMailRemoteImages';
import useMailSelectedDetailLifecycle from '../components/mail/useMailSelectedDetailLifecycle';
import useMailSelectedDetailState from '../components/mail/useMailSelectedDetailState';
import useMailSelectedPreviewActions from '../components/mail/useMailSelectedPreviewActions';
import useMailSignatureSettings from '../components/mail/useMailSignatureSettings';
import useMailTemplateEditor from '../components/mail/useMailTemplateEditor';
import {
  getMailErrorCode as resolveMailErrorCode,
  getMailErrorDetail as resolveMailErrorDetail,
  getMailErrorDetailAsync as resolveMailErrorDetailAsync,
  isMissingMailDetailError as resolveIsMissingMailDetailError,
  isTransientMailRequestError as resolveIsTransientMailRequestError,
} from '../components/mail/mailErrorModel';
import {
  buildMailFolderSummaryCacheKey,
  buildMailFolderTreeCacheKey,
  buildMailListCacheKey,
  buildMailListRequestContext,
  createEmptyListData,
  normalizeMailListResponse,
} from '../components/mail/mailListModel';
import { formatMailListDateLabel } from '../components/mail/mailDateGrouping';
import {
  buildMailRoute,
  normalizeMailFolder,
  normalizeMailListViewContextState,
  normalizeMailViewMode,
  readStoredMailListViewState,
  readStoredMailViewState,
  writeStoredMailListViewState,
  writeStoredMailViewState,
} from '../components/mail/mailViewStateModel';
import {
  buildFallbackMailboxEntry,
  getMailboxEntryId,
  mergeMailboxEntries,
  normalizeMailboxId,
  readStoredSelectedMailboxId,
  resolveComposeMailboxId as resolveMailboxComposeMailboxId,
  resolveItemMailboxId as resolveMailboxItemMailboxId,
  withMailboxParams,
  withMailboxPayload,
  writeStoredSelectedMailboxId,
} from '../components/mail/mailMailboxModel';
import {
  buildMailDetailCacheKey,
  createSelectedMessagePreviewShell,
} from '../components/mail/mailDetailModel';
import {
  applyReadStateOverridesToConversationDetail,
  applyReadStateOverridesToListData,
  applyReadStateOverridesToMessageDetail,
  pruneLocalReadStateOverrides,
} from '../components/mail/mailReadStateModel';
import { normalizeComposeSubject } from '../components/mail/mailComposeSubject';
import {
  createComposeInitialState,
  isValidEmailRecipient,
  normalizeMailRecipient,
  readStoredComposeState,
} from '../components/mail/mailComposeState';
import {
  buildMailUiTokens,
  getMailMobileFabBottomOffset,
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
  getMailUiFontScopeSx,
} from '../components/mail/mailUiTokens';
import { getMailPersonDisplay, getMailPersonEmail } from '../components/mail/mailPeople';
import { splitQuotedHistoryHtml } from '../components/mail/mailQuotedHistory';
import {
  MAIL_PANE_DEFAULTS,
  MAIL_PANE_LIMITS,
  clampMailPaneSize,
  getMailPaneCssValue,
  getMailPaneSizes,
} from '../components/mail/mailPaneLayout';

const MAIL_SHELL_SECTION_KEY = 'mail_shell_section';
const MAIL_COMPUTER_PASSWORD_LABEL = 'Пароль от корпоративного компьютера';
const MAIL_COMPUTER_PASSWORD_HELPER = 'Тот же пароль, что при входе в Windows на рабочем ПК';
const MAIL_COMPUTER_PASSWORD_HINT = 'Это пароль, который вы вводите при входе в корпоративный компьютер (Windows). Не пароль от HUB-IT и не отдельный пароль «только для почты».';

function readStoredMailShellSection() {
  try {
    const value = String(sessionStorage.getItem(MAIL_SHELL_SECTION_KEY) || '').trim();
    return value === 'quotas' ? 'quotas' : 'inbox';
  } catch {
    return 'inbox';
  }
}

function writeStoredMailShellSection(section) {
  try {
    sessionStorage.setItem(MAIL_SHELL_SECTION_KEY, section === 'quotas' ? 'quotas' : 'inbox');
  } catch {
    // ignore storage errors
  }
}

const MailAttachmentPreviewDialog = lazy(() => import('../components/mail/MailAttachmentPreviewDialog'));
const MailAdvancedSearchDialog = lazy(() => import('../components/mail/MailAdvancedSearchDialog'));
const MailHeadersDialog = lazy(() => import('../components/mail/MailHeadersDialog'));
const MailSignatureDialog = lazy(() => import('../components/mail/MailSignatureDialog'));
const MailTemplatesDialog = lazy(() => import('../components/mail/MailTemplatesDialog'));

const MAIL_ACTIVE_REFRESH_INTERVAL_MS = 90000;
const MAIL_VIEW_REFRESH_COOLDOWN_MS = 4000;
const MAIL_SWR_STALE_TIME_MS = 45000;
const MAIL_DETAIL_SWR_STALE_TIME_MS = 10 * 60 * 1000;
const MAIL_FOLDER_SUMMARY_REFRESH_COOLDOWN_MS = 120000;
const MAIL_AUTO_READ_GUARD_TTL_MS = 120000;
const MAIL_DETAIL_PREFETCH_LIMIT = 2;
const MAIL_DETAIL_PREFETCH_COOLDOWN_MS = 600000;
const MAIL_RENDERED_CONTENT_LAYOUT_SX = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  overflowX: 'hidden',
  boxSizing: 'border-box',
  '& div:not([data-mail-table-scroll="true"]), & section, & article, & main, & header, & footer, & p, & blockquote, & center, & ul, & ol, & li': {
    maxWidth: '100% !important',
    minWidth: '0 !important',
    boxSizing: 'border-box',
  },
  '& [data-mail-table-scroll="true"]': {
    width: '100%',
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
    WebkitOverflowScrolling: 'touch',
    boxSizing: 'border-box',
  },
};
const getMailRenderedContentSx = ({ ui, theme, variant = 'message', mine = false, quoted = false } = {}) => {
  const isConversation = variant === 'conversation';
  const isDark = Boolean(ui?.isDark);
  const inheritedText = mine
    ? (isDark ? alpha(theme.palette.common.white, 0.96) : theme.palette.text.primary)
    : (quoted ? ui?.textSecondary : ui?.textPrimary);
  const linkColor = mine
    ? (isDark ? '#dbeafe' : theme.palette.primary.main)
    : (isDark ? '#8cc8ff' : theme.palette.primary.main);
  const placeholderBorder = mine
    ? alpha(theme.palette.common.white, 0.35)
    : ui?.borderSoft;
  const placeholderBg = mine
    ? alpha(theme.palette.common.white, 0.08)
    : ui?.actionBg;
  const placeholderText = mine
    ? alpha(theme.palette.common.white, 0.88)
    : ui?.textSecondary;

  return {
    ...MAIL_RENDERED_CONTENT_LAYOUT_SX,
    ...(isConversation ? { mt: 0.55 } : {}),
    ...(quoted ? {
      mt: 1.1,
      pt: 1.1,
      borderTop: '1px solid',
      borderColor: ui?.borderSoft,
    } : {}),
    color: inheritedText,
    fontFamily: 'var(--mail-message-font)',
    fontSize: isConversation ? '0.92rem' : (quoted ? '0.94rem' : '1rem'),
    lineHeight: isConversation ? 1.54 : (quoted ? 1.6 : 1.65),
    ...(isDark ? {
      '& p': { m: 0 },
      '& p + p': { mt: isConversation ? '0.45em' : '0.76em' },
      '& a': {
        color: linkColor,
        textDecorationColor: alpha(linkColor, 0.52),
      },
      '& blockquote': {
        m: isConversation ? '0.65em 0 0 0' : '0.8em 0 0 0',
        pl: isConversation ? 1 : 1.4,
        py: isConversation ? 0 : 0.2,
        borderLeft: '3px solid',
        borderColor: placeholderBorder,
        color: mine ? alpha(theme.palette.common.white, 0.88) : ui?.textSecondary,
        fontSize: isConversation ? undefined : (quoted ? '0.88rem' : '0.9rem'),
      },
    } : {}),
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    '& img': {
      maxWidth: '100% !important',
      height: 'auto !important',
      objectFit: 'contain',
    },
    '& video, & iframe': {
      maxWidth: '100% !important',
      height: 'auto !important',
    },
    '& table': {
      maxWidth: '100%',
      borderCollapse: 'collapse',
    },
    '& [data-mail-table-scroll="true"]': {
      maxWidth: '100%',
      overflowX: 'auto',
      overflowY: 'hidden',
      WebkitOverflowScrolling: 'touch',
    },
    '& pre': {
      fontFamily: 'var(--mail-mono-font)',
      fontSize: isConversation ? '0.82rem' : '0.9rem',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
      ...(isDark && !isConversation ? {
        p: 1,
        borderRadius: '8px',
        bgcolor: ui?.actionBg,
      } : {}),
    },
    '& .mail-image-placeholder': {
      ...(isConversation ? { mt: 0.45 } : {}),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: isConversation ? 112 : 132,
      px: isConversation ? 1.2 : 1.4,
      py: isConversation ? 1.1 : 1.2,
      borderRadius: isConversation ? '8px' : '10px',
      border: '1px dashed',
      borderColor: placeholderBorder,
      bgcolor: placeholderBg,
      color: placeholderText,
      fontFamily: 'var(--mail-ui-font)',
      fontSize: isConversation ? '0.8rem' : '0.88rem',
      textAlign: 'center',
    },
  };
};
const COMPOSE_DRAFT_STORAGE_KEY = 'mail_compose_draft_v2';
const MAIL_BOOTSTRAP_LIMIT = 20;
const MAIL_STANDARD_PREFETCH_FOLDERS = ['inbox'];

const FOLDER_LABELS = {
  inbox: 'Входящие',
  sent: 'Отправленные',
  drafts: 'Черновики',
  trash: 'Удаленные',
  junk: 'Нежелательные',
  archive: 'Архив',
};

const FOLDER_ICONS = {
  inbox: <InboxIcon fontSize="small" />,
  sent: <SendIcon fontSize="small" />,
  drafts: <FolderIcon fontSize="small" />,
  trash: <DeleteOutlineIcon fontSize="small" />,
};

const DEFAULT_MAIL_PREFERENCES = {
  reading_pane: 'right',
  density: 'compact',
  show_preview_snippets: true,
  show_favorites_first: true,
  ...MAIL_PANE_DEFAULTS,
};

const formatTime = (isoStr) => {
  return formatMailListDateLabel(isoStr);
};

const formatFullDate = (isoStr) => {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatFileSize = (bytes) => {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : (size >= 10 ? 0 : 1))} ${units[unitIndex]}`;
};

const sumFilesSize = (files) => (Array.isArray(files) ? files.reduce((acc, file) => acc + Number(file?.size || 0), 0) : 0);
const sumAttachmentSize = (attachments) => (Array.isArray(attachments) ? attachments.reduce((acc, item) => acc + Number(item?.size || 0), 0) : 0);

const getInitials = (email) => {
  const source = String(email || '');
  if (!source) return '?';
  const name = source.split('@')[0] || '';
  const parts = name.split(/[._-]/);
  if (parts.length >= 2) return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
};

const getAvatarColor = (email) => {
  const colors = ['#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#f57c00', '#0097a7', '#5d4037', '#455a64'];
  const text = String(email || '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) hash = text.charCodeAt(index) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const buildSenderPerson = (value) => (
  value?.sender_person || {
    display: value?.sender_display,
    name: value?.sender_name,
    email: value?.sender_email,
  }
);

const getSenderDisplay = (value, fallback = '-') => (
  getMailPersonDisplay(buildSenderPerson(value), String(value?.sender || fallback || '-'))
);

const getSenderEmail = (value) => (
  getMailPersonEmail(buildSenderPerson(value))
  || normalizeMailRecipient(value?.sender || '')
);

function Mail() {
  const theme = useTheme();
  const ui = useMemo(() => buildMailUiTokens(theme), [theme]);
  const mailRenderColorScheme = ui.isDark ? 'dark' : 'light';
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, user } = useAuth();
  const { notifySuccess, notifyInfo, notifyWarning } = useNotification();
  const notifyMailSuccess = useCallback((value, options = {}) => {
    const text = String(value || '').trim();
    if (!text) return;
    notifySuccess(text, { source: 'mail', dedupeMode: 'none', ...options });
  }, [notifySuccess]);
  const notifyMailInfo = useCallback((value, options = {}) => {
    const text = String(value || '').trim();
    if (!text) return;
    notifyInfo(text, { source: 'mail', dedupeMode: 'recent', ...options });
  }, [notifyInfo]);
  const notifyMailComposeWarning = useCallback((warning) => {
    const message = String(warning?.message || '').trim();
    if (!message) return;
    const severity = String(warning?.severity || 'warning');
    const notify = severity === 'info' ? notifyInfo : notifyWarning;
    notify(message, {
      source: warning?.source || 'mail-compose',
      title: String(warning?.title || (severity === 'info' ? 'Информация' : 'Предупреждение')).trim(),
      dedupeMode: 'recent',
      dedupeKey: warning?.dedupeKey || `mail-compose:${String(warning?.id || message)}`,
      durationMs: Number(warning?.durationMs || 4500),
    });
  }, [notifyInfo, notifyWarning]);
  const initialRouteMailboxId = useMemo(
    () => normalizeMailboxId(new URLSearchParams(location.search || '').get('mailbox_id')),
    [location.search]
  );
  const initialStoredMailboxId = useMemo(
    () => (initialRouteMailboxId ? '' : readStoredSelectedMailboxId()),
    [initialRouteMailboxId]
  );
  const initialSelectedMailboxId = initialRouteMailboxId || initialStoredMailboxId;
  const initialMailViewState = useMemo(
    () => readStoredMailViewState(initialSelectedMailboxId, { defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS }),
    [initialSelectedMailboxId],
  );
  const initialMailCacheScope = useMemo(
    () => initialSelectedMailboxId || String(user?.id || 'anonymous'),
    [initialSelectedMailboxId, user?.id]
  );
  const initialMailRecentContextKey = useMemo(() => buildMailListRequestContext({
    scope: initialMailCacheScope,
    folder: initialMailViewState.folder,
    viewMode: initialMailViewState.viewMode,
    search: initialMailViewState.search,
    unreadOnly: initialMailViewState.unreadOnly,
    hasAttachmentsOnly: initialMailViewState.hasAttachmentsOnly,
    dateFrom: initialMailViewState.filterDateFrom,
    dateTo: initialMailViewState.filterDateTo,
    advancedFilters: initialMailViewState?.advancedFiltersApplied,
    limit: 50,
    offset: 0,
  }).contextKey, [initialMailCacheScope, initialMailViewState]);
  const initialMailRecentHydration = useMemo(
    () => getMailRecentHydration({ scope: initialMailCacheScope, contextKey: initialMailRecentContextKey }),
    [initialMailCacheScope, initialMailRecentContextKey]
  );
  const canManageUsers = hasPermission('settings.users.manage');
  const canQuotasRead = hasPermission('mail.quotas.read');
  const [mailShellSection, setMailShellSection] = useState(() => readStoredMailShellSection());
  const handleMailShellSectionChange = useCallback((section) => {
    const next = section === 'quotas' ? 'quotas' : 'inbox';
    setMailShellSection(next);
    writeStoredMailShellSection(next);
  }, []);

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
  const [mailCredentialsOpen, setMailCredentialsOpen] = useState(false);
  const [mailCredentialsSaving, setMailCredentialsSaving] = useState(false);
  const [mailCredentialsError, setMailCredentialsError] = useState('');
  const [mailCredentialsReason, setMailCredentialsReason] = useState('missing');
  const [mailCredentialsLogin, setMailCredentialsLogin] = useState('');
  const [mailCredentialsPassword, setMailCredentialsPassword] = useState('');
  const [mailCredentialsEmail, setMailCredentialsEmail] = useState('');
  const [folderSummary, setFolderSummary] = useState(() => initialMailRecentHydration?.folderSummary || {});
  const [folderTree, setFolderTree] = useState(() => initialMailRecentHydration?.folderTree || []);
  const [mailPreferences, setMailPreferences] = useState(DEFAULT_MAIL_PREFERENCES);
  const [mailPreferencesDraft, setMailPreferencesDraft] = useState(DEFAULT_MAIL_PREFERENCES);
  const [mailPreferencesOpen, setMailPreferencesOpen] = useState(false);
  const [mailPreferencesSaving, setMailPreferencesSaving] = useState(false);
  const [listData, setListData] = useState(() => (
    initialMailRecentHydration?.listData
      ? normalizeMailListResponse(initialMailRecentHydration.listData)
      : createEmptyListData()
  ));
  const [recentHydratedScope, setRecentHydratedScope] = useState(initialMailRecentHydration ? initialMailCacheScope : '');
  const [mailBackgroundRefreshing, setMailBackgroundRefreshing] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => (
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  ));
  const [selectedItems, setSelectedItems] = useState([]);
  const [moveTarget, setMoveTarget] = useState('');
  const queueListScrollRestoreRef = useRef(null);
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

  const [composeSession, setComposeSession] = useState(null);

  const {
    revealedRemoteImagesByMessageId,
    revealRemoteImagesForMessage,
  } = useMailRemoteImages();

  const composeOpen = Boolean(composeSession);

  const messageListRef = useRef(null);
  const desktopMailAreaRef = useRef(null);
  const mailPaneSaveChainRef = useRef(Promise.resolve());
  const loadMoreSentinelRef = useRef(null);
  const conversationScrollRef = useRef(null);
  const searchInputRef = useRef(null);
  const composeSessionCounterRef = useRef(0);
  const composeCloseRequestRef = useRef(null);
  const listDataRef = useRef(listData);
  const viewModeRef = useRef(viewMode);
  const folderSummaryRef = useRef(folderSummary);
  const folderTreeRef = useRef(folderTree);
  const mailboxesRef = useRef(mailboxes);
  const deepLinkKeyRef = useRef('');
  const localReadStateOverridesRef = useRef(new Map());
  const detailPrefetchInFlightRef = useRef(new Set());
  const detailPrefetchCompletedAtRef = useRef(new Map());
  const skipNextListRefreshRef = useRef(false);
  const prefetchedListContextsRef = useRef(new Set());
  const prefetchedDetailListSignaturesRef = useRef(new Set());
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
  useEffect(() => {
    if (activeMailboxId) {
      writeStoredSelectedMailboxId(activeMailboxId);
    }
  }, [activeMailboxId]);
  const {
    begin: beginAutoReadGuard,
    settle: settleAutoReadGuard,
  } = useMailAutoReadGuard({ ttlMs: MAIL_AUTO_READ_GUARD_TTL_MS });
  const {
    run: runMailViewRefreshGate,
  } = useMailAsyncTaskGate({ cooldownMs: MAIL_VIEW_REFRESH_COOLDOWN_MS });
  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;
    let idleId = null;

    const preloadComposeDialog = () => {
      if (cancelled) {
        return;
      }
      loadMailComposeDialog().catch(() => {});
    };

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(preloadComposeDialog, { timeout: 1500 });
    } else if (typeof window !== 'undefined') {
      timeoutId = window.setTimeout(preloadComposeDialog, 1200);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);
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
  const mailboxEmails = useMemo(() => {
    const values = [mailboxInfo?.mailbox_email, mailboxInfo?.mailbox_login, mailboxInfo?.effective_mailbox_login];
    const set = new Set();
    values.forEach((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) set.add(normalized);
    });
    return set;
  }, [mailboxInfo?.effective_mailbox_login, mailboxInfo?.mailbox_email, mailboxInfo?.mailbox_login]);
  const mailRequiresRelogin = Boolean(mailboxInfo?.mail_requires_relogin);
  const mailRequiresPassword = Boolean(
    mailboxInfo
    && mailboxInfo?.mail_auth_mode !== 'ad_auto'
    && (
      mailboxInfo?.mail_requires_password
      || mailboxInfo.mail_is_configured === false
    )
  );
  const mailAccessReady = Boolean(mailboxInfo && !mailRequiresPassword && !mailRequiresRelogin);
  const mailboxUsesPrimaryCredentials = String(mailboxInfo?.auth_mode || '').trim().toLowerCase() === 'primary_credentials';
  const canSaveMailForAllDevices = Boolean(
    mailboxInfo
    && String(mailboxInfo?.auth_mode || '').trim().toLowerCase() === 'primary_session'
    && (
      mailboxInfo?.mailbox_email
      || mailboxInfo?.effective_mailbox_login
      || mailboxInfo?.mailbox_login
    )
  );
  const showSaveMailForAllDevicesBanner = Boolean(canSaveMailForAllDevices && mailAccessReady);
  const activeMailboxes = useMemo(
    () => (Array.isArray(mailboxes) ? mailboxes.filter((item) => item?.is_active !== false) : []),
    [mailboxes]
  );
  const composeFromOptions = useMemo(() => {
    if (activeMailboxes.length > 0) return activeMailboxes;
    const fallback = buildFallbackMailboxEntry(mailboxInfo);
    return fallback ? [fallback] : [];
  }, [activeMailboxes, mailboxInfo]);
  const {
    refreshMailboxUnreadCounts,
    handleOpenMailboxList,
  } = useMailMailboxUnreadCounts({
    mailAPI,
    mailboxes,
    activeMailboxId,
    setMailboxes,
  });
  const withActiveMailboxParams = useCallback((params = {}) => withMailboxParams(activeMailboxId, params), [activeMailboxId]);
  const withActiveMailboxPayload = useCallback((payload = {}) => withMailboxPayload(activeMailboxId, payload), [activeMailboxId]);
  const resolveItemMailboxId = useCallback((item) => (
    resolveMailboxItemMailboxId({ item, activeMailboxId })
  ), [activeMailboxId]);
  const resolveComposeMailboxId = useCallback((candidate = '') => {
    return resolveMailboxComposeMailboxId({ candidate, activeMailboxId, composeFromOptions });
  }, [activeMailboxId, composeFromOptions]);
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

  const getMailErrorDetail = useCallback(resolveMailErrorDetail, []);
  const getMailErrorDetailAsync = useCallback(resolveMailErrorDetailAsync, []);
  const isMissingMailDetailError = useCallback(resolveIsMissingMailDetailError, []);
  const getMailErrorCode = useCallback(resolveMailErrorCode, []);
  const isTransientMailRequestError = useCallback(resolveIsTransientMailRequestError, []);

  const openMailCredentialsDialog = useCallback((config, { reason = 'missing', errorText = '' } = {}) => {
    const nextLogin = String(
      config?.mailbox_login
      || config?.effective_mailbox_login
      || mailboxInfo?.mailbox_login
      || mailboxInfo?.effective_mailbox_login
      || ''
    ).trim();
    const nextEmail = String(config?.mailbox_email || mailboxInfo?.mailbox_email || '').trim();
    setMailCredentialsReason(reason);
    setMailCredentialsError(String(errorText || '').trim());
    setMailCredentialsLogin(nextLogin);
    setMailCredentialsPassword('');
    setMailCredentialsEmail(nextEmail);
    setMailCredentialsOpen(true);
  }, [mailboxInfo?.effective_mailbox_login, mailboxInfo?.mailbox_email, mailboxInfo?.mailbox_login]);

  useEffect(() => { listDataRef.current = listData; }, [listData]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { mailboxesRef.current = mailboxes; }, [mailboxes]);
  useEffect(() => { folderSummaryRef.current = folderSummary; }, [folderSummary]);
  useEffect(() => { folderTreeRef.current = folderTree; }, [folderTree]);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handleVisibilityStateChange = () => {
      setPageVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityStateChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityStateChange);
    };
  }, []);
  useEffect(() => {
    const previousScope = String(previousMailCacheScopeRef.current || '').trim();
    if (previousScope && previousScope !== mailCacheScope) {
      setRecentHydratedScope('');
      setFolderSummary({});
      setFolderTree([]);
      setListData(createEmptyListData());
    }
    previousMailCacheScopeRef.current = mailCacheScope;
  }, [mailCacheScope]);
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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nextState = {
      folder,
      viewMode,
      search,
      unreadOnly,
      hasAttachmentsOnly,
      filterDateFrom,
      filterDateTo,
      advancedFiltersApplied,
    };
    writeStoredMailViewState(nextState, {
      mailboxId: activeMailboxId,
      defaultAdvancedFilters: DEFAULT_ADVANCED_FILTERS,
    });
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    search,
    unreadOnly,
    viewMode,
  ]);
  const persistMailListViewState = useCallback((contextKey, updater) => {
    const normalizedContextKey = String(contextKey || '').trim();
    if (!normalizedContextKey) return;
    const prevEntry = normalizeMailListViewContextState(listViewStateRef.current?.[normalizedContextKey]);
    const nextEntry = normalizeMailListViewContextState(
      typeof updater === 'function' ? updater(prevEntry) : updater
    );
    const currentState = listViewStateRef.current || {};
    const nextState = {
      ...currentState,
      [normalizedContextKey]: nextEntry,
    };
    listViewStateRef.current = nextState;
    writeStoredMailListViewState(nextState);
  }, []);
  const saveCurrentListScrollPosition = useCallback(({ contextKey, selectedMessageIdAtOpen } = {}) => {
    const resolvedContextKey = String(contextKey || currentListKeyRef.current || currentListContextKey || '').trim();
    if (!resolvedContextKey) return;
    const node = messageListRef.current;
    const nextScrollTop = Math.max(0, Number(node?.scrollTop || 0));
    persistMailListViewState(resolvedContextKey, (prev) => ({
      ...prev,
      scrollTop: nextScrollTop,
      selectedMessageIdAtOpen: selectedMessageIdAtOpen === undefined
        ? prev.selectedMessageIdAtOpen
        : String(selectedMessageIdAtOpen || ''),
    }));
  }, [currentListContextKey, persistMailListViewState]);
  const queueListScrollRestore = useCallback((contextKey) => {
    const resolvedContextKey = String(contextKey || currentListKeyRef.current || currentListContextKey || '').trim();
    if (!resolvedContextKey) return;
    pendingListScrollRestoreRef.current = {
      contextKey: resolvedContextKey,
      ...normalizeMailListViewContextState(listViewStateRef.current?.[resolvedContextKey]),
    };
  }, [currentListContextKey]);
  queueListScrollRestoreRef.current = queueListScrollRestore;
  const pruneReadStateOverridesRef = useCallback(() => {
    localReadStateOverridesRef.current = pruneLocalReadStateOverrides({
      overrides: localReadStateOverridesRef.current,
      now: Date.now(),
      ttlMs: MAIL_AUTO_READ_GUARD_TTL_MS,
    });
    return localReadStateOverridesRef.current;
  }, []);
  const resolveListDataReadStateOverrides = useCallback((nextListData, selectionMode = viewMode) => {
    const overrides = pruneReadStateOverridesRef();
    return applyReadStateOverridesToListData({
      listData: nextListData,
      selectionMode,
      overrides,
    });
  }, [pruneReadStateOverridesRef, viewMode]);
  const resolveMessageReadStateOverrides = useCallback((message) => {
    const overrides = pruneReadStateOverridesRef();
    return applyReadStateOverridesToMessageDetail({
      message,
      overrides,
    });
  }, [pruneReadStateOverridesRef]);
  const resolveConversationReadStateOverrides = useCallback((conversation) => {
    const overrides = pruneReadStateOverridesRef();
    return applyReadStateOverridesToConversationDetail({
      conversation,
      overrides,
    });
  }, [pruneReadStateOverridesRef]);
  const prefetchMailDetail = useCallback((targetId, { mode = viewMode } = {}) => {
    if (!mailAccessReady) return;
    const normalizedId = String(targetId || '').trim();
    const normalizedMode = normalizeMailViewMode(mode);
    if (!normalizedId) return;
    const folderScope = advancedFiltersApplied?.folder_scope || 'current';
    const detailCacheKey = buildMailDetailCacheKey({
      viewMode: normalizedMode,
      scope: mailCacheScope,
      selectedId: normalizedId,
      folder,
      folderScope,
    });
    const detailKey = JSON.stringify(detailCacheKey);
    if (normalizedMode === 'messages') {
      const recentDetail = getRecentMessageDetailSnapshot(normalizedId);
      if (recentDetail) return;
    }
    const cachedDetail = peekSWRCache(detailCacheKey, { staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS });
    if (cachedDetail?.data) return;
    const now = Date.now();
    const completedAt = Number(detailPrefetchCompletedAtRef.current.get(detailKey) || 0);
    if (completedAt > 0 && (now - completedAt) < MAIL_DETAIL_PREFETCH_COOLDOWN_MS) return;
    if (detailPrefetchInFlightRef.current.has(detailKey)) return;
    detailPrefetchInFlightRef.current.add(detailKey);
    const fetcher = () => (
      normalizedMode === 'conversations'
        ? mailAPI.getConversation(
            normalizedId,
            withActiveMailboxParams({ folder, folder_scope: folderScope })
          )
        : mailAPI.getMessage(normalizedId, { mailboxId: activeMailboxId })
    );
    return getOrFetchSWR(
      detailCacheKey,
      fetcher,
      {
        staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS,
        revalidateStale: false,
      }
    ).then((result) => {
      if (result?.data) {
        if (normalizedMode === 'messages') {
          persistRecentMessageDetailSnapshot(result.data);
        }
        detailPrefetchCompletedAtRef.current.set(detailKey, Date.now());
      }
    }).catch(() => {
      detailPrefetchCompletedAtRef.current.delete(detailKey);
    }).finally(() => {
      detailPrefetchInFlightRef.current.delete(detailKey);
    });
  }, [
    activeMailboxId,
    advancedFiltersApplied?.folder_scope,
    folder,
    mailAccessReady,
    mailCacheScope,
    persistRecentMessageDetailSnapshot,
    withActiveMailboxParams,
    viewMode,
  ]);
  const hasFreshSelectedMailDetail = useCallback(({
    detailId = selectedId,
    mode = viewMode,
  } = {}) => {
    if (!mailAccessReady) return false;
    const normalizedId = String(detailId || '').trim();
    if (!normalizedId) return false;
    const normalizedMode = normalizeMailViewMode(mode);
    const folderScope = advancedFiltersApplied?.folder_scope || 'current';
    const detailCacheKey = buildMailDetailCacheKey({
      viewMode: normalizedMode,
      scope: mailCacheScope,
      selectedId: normalizedId,
      folder,
      folderScope,
    });
    const cachedDetail = peekSWRCache(detailCacheKey, { staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS });
    return Boolean(cachedDetail?.data && cachedDetail?.isFresh);
  }, [
    advancedFiltersApplied?.folder_scope,
    folder,
    mailAccessReady,
    mailCacheScope,
    selectedId,
    viewMode,
  ]);
  const hydrateFromRecentCache = useCallback(() => {
    const hydration = getMailRecentHydration({
      scope: mailCacheScope,
      contextKey: currentListContextKey,
    });
    const cachedList = peekSWRCache(currentListCacheKey, { staleTimeMs: MAIL_SWR_STALE_TIME_MS });
    if (!hydration) {
      recentHydratedListContextsRef.current.delete(currentListContextKey);
      if (recentHydratedScope === mailCacheScope) {
        setRecentHydratedScope('');
      }
      if (cachedList?.data) {
        const normalizedList = normalizeMailListResponse(cachedList.data);
        listDataRef.current = normalizedList;
        setListData(normalizedList);
        currentListKeyRef.current = currentListContextKey;
        return true;
      }
      if (String(currentListKeyRef.current || '') !== currentListContextKey) {
        const emptyList = createEmptyListData();
        listDataRef.current = emptyList;
        setListData(emptyList);
        currentListKeyRef.current = currentListContextKey;
      }
      return false;
    }
    if (hydration.folderSummary && Object.keys(hydration.folderSummary).length > 0) {
      setFolderSummary(hydration.folderSummary);
    }
    if (Array.isArray(hydration.folderTree) && hydration.folderTree.length > 0) {
      setFolderTree(hydration.folderTree);
    }
    if (hydration.listData) {
      const normalizedList = normalizeMailListResponse(hydration.listData);
      listDataRef.current = normalizedList;
      setListData(normalizedList);
      setSWRCache(currentListCacheKey, normalizedList);
      currentListKeyRef.current = currentListContextKey;
      recentHydratedListContextsRef.current.add(currentListContextKey);
    } else {
      recentHydratedListContextsRef.current.delete(currentListContextKey);
    }
    setRecentHydratedScope(mailCacheScope);
    return true;
  }, [
    currentListCacheKey,
    currentListContextKey,
    mailCacheScope,
    recentHydratedScope,
  ]);
  useEffect(() => {
    hydrateFromRecentCache();
  }, [hydrateFromRecentCache]);
  useEffect(() => {
    if (!mailboxInfo) return;
    if (mailRequiresRelogin) {
      if (!canSaveMailForAllDevices) {
        setMailCredentialsOpen(false);
        setMailCredentialsError('');
        setMailCredentialsPassword('');
      }
      return;
    }
    if (mailRequiresPassword) {
      if (mailboxUsesPrimaryCredentials) {
        setMailCredentialsOpen(false);
        setMailCredentialsError('');
        setMailCredentialsPassword('');
        setError('Для общего ящика нужно заново войти через AD, чтобы обновить пароль основной учетной записи.');
        selectedIdRef.current = '';
        setSelectedId('');
        setSelectedMessage(null);
        setSelectedConversation(null);
        setSelectedItems([]);
        setSelectedByMode({ messages: '', conversations: '' });
        return;
      }
      openMailCredentialsDialog(mailboxInfo, { reason: mailCredentialsReason || 'missing', errorText: mailCredentialsError });
      selectedIdRef.current = '';
      setSelectedId('');
      setSelectedMessage(null);
      setSelectedConversation(null);
      setSelectedItems([]);
      setSelectedByMode({ messages: '', conversations: '' });
      return;
    }
    setMailCredentialsOpen(false);
    setMailCredentialsError('');
    setMailCredentialsPassword('');
  }, [
    canSaveMailForAllDevices,
    mailCredentialsError,
    mailCredentialsReason,
    mailRequiresPassword,
    mailRequiresRelogin,
    mailboxUsesPrimaryCredentials,
    mailboxInfo,
    openMailCredentialsDialog,
  ]);
  useEffect(() => {
    queueListScrollRestore(currentListContextKey);
  }, [currentListContextKey, queueListScrollRestore]);
  useEffect(() => () => {
    saveCurrentListScrollPosition({ contextKey: currentListContextKey });
  }, [currentListContextKey, saveCurrentListScrollPosition]);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePageHide = () => {
      saveCurrentListScrollPosition();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [saveCurrentListScrollPosition]);
  useEffect(() => {
    if (!isMobile || hasMobileSelection) return undefined;
    const pendingRestore = pendingListScrollRestoreRef.current;
    if (!pendingRestore || pendingRestore.contextKey !== currentListContextKey) return undefined;
    const node = messageListRef.current;
    if (!node) return undefined;
    let restoreFrame = 0;
    let settleFrame = 0;
    restoreFrame = window.requestAnimationFrame(() => {
      node.scrollTop = Math.max(0, Number(pendingRestore.scrollTop || 0));
      settleFrame = window.requestAnimationFrame(() => {
        pendingListScrollRestoreRef.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(restoreFrame);
      window.cancelAnimationFrame(settleFrame);
    };
  }, [
    currentListContextKey,
    hasMobileSelection,
    isMobile,
    listData?.items?.length,
    listData?.total,
  ]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search || '');
    const nextMailboxId = normalizeMailboxId(searchParams.get('mailbox_id'));
    const rawNextFolder = String(searchParams.get('folder') || '').trim();
    const nextFolder = rawNextFolder ? normalizeMailFolder(rawNextFolder) : '';
    const nextMessageId = String(searchParams.get('message') || '').trim();
    if (nextMailboxId && nextMailboxId !== activeMailboxId) {
      lastAppliedMailboxViewStateRef.current = '';
      setSelectedMailboxId(nextMailboxId);
      writeStoredSelectedMailboxId(nextMailboxId);
      return;
    }
    if (!nextMessageId) {
      deepLinkKeyRef.current = '';
      return;
    }
    const resolvedFolder = nextFolder || 'inbox';
    const nextKey = `${resolvedFolder}:${nextMessageId}`;
    if (deepLinkKeyRef.current === nextKey) return;
    deepLinkKeyRef.current = nextKey;
    if (folder !== resolvedFolder) {
      setFolder(resolvedFolder);
    }
    if (viewMode !== 'messages') {
      setViewMode('messages');
    }
    setSelectedItems([]);
    setSelectedByMode((prev) => ({ ...(prev || {}), messages: nextMessageId }));
    selectedIdRef.current = nextMessageId;
    setSelectedId(nextMessageId);
  }, [activeMailboxId, folder, location.search, viewMode]);

  const restoreMobileHistorySelectionWithMode = useCallback((nextState) => {
    if (!nextState?.selectedId) return;
    if (viewModeRef.current !== nextState.selectionMode) {
      setViewMode(nextState.selectionMode);
    }
    restoreMobileHistorySelection(nextState);
  }, [restoreMobileHistorySelection]);

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
    setMailboxInfo(null);
    setSelectedMailboxId(normalizedMailboxId);
    writeStoredSelectedMailboxId(normalizedMailboxId);
    setMailConfigLoading(true);
    setLoading(false);
    setMailBackgroundRefreshing(false);
    setRecentHydratedScope('');
    setFolderSummary({});
    setFolderTree([]);
    setListData(createEmptyListData());
    setFolder(storedState.folder || 'inbox');
    setViewMode(storedState.viewMode || 'messages');
    setSearch('');
    setUnreadOnly(false);
    setHasAttachmentsOnly(false);
    setFilterDateFrom('');
    setFilterDateTo('');
    setAdvancedFiltersDraft(DEFAULT_ADVANCED_FILTERS);
    setAdvancedFiltersApplied(DEFAULT_ADVANCED_FILTERS);
    navigate(buildMailRoute({
      folder: storedState.folder || 'inbox',
      mailboxId: normalizedMailboxId,
    }), { replace: true });
  }, [activeMailboxId, clearSelection, navigate, refreshMailboxUnreadCounts]);

  const refreshConfig = useCallback(async () => {
    setMailConfigLoading(true);
    try {
      const data = await mailAPI.getMyConfig({ mailbox_id: activeMailboxId || undefined });
      setMailboxInfo(data || null);
      setMailboxes((prev) => mergeMailboxEntries(prev, data || null));
      const resolvedMailboxId = getMailboxEntryId(data);
      if (resolvedMailboxId) {
        setSelectedMailboxId(resolvedMailboxId);
      }
      return data || null;
    } catch (requestError) {
      setMailboxInfo(null);
      setError(getMailErrorDetail(requestError, 'Не удалось загрузить почтовую конфигурацию.'));
      return null;
    } finally {
      setMailConfigLoading(false);
    }
  }, [activeMailboxId, getMailErrorDetail]);

  const handleMailCredentialsRequired = useCallback(async (requestError, fallbackMessage = '') => {
    const errorCode = getMailErrorCode(requestError);
    if (errorCode === 'MAIL_RELOGIN_REQUIRED') {
      const refreshedConfig = await refreshConfig();
      const nextConfig = refreshedConfig || mailboxInfo;
      const canSaveSharedCredentials = Boolean(
        nextConfig
        && String(nextConfig?.auth_mode || '').trim().toLowerCase() === 'primary_session'
        && (
          nextConfig?.mailbox_email
          || nextConfig?.effective_mailbox_login
          || nextConfig?.mailbox_login
        )
      );
      if (canSaveSharedCredentials) {
        openMailCredentialsDialog(nextConfig, {
          reason: 'shared',
          errorText: 'Сохраните пароль корпоративной почты, чтобы этот ящик работал на всех ваших устройствах.',
        });
        setError('Сохраните корпоративный пароль, чтобы почта снова открывалась без повторного входа.');
        return true;
      }
      setMailCredentialsOpen(false);
      setError('Для доступа к почте войдите в систему заново.');
      return true;
    }
    if (errorCode !== 'MAIL_PASSWORD_REQUIRED' && errorCode !== 'MAIL_AUTH_INVALID') {
      return false;
    }
    const refreshedConfig = await refreshConfig();
    const nextConfig = refreshedConfig || mailboxInfo;
    if (String(nextConfig?.auth_mode || '').trim().toLowerCase() === 'primary_credentials') {
      setMailCredentialsOpen(false);
      setMailCredentialsError('');
      setMailCredentialsPassword('');
      setError(
        errorCode === 'MAIL_AUTH_INVALID'
          ? 'Пароль основной AD-учетной записи устарел или неверен. Выйдите и снова войдите через AD.'
          : 'Для общего ящика нужно заново войти через AD, чтобы обновить пароль основной учетной записи.'
      );
      return true;
    }
    openMailCredentialsDialog(nextConfig, {
      reason: errorCode === 'MAIL_AUTH_INVALID' ? 'expired' : 'missing',
      errorText: errorCode === 'MAIL_AUTH_INVALID'
        ? 'Неверный или устаревший пароль. Введите актуальный пароль от корпоративного компьютера (Windows).'
        : '',
    });
    setError(errorCode === 'MAIL_AUTH_INVALID'
      ? 'Неверный или устаревший пароль. Введите актуальный пароль от корпоративного компьютера (Windows).'
      : String(fallbackMessage || '').trim());
    return true;
  }, [getMailErrorCode, mailboxInfo, openMailCredentialsDialog, refreshConfig]);

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

  const invalidateMailClientCache = useCallback((prefixes = ['bootstrap', 'folder-summary', 'folder-tree', 'list', 'message-detail', 'conversation-detail']) => {
    (Array.isArray(prefixes) ? prefixes : []).forEach((prefix) => {
      invalidateSWRCacheByPrefix('mail', mailCacheScope, prefix);
    });
    clearMailRecentCacheForScope(mailCacheScope);
  }, [mailCacheScope]);

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

  const handleQuickReplySendingStart = useCallback(() => {
    notifyMailInfo('Письмо отправляется…', {
      dedupeKey: 'mail-quick-reply:sending',
      durationMs: 4000,
    });
  }, [notifyMailInfo]);

  const handleQuickReplySent = useCallback(() => {
    notifyMailSuccess('Письмо отправлено.');
  }, [notifyMailSuccess]);

  const {
    quickReplyBody,
    setQuickReplyBody,
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
  const silentRevalidateCurrentMailView = useCallback(async ({ reason = 'auto', force = false } = {}) => {
    if (!mailAccessReady) return;
    const refreshKey = `${mailCacheScope}:${currentListContextKey}:${viewMode}:${folder}`;
    return runMailViewRefreshGate(refreshKey, async () => {
      setMailBackgroundRefreshing(true);
      try {
        const shouldFallbackToBootstrap = !mailboxInfo
          || !folderTreeRef.current?.length
          || !Object.keys(folderSummaryRef.current || {}).length;
        const shouldRefreshFolderSummary = shouldFallbackToBootstrap
          || reason === 'mail-needs-refresh'
          || !Object.keys(folderSummaryRef.current || {}).length
          || (Date.now() - Number(folderSummaryRefreshCompletedAtRef.current || 0)) >= MAIL_FOLDER_SUMMARY_REFRESH_COOLDOWN_MS;
        const tasks = shouldFallbackToBootstrap
          ? [refreshBootstrap({ force: true })]
          : [refreshList({ silent: true, force: true })];
        if (!shouldFallbackToBootstrap && shouldRefreshFolderSummary) {
          tasks.unshift(refreshFolderSummary({ force: reason === 'mail-needs-refresh' }));
        }
        if (selectedIdRef.current) {
          const shouldRevalidateSelectedDetail = reason === 'mail-needs-refresh'
            || !hasFreshSelectedMailDetail({ detailId: selectedIdRef.current, mode: viewMode });
          if (shouldRevalidateSelectedDetail) {
            tasks.push(revalidateSelectedMailDetail({ force: reason === 'mail-needs-refresh' }));
          }
        }
        await Promise.allSettled(tasks);
      } finally {
        setMailBackgroundRefreshing(false);
      }
    }, {
      force,
      bypassCooldown: reason === 'mail-needs-refresh',
    });
  }, [
    currentListContextKey,
    folder,
    mailAccessReady,
    mailCacheScope,
    mailboxInfo,
    refreshBootstrap,
    refreshFolderSummary,
    refreshList,
    hasFreshSelectedMailDetail,
    revalidateSelectedMailDetail,
    runMailViewRefreshGate,
    viewMode,
  ]);

  useEffect(() => {
    refreshBootstrap({ force: false });
  }, [mailCacheScope]);

  useEffect(() => {
    if (!mailAccessReady) {
      setFolderSummary({});
      setFolderTree([]);
      return;
    }
  }, [mailAccessReady]);

  useEffect(() => {
    if (!mailAccessReady) return;
    if (skipNextListRefreshRef.current) {
      skipNextListRefreshRef.current = false;
      return;
    }
    refreshList({ force: false });
  }, [mailAccessReady, refreshList]);

  useEffect(() => {
    const hasPrefetchBlockingFilters = Boolean(
      debouncedSearch
      || unreadOnly
      || hasAttachmentsOnly
      || filterDateFrom
      || filterDateTo
      || advancedFiltersApplied?.from_filter
      || advancedFiltersApplied?.to_filter
      || advancedFiltersApplied?.subject_filter
      || advancedFiltersApplied?.body_filter
      || advancedFiltersApplied?.importance
      || (advancedFiltersApplied?.folder_scope && advancedFiltersApplied.folder_scope !== 'current')
    );
    if (!mailAccessReady || !mailCacheScope || hasPrefetchBlockingFilters || viewMode !== 'messages') return;
    if (String(currentListKeyRef.current || '') !== currentListContextKey) return;
    const prefetchKey = `${mailCacheScope}:${viewMode}`;
    if (prefetchedListContextsRef.current.has(prefetchKey)) return;
    prefetchedListContextsRef.current.add(prefetchKey);
    let cancelled = false;
    let timeoutId = null;
    let idleId = null;
    const runPrefetch = () => {
      if (cancelled) return;
      MAIL_STANDARD_PREFETCH_FOLDERS.forEach((folderId) => {
        const params = {
          folder: folderId,
          folder_scope: 'current',
          limit: 50,
          offset: 0,
        };
        const cacheKey = buildMailListCacheKey({
          scope: mailCacheScope,
          folder: folderId,
          viewMode,
          folderScope: 'current',
          limit: 50,
          offset: 0,
        });
        void getOrFetchSWR(
          cacheKey,
          () => mailAPI.getMessages(withActiveMailboxParams(params)),
          {
            staleTimeMs: MAIL_SWR_STALE_TIME_MS,
            revalidateStale: false,
          }
        ).then((result) => {
          if (result?.data) {
            persistRecentListSnapshot(JSON.stringify(cacheKey), result.data);
          }
        }).catch(() => {});
      });
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(runPrefetch, { timeout: 1500 });
    } else if (typeof window !== 'undefined') {
      timeoutId = window.setTimeout(runPrefetch, 900);
    } else {
      runPrefetch();
    }
    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    advancedFiltersApplied,
    currentListContextKey,
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    hasAttachmentsOnly,
    mailAccessReady,
    mailCacheScope,
    persistRecentListSnapshot,
    unreadOnly,
    withActiveMailboxParams,
    viewMode,
  ]);

  useEffect(() => {
    if (
      !mailAccessReady
      || viewMode !== 'messages'
      || isMobile
      || selectedId
      || MAIL_DETAIL_PREFETCH_LIMIT <= 0
    ) return undefined;
    const candidateIds = (Array.isArray(listData?.items) ? listData.items : [])
      .slice(0, MAIL_DETAIL_PREFETCH_LIMIT)
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean)
      .filter((id) => id !== String(selectedId || '').trim());
    if (candidateIds.length === 0) return undefined;
    const prefetchSignature = `${currentListContextKey}:${candidateIds.join('|')}`;
    if (prefetchedDetailListSignaturesRef.current.has(prefetchSignature)) return undefined;
    prefetchedDetailListSignaturesRef.current.add(prefetchSignature);
    let cancelled = false;
    const runPrefetch = () => {
      if (cancelled) return;
      void (async () => {
        for (const id of candidateIds) {
          if (cancelled) return;
          await prefetchMailDetail(id, { mode: 'messages' });
        }
      })();
    };
    let timeoutId = null;
    let idleId = null;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(runPrefetch, { timeout: 400 });
    } else if (typeof window !== 'undefined') {
      timeoutId = window.setTimeout(runPrefetch, 180);
    } else {
      runPrefetch();
    }
    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null && typeof window !== 'undefined') {
        window.clearTimeout(timeoutId);
      }
    };
  }, [currentListContextKey, isMobile, listData?.items, mailAccessReady, prefetchMailDetail, selectedId, viewMode]);

  useEffect(() => {
    if (!Array.isArray(folderTree) || folderTree.length === 0) return;
    const exists = folderTree.some((item) => String(item?.id || '') === String(folder || ''));
    if (!exists) {
      clearSelection({ allModes: true });
      setFolder('inbox');
    }
  }, [folderTree, folder, clearSelection]);

  useEffect(() => {
    const current = String(selectedId || '');
    setSelectedByMode((prev) => {
      if (String(prev?.[viewMode] || '') === current) return prev;
      return { ...(prev || {}), [viewMode]: current };
    });
  }, [selectedId, viewMode]);

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        void silentRevalidateCurrentMailView({ reason: 'mail-needs-refresh', force: true });
      }
    };
    const handleVisibilityRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      void silentRevalidateCurrentMailView({ reason: 'visibility' });
    };
    window.addEventListener('mail-needs-refresh', handler);
    window.addEventListener('focus', handleVisibilityRefresh);
    document.addEventListener('visibilitychange', handleVisibilityRefresh);
    const timer = pageVisible ? setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void silentRevalidateCurrentMailView({ reason: 'timer' });
    }, MAIL_ACTIVE_REFRESH_INTERVAL_MS) : null;
    return () => {
      window.removeEventListener('mail-needs-refresh', handler);
      window.removeEventListener('focus', handleVisibilityRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityRefresh);
      if (timer) clearInterval(timer);
    };
  }, [pageVisible, silentRevalidateCurrentMailView]);
  useEffect(() => {
    if (viewMode !== 'conversations' || !selectedId) return;
    const currentConversationIds = (Array.isArray(listData?.items) ? listData.items : [])
      .map((item) => String(item?.conversation_id || item?.id || ''))
      .filter(Boolean);
    if (currentConversationIds.length > 0 && !currentConversationIds.includes(String(selectedId))) {
      clearSelection({ mode: 'conversations' });
    }
  }, [selectedId, viewMode, listData?.items, clearSelection]);

  useEffect(() => {
    if (!loadMoreSentinelRef.current || !listData.has_more) return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMoreMessages();
    }, { threshold: 0.1 });
    observer.observe(loadMoreSentinelRef.current);
    return () => observer.disconnect();
  }, [loadMoreMessages, listData.has_more]);

  useEffect(() => {
    if (viewMode !== 'conversations') return;
    const node = conversationScrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [viewMode, selectedId, selectedConversation?.items?.length]);

  const openComposeSession = useCallback((initialState) => {
    composeSessionCounterRef.current += 1;
    setComposeSession({
      id: composeSessionCounterRef.current,
      initialState: createComposeInitialState(initialState),
    });
  }, []);

  const openCompose = useCallback(() => {
    const restoredState = readStoredComposeState({ composeDraftKey, resolveComposeMailboxId });
    openComposeSession(
      restoredState || createComposeInitialState({
        composeMode: 'new',
        composeFromMailboxId: resolveComposeMailboxId(),
      })
    );
  }, [composeDraftKey, openComposeSession, resolveComposeMailboxId]);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search || '');
    if (searchParams.get('compose') === 'new') {
      openCompose();
      searchParams.delete('compose');
      const nextQuery = searchParams.toString();
      navigate(nextQuery ? `/mail?${nextQuery}` : '/mail', { replace: true });
      return;
    }
    const composeTo = normalizeMailRecipient(searchParams.get('compose_to'));
    if (!composeTo || !isValidEmailRecipient(composeTo)) return;
    openComposeSession({
      composeMode: 'new',
      composeFromMailboxId: resolveComposeMailboxId(),
      to: [composeTo],
    });
    searchParams.delete('compose_to');
    const nextQuery = searchParams.toString();
    navigate(nextQuery ? `/mail?${nextQuery}` : '/mail', { replace: true });
  }, [location.search, navigate, openCompose, openComposeSession, resolveComposeMailboxId]);

  const openComposeFromMessage = useCallback((mode) => {
    if (!selectedMessage) return;
    const key = mode === 'reply_all' ? 'reply_all' : mode;
    const context = selectedMessage?.compose_context?.[key] || {};
    const quotedOriginalHtml = String(context?.quote_html || '');
    openComposeSession({
      composeMode: mode || 'reply',
      composeFromMailboxId: resolveComposeMailboxId(context?.mailbox_id || selectedMessage?.mailbox_id),
      to: context?.to,
      cc: context?.cc,
      bcc: [],
      subject: normalizeComposeSubject(mode, context?.subject || selectedMessage.subject || ''),
      composeBody: quotedOriginalHtml ? '<p><br></p>' : '',
      composeQuotedOriginalHtml: quotedOriginalHtml,
      replyToMessageId: mode === 'forward' ? '' : String(selectedMessage.id || ''),
      forwardMessageId: mode === 'forward' ? String(selectedMessage.id || '') : '',
      draftSyncState: 'idle',
      draftSavedAt: '',
    });
    try {
      window.localStorage.removeItem(composeDraftKey);
    } catch {
      // ignore local storage issues
    }
  }, [composeDraftKey, openComposeSession, resolveComposeMailboxId, selectedMessage]);

  const openComposeFromDraftMessage = useCallback((sourceMessage) => {
    if (!sourceMessage || String(sourceMessage.folder || '').toLowerCase() !== 'drafts') return;
    const draftContext = sourceMessage?.draft_context || {};
    const splitDraftBody = splitQuotedHistoryHtml(sourceMessage.body_html || '');
    openComposeSession({
      composeMode: String(draftContext.compose_mode || 'draft'),
      composeFromMailboxId: resolveComposeMailboxId(draftContext.mailbox_id || sourceMessage?.mailbox_id),
      to: sourceMessage.to,
      cc: sourceMessage.cc,
      bcc: sourceMessage.bcc,
      subject: String(sourceMessage.subject || ''),
      composeBody: String(splitDraftBody?.primaryHtml || ''),
      composeQuotedOriginalHtml: String(splitDraftBody?.quotedHtml || ''),
      draftAttachments: Array.isArray(sourceMessage.attachments) ? sourceMessage.attachments : [],
      draftId: String(sourceMessage.id || ''),
      replyToMessageId: String(draftContext.reply_to_message_id || ''),
      forwardMessageId: String(draftContext.forward_message_id || ''),
      draftSyncState: 'synced',
    });
    try {
      window.localStorage.removeItem(composeDraftKey);
    } catch {
      // ignore local storage issues
    }
  }, [composeDraftKey, openComposeSession, resolveComposeMailboxId]);

  const openComposeFromDraft = useCallback(() => {
    openComposeFromDraftMessage(selectedMessage);
  }, [openComposeFromDraftMessage, selectedMessage]);

  const handleComposeSent = useCallback(async () => {
    setComposeSession(null);
    notifyMailSuccess('Письмо отправлено.');
    invalidateMailClientCache();
    await refreshList({ silent: true, force: true });
    await refreshFolderSummary();
  }, [invalidateMailClientCache, notifyMailSuccess, refreshFolderSummary, refreshList]);

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

  const handleSaveMailCredentials = useCallback(async () => {
    const login = String(mailCredentialsLogin || '').trim();
    const password = String(mailCredentialsPassword || '').trim();
    const mailboxEmail = String(mailCredentialsEmail || '').trim();
    if (!password) {
      setMailCredentialsError('Введите пароль от корпоративного компьютера.');
      return;
    }
    setMailCredentialsSaving(true);
    setMailCredentialsError('');
    try {
      const data = await mailAPI.saveMyCredentials({
        mailbox_id: getMailboxEntryId(mailboxInfo) || activeMailboxId || undefined,
        mailbox_login: login || undefined,
        mailbox_password: password,
        mailbox_email: mailboxEmail || undefined,
      });
      setMailboxInfo(data || null);
      setMailboxes((prev) => mergeMailboxEntries(prev, data || null));
      const resolvedMailboxId = getMailboxEntryId(data);
      if (resolvedMailboxId) {
        setSelectedMailboxId(resolvedMailboxId);
      }
      setMailCredentialsPassword('');
      setMailCredentialsOpen(false);
      setError('');
      notifyMailSuccess('Корпоративный пароль сохранён в профиле. Этот ящик доступен на всех ваших устройствах.');
      invalidateMailClientCache();
      await refreshBootstrap({ force: true, live: true });
    } catch (requestError) {
      setMailCredentialsError(getMailErrorDetail(requestError, 'Не удалось сохранить корпоративный пароль.'));
    } finally {
      setMailCredentialsSaving(false);
    }
  }, [
    activeMailboxId,
    getMailErrorDetail,
    mailboxInfo,
    mailCredentialsEmail,
    mailCredentialsLogin,
    mailCredentialsPassword,
    invalidateMailClientCache,
    notifyMailSuccess,
    refreshBootstrap,
  ]);

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

  const handleSaveMailPreferences = useCallback(async () => {
    setMailPreferencesSaving(true);
    try {
      const data = await mailAPI.updatePreferences(mailPreferencesDraft);
      const nextValue = { ...DEFAULT_MAIL_PREFERENCES, ...((data?.preferences || data) || {}) };
      setMailPreferences(nextValue);
      setMailPreferencesDraft(nextValue);
      setMailPreferencesOpen(false);
      notifyMailSuccess('Настройки вида сохранены.');
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось сохранить настройки вида.');
    } finally {
      setMailPreferencesSaving(false);
    }
  }, [mailPreferencesDraft, notifyMailSuccess]);

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
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    mailAPI,
    moveTarget,
    performMailReadMutation,
    selectedConversation,
    selectedMessage,
    setError,
    setSelectedMessage,
    viewMode,
    withActiveMailboxPayload,
  });

  const handleMailAiError = useCallback((requestError) => {
    setError(getMailErrorDetail(requestError, 'Не удалось выполнить AI-действие для письма.'));
  }, [getMailErrorDetail, setError]);

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
    enabled: Boolean(selectedMessage?.id) && viewMode === 'messages',
    onError: handleMailAiError,
  });

  const handleCopyMailSummary = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ''));
      notifyMailSuccess('Пересказ скопирован.');
    } catch {
      setError('Не удалось скопировать пересказ.');
    }
  }, [notifyMailSuccess, setError]);

  const handleSmartReplySelect = useCallback(async (suggestion) => {
    const nextBody = String(suggestion || '').trim();
    if (!nextBody || !selectedMessage?.id) return;
    await sendQuickReply(selectedMessage, nextBody);
  }, [selectedMessage, sendQuickReply]);

  const handleQuickReplySend = useCallback(async () => {
    if (!selectedMessage?.id) return;
    await sendQuickReply(selectedMessage);
  }, [selectedMessage, sendQuickReply]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      const data = await mailAPI.markAllRead({
        mailbox_id: activeMailboxId || undefined,
        folder,
        folder_scope: advancedFiltersApplied?.folder_scope || 'current',
      });
      if (viewMode === 'conversations' && selectedConversation?.conversation_id) {
        applyConversationReadStateLocally({
          conversationId: String(selectedConversation.conversation_id),
          isRead: true,
          unreadCount: Number(selectedConversation?.unread_count || 0),
          messageCount: Number(selectedConversation?.messages_count || selectedConversation?.items?.length || 1),
          unreadDelta: -Math.max(0, Number(selectedConversation?.unread_count || 0)),
        });
      } else if (selectedMessage?.id && selectedMessage?.is_read === false) {
        applyMessageReadStateLocally({
          messageId: String(selectedMessage.id),
          isRead: true,
          unreadDelta: -1,
        });
      }
      await afterListMutation({ clearBulkSelection: false });
      notifyMailSuccess(`Отмечено как прочитанное: ${Number(data?.changed || 0)}.`);
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось отметить письма как прочитанные.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось отметить письма как прочитанные.'));
      }
    }
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    afterListMutation,
    applyConversationReadStateLocally,
    applyMessageReadStateLocally,
    folder,
    notifyMailSuccess,
    selectedConversation,
    selectedMessage,
    viewMode,
  ]);

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

  useEffect(() => {
    const isTypingTarget = (target) => {
      const element = target instanceof HTMLElement ? target : null;
      if (!element) return false;
      if (element.closest('.ql-editor')) return true;
      const tagName = String(element.tagName || '').toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || element.isContentEditable;
    };

    const onKeyDown = (event) => {
      if (isTypingTarget(event.target) && event.key !== 'Escape') return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') return;
      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        searchInputRef.current?.focus?.();
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        openCompose();
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        event.preventDefault();
        invalidateMailClientCache();
        refreshList({ force: true });
        refreshFolderSummary();
        return;
      }
      if (event.key === 'Delete' && selectedMessage?.id) {
        event.preventDefault();
        if (selectedMessageIds.length > 0) {
          runBulkAction({
            action: 'delete',
            permanent: folder === 'trash',
            successMessage: folder === 'trash' ? 'Выбранные письма удалены навсегда.' : 'Выбранные письма перемещены в удаленные.',
          });
        } else {
          mailAPI.deleteMessage(selectedMessage.id, withActiveMailboxPayload({ permanent: folder === 'trash' }))
            .then(async () => {
              clearSelection({ mode: viewMode });
              await afterListMutation();
            })
            .catch((requestError) => {
              handleMailCredentialsRequired(requestError, 'Не удалось удалить письмо.').then((handled) => {
                if (!handled) {
                  setError(getMailErrorDetail(requestError, 'Не удалось удалить письмо.'));
                }
              });
            });
        }
        return;
      }
      if (event.key === 'Escape') {
        if (mobileNavigationOpen) {
          event.preventDefault();
          setMobileNavigationOpen(false);
          return;
        }
        if (composeOpen) {
          event.preventDefault();
          composeCloseRequestRef.current?.();
          return;
        }
        if (advancedSearchOpen) {
          event.preventDefault();
          setAdvancedSearchOpen(false);
          return;
        }
        if (mailPreferencesOpen) {
          event.preventDefault();
          setMailPreferencesOpen(false);
          return;
        }
        if (headersOpen) {
          event.preventDefault();
          closeHeadersDialog();
          return;
        }
        if (shortcutsOpen) {
          event.preventDefault();
          setShortcutsOpen(false);
          return;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    advancedSearchOpen,
    afterListMutation,
    clearSelection,
    composeOpen,
    composeCloseRequestRef,
    closeHeadersDialog,
    folder,
    headersOpen,
    mailPreferencesOpen,
    mobileNavigationOpen,
    openCompose,
    refreshFolderSummary,
    refreshList,
    runBulkAction,
    selectedMessage?.id,
    selectedMessageIds,
    shortcutsOpen,
    viewMode,
  ]);

  const isOwnConversationMessage = useCallback((item) => {
    const sender = getSenderEmail(item);
    if (sender && mailboxEmails.has(sender)) return true;
    if (folder === 'sent' || folder === 'drafts') return true;
    return false;
  }, [mailboxEmails, folder]);

  const fallbackFolderTreeItems = useMemo(() => Object.entries(FOLDER_LABELS).map(([id, label]) => ({
    id,
    label,
    name: label,
    scope: id === 'archive' ? 'archive' : 'mailbox',
    icon_key: id,
    well_known_key: id,
    parent_id: null,
    is_favorite: false,
    can_rename: false,
    can_delete: false,
    total: Number(folderSummary?.[id]?.total || 0),
    unread: Number(folderSummary?.[id]?.unread || 0),
  })), [folderSummary]);
  const effectiveFolderTreeItems = useMemo(() => {
    const source = Array.isArray(folderTree) && folderTree.length > 0 ? folderTree : fallbackFolderTreeItems;
    return source.map((item) => {
      const key = String(item?.well_known_key || '').trim().toLowerCase();
      if (!folderSummary?.[key]) return item;
      return {
        ...item,
        total: Number(folderSummary[key]?.total || 0),
        unread: Number(folderSummary[key]?.unread || 0),
      };
    });
  }, [folderTree, fallbackFolderTreeItems, folderSummary]);
  const folderLabelMap = useMemo(() => {
    const map = new Map();
    effectiveFolderTreeItems.forEach((item) => {
      const key = String(item?.id || '');
      if (key) map.set(key, String(item?.label || item?.name || key));
    });
    return map;
  }, [effectiveFolderTreeItems]);
  const moveTargets = useMemo(
    () => effectiveFolderTreeItems
      .filter((item) => String(item?.id || '') !== String(folder || ''))
      .map((item) => ({ value: String(item.id), label: String(item.label || item.name || item.id) })),
    [effectiveFolderTreeItems, folder]
  );
  const advancedFiltersActive = Boolean(
    advancedFiltersApplied?.from_filter
    || advancedFiltersApplied?.to_filter
    || advancedFiltersApplied?.subject_filter
    || advancedFiltersApplied?.body_filter
    || advancedFiltersApplied?.importance
    || (advancedFiltersApplied?.folder_scope && advancedFiltersApplied.folder_scope !== 'current')
  );
  const hasActiveFilters = Boolean(search || unreadOnly || hasAttachmentsOnly || filterDateFrom || filterDateTo || advancedFiltersActive);
  const noResultsHint = useMemo(() => (!hasActiveFilters ? (viewMode === 'conversations' ? 'Нет диалогов' : 'Нет писем') : 'Ничего не найдено. Измените фильтры.'), [hasActiveFilters, viewMode]);
  const currentFolderLabel = folderLabelMap.get(String(folder || '')) || FOLDER_LABELS[folder] || 'Письма';
  const readingPaneMode = isMobile ? 'stacked' : (mailPreferences?.reading_pane || 'right');
  const mailPaneSizes = useMemo(() => getMailPaneSizes(mailPreferences), [
    mailPreferences?.bottom_list_percent,
    mailPreferences?.folder_pane_width,
    mailPreferences?.message_list_width,
  ]);
  const persistMailPaneSize = useCallback((key, value) => {
    const normalizedValue = clampMailPaneSize(key, value);
    const patch = { [key]: normalizedValue };
    setMailPreferences((previous) => ({ ...(previous || {}), ...patch }));
    setMailPreferencesDraft((previous) => ({ ...(previous || {}), ...patch }));
    mailPaneSaveChainRef.current = mailPaneSaveChainRef.current
      .catch(() => undefined)
      .then(() => mailAPI.updatePreferences(patch))
      .catch((requestError) => {
        setError(requestError?.response?.data?.detail || 'Не удалось сохранить размер почтовой панели.');
      });
  }, []);
  const applyMailPaneResize = useCallback((key, value, { commit = false } = {}) => {
    const normalizedValue = clampMailPaneSize(key, value);
    const cssVariable = {
      folder_pane_width: '--mail-folder-pane-width',
      message_list_width: '--mail-message-list-width',
      bottom_list_percent: '--mail-bottom-list-percent',
    }[key];
    if (cssVariable) {
      desktopMailAreaRef.current?.style.setProperty(cssVariable, getMailPaneCssValue(key, normalizedValue));
    }
    if (commit) persistMailPaneSize(key, normalizedValue);
  }, [persistMailPaneSize]);
  const handleFolderPaneResize = useCallback((value, options) => {
    applyMailPaneResize('folder_pane_width', value, options);
  }, [applyMailPaneResize]);
  const handleMessageListResize = useCallback((value, options) => {
    applyMailPaneResize('message_list_width', value, options);
  }, [applyMailPaneResize]);
  const handleBottomListResize = useCallback((value, options) => {
    applyMailPaneResize('bottom_list_percent', value, options);
  }, [applyMailPaneResize]);
  const mailboxPrimaryDomain = useMemo(() => {
    const primary = Array.from(mailboxEmails)[0] || '';
    return String(primary.split('@')[1] || '').trim().toLowerCase();
  }, [mailboxEmails]);
  const folderRailUtilityItems = useMemo(() => {
    const items = [
      {
        id: 'it-request',
        label: 'IT-заявка',
        onClick: () => {
          closeMobileNavigationIfNeeded();
          openItRequest();
        },
      },
    ];
    if (canManageUsers) {
      items.push({
        id: 'templates',
        label: 'Шаблоны',
        onClick: () => {
          closeMobileNavigationIfNeeded();
          openTemplatesDialog();
        },
      });
    }
    return items;
  }, [canManageUsers, closeMobileNavigationIfNeeded, openTemplatesDialog]);
  const handleRefreshMailView = useCallback(() => {
    invalidateMailClientCache();
    refreshList({ force: true });
    refreshFolderSummary();
    refreshFolderTree();
  }, [invalidateMailClientCache, refreshFolderSummary, refreshFolderTree, refreshList]);
  const handleOpenAdvancedSearch = useCallback(() => {
    setAdvancedFiltersDraft({ ...advancedFiltersApplied, q: search });
    setAdvancedSearchOpen(true);
  }, [advancedFiltersApplied, search]);
  const handleFolderChange = useCallback((value) => {
    const nextFolder = normalizeMailFolder(value);
    if (nextFolder === folder) {
      closeMobileNavigationIfNeeded();
      return;
    }
    clearSelection({ allModes: true });
    setSelectedItems([]);
    setFolder(nextFolder);
    closeMobileNavigationIfNeeded();
  }, [clearSelection, closeMobileNavigationIfNeeded, folder]);
  const handleViewModeChange = useCallback((value) => {
    const nextMode = value === 'conversations' ? 'conversations' : 'messages';
    const nextSelectedId = String(selectedByMode?.[nextMode] || '');
    detailContextRef.current = '';
    selectedIdRef.current = nextSelectedId;
    setSelectedItems([]);
    setViewMode(nextMode);
    setSelectedId(nextSelectedId);
    setSelectedMessage(null);
    setSelectedConversation(null);
    closeMobileNavigationIfNeeded();
  }, [closeMobileNavigationIfNeeded, selectedByMode]);
  const handleUnreadToggle = useCallback((value) => {
    setUnreadOnly(Boolean(value));
    closeMobileNavigationIfNeeded();
  }, [closeMobileNavigationIfNeeded]);
  const handleToggleHasAttachmentsOnly = useCallback(() => {
    setHasAttachmentsOnly((prev) => !prev);
    closeMobileNavigationIfNeeded();
  }, [closeMobileNavigationIfNeeded]);
  const handleToggleTodayFilter = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = filterDateFrom === today && filterDateTo === today;
    setFilterDateFrom(active ? '' : today);
    setFilterDateTo(active ? '' : today);
    closeMobileNavigationIfNeeded();
  }, [closeMobileNavigationIfNeeded, filterDateFrom, filterDateTo]);
  const handleToggleLast7DaysFilter = useCallback(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    const from = date.toISOString().slice(0, 10);
    const active = filterDateFrom === from && !filterDateTo;
    setFilterDateFrom(active ? '' : from);
    setFilterDateTo('');
    closeMobileNavigationIfNeeded();
  }, [closeMobileNavigationIfNeeded, filterDateFrom, filterDateTo]);
  const handleCreateFolderRequest = useCallback((target) => {
    closeMobileNavigationIfNeeded();
    handleOpenCreateFolderDialog(target);
  }, [closeMobileNavigationIfNeeded, handleOpenCreateFolderDialog]);
  const handleRenameFolderRequest = useCallback((item) => {
    closeMobileNavigationIfNeeded();
    handleOpenRenameFolderDialog(item);
  }, [closeMobileNavigationIfNeeded, handleOpenRenameFolderDialog]);
  const handleDeleteFolderRequest = useCallback(async (item) => {
    closeMobileNavigationIfNeeded();
    await handleDeleteFolder(item);
  }, [closeMobileNavigationIfNeeded, handleDeleteFolder]);
  const handleToggleFavoriteFolderFromRail = useCallback(async (item) => {
    closeMobileNavigationIfNeeded();
    await handleToggleFavoriteFolder(item);
  }, [closeMobileNavigationIfNeeded, handleToggleFavoriteFolder]);

  const listPanel = (
    <Box
      data-testid="mail-list-panel"
      sx={{
        height: isMobile ? 0 : '100%',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        flex: '1 1 0%',
        display: 'flex',
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
          px: { xs: 1.2, md: 1.6 },
          py: { xs: 0.65, md: 1.15 },
          borderBottom: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: alpha(ui.panelBg, ui.isDark ? 0.98 : 0.94),
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
              <Typography
                variant="subtitle2"
                data-testid="mail-list-current-folder"
                sx={{ fontWeight: 800, minWidth: 0 }}
              >
                {viewMode === 'conversations' ? 'Диалоги' : currentFolderLabel}
              </Typography>
              <Chip
                size="small"
                label={Number(listData.total || 0)}
                sx={{ fontWeight: 800, bgcolor: ui.actionBg }}
              />
              {mailBackgroundRefreshing ? (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label="Обновляем..."
                  data-testid="mail-background-refresh-chip"
                />
              ) : null}
            </Stack>
            {advancedFiltersApplied?.folder_scope === 'all' || advancedFiltersActive ? (
              <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap sx={{ mt: 0.45 }}>
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
        loading={loading}
        loadingMore={loadingMore}
        selectedItems={selectedItems}
        selectedId={selectedId}
        density={mailPreferences?.density || 'comfortable'}
        showPreviewSnippets={Boolean(mailPreferences?.show_preview_snippets)}
        onPrefetchId={undefined}
        onSelectId={async (value, item) => {
          const nextId = String(value || '');
          if (isMobile && viewMode === 'messages' && selectedMessageIds.length > 0) {
            setSelectedItems((prev) => (
              prev.includes(nextId)
                ? prev.filter((selectedItem) => selectedItem !== nextId)
                : [...prev, nextId]
            ));
            return;
          }
          const isDraftFolderSelection = (
            viewMode === 'messages'
            && String(folder || '').toLowerCase() === 'drafts'
            && Boolean(nextId)
          );
          if (isDraftFolderSelection) {
            setDetailLoading(true);
            try {
              const recentDetail = getRecentMessageDetailSnapshot(nextId);
              const draftDetail = recentDetail || await mailAPI.getMessage(nextId, { mailboxId: activeMailboxId });
              if (draftDetail) {
                setSelectedConversation(null);
                setSelectedMessage(draftDetail);
                openComposeFromDraftMessage(draftDetail);
              }
            } catch (requestError) {
              setError(getMailErrorDetail(requestError, 'Не удалось открыть черновик.'));
            } finally {
              setDetailLoading(false);
            }
            selectedIdRef.current = nextId;
            setSelectedId(nextId);
            setSelectedByMode((prev) => ({ ...(prev || {}), [viewMode]: nextId }));
            setMoveTarget('');
            closeMobileNavigationIfNeeded();
            return;
          }
          if (viewMode === 'messages') {
            saveCurrentListScrollPosition({ selectedMessageIdAtOpen: nextId });
            const sameMessageAlreadyOpen = (
              String(selectedIdRef.current || '') === nextId
              && String(selectedMessageRef.current?.id || '') === nextId
              && selectedMessageRef.current?.__previewOnly !== true
            );
            if (!sameMessageAlreadyOpen) {
              const recentDetail = getRecentMessageDetailSnapshot(nextId);
              const previewShell = recentDetail || createSelectedMessagePreviewShell(item, folder);
              if (!recentDetail) setDetailLoading(true);
              if (previewShell) {
                setSelectedConversation(null);
                setSelectedMessage(previewShell);
              }
              if (String(selectedIdRef.current || '') === nextId) {
                void revalidateSelectedMailDetail({ force: true });
              }
            }
          }
          selectedIdRef.current = nextId;
          setSelectedId(nextId);
          setSelectedByMode((prev) => ({ ...(prev || {}), [viewMode]: nextId }));
          setMoveTarget('');
          closeMobileNavigationIfNeeded();
        }}
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
  const previewContent = composeOpen && !isMobile ? (
    <Suspense fallback={null}>
      <MailComposeHost
        session={composeSession}
        layoutMode="desktop-inline"
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
        onCloseSession={() => setComposeSession(null)}
        onRegisterCloseHandler={(handler) => { composeCloseRequestRef.current = handler; }}
        onSendSuccess={handleComposeSent}
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
          showBackButton={readingPaneMode === 'off'}
          compactMobile={false}
          onBackToList={handleBackToList}
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
          }}
        />
      ) : null}
    </Box>
  ) : detailLoading ? (
    <Box sx={{ p: 2 }}><Skeleton variant="text" width="60%" /><Skeleton variant="rectangular" height={280} sx={{ mt: 1, borderRadius: '8px' }} /></Box>
  ) : !selectedMessage ? (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <MailOutlineIcon sx={{ fontSize: 58, color: 'text.disabled', mb: 1.2 }} />
      <Typography variant="body2" color="text.secondary">{viewMode === 'conversations' ? 'Выберите диалог' : 'Выберите письмо'}</Typography>
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
          showBackButton={readingPaneMode === 'off'}
          compactMobile={false}
          summarizeLoading={mailAiSummaryLoading}
          summarizeText={mailAiSummary}
          onSummarize={loadMailAiSummary}
          onCopySummary={handleCopyMailSummary}
          onBackToList={handleBackToList}
        />
      )}
      {viewMode === 'conversations' ? (
        <MailConversationReader
          conversation={selectedConversation}
          selectedMessage={selectedMessage}
          scrollRef={conversationScrollRef}
          ui={ui}
          isMobile={isMobile}
          quickReplyBody={quickReplyBody}
          quickReplySending={quickReplySending}
          onQuickReplyBodyChange={setQuickReplyBody}
          onSendQuickReply={() => sendQuickReply(selectedMessage)}
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
          <MailPreviewMobileReplySection
            quickReplyBody={quickReplyBody}
            quickReplySending={quickReplySending}
            quickReplyDisabled={folder === 'drafts'}
            onQuickReplyBodyChange={setQuickReplyBody}
            onSendQuickReply={handleQuickReplySend}
            onQuickReplyFocus={loadMailAiSmartReplies}
            smartReplySuggestions={mailAiSmartReplies}
            smartReplyLoading={mailAiSmartRepliesLoading}
            onSmartReplySelect={handleSmartReplySelect}
          />
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
          }}
        />
      ) : null}
    </Box>
  );
  const previewPanel = (
    <Box
      data-testid="mail-preview-panel"
      sx={{
        flex: '1 1 0%',
        minHeight: 0,
        minWidth: 0,
        width: '100%',
        maxWidth: '100%',
        display: isMobile && !selectedId ? 'none' : 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: ui.panelBg,
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
        bgcolor: ui.panelBg,
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
        gridTemplateColumns: {
          xs: '1fr',
          md: 'minmax(180px, min(var(--mail-folder-pane-width), 32%)) 7px minmax(280px, min(var(--mail-message-list-width), 46%)) 7px minmax(0, 1fr)',
        },
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: ui.panelBg,
      }}
    >
      {renderFolderRail}
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
      {listPanel}
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
        gridTemplateColumns: { xs: '1fr', md: 'minmax(180px, min(var(--mail-folder-pane-width), 32%)) 7px minmax(0, 1fr)' },
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: ui.panelBg,
      }}
    >
      {renderFolderRail}
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
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        minHeight: 0,
        borderRadius: '16px',
        border: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: ui.panelBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 2, md: 3 },
      }}
    >
      <Stack spacing={1.4} sx={{ maxWidth: 540, width: '100%' }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {mailConfigLoading
            ? 'Проверяем доступ к почте...'
            : mailRequiresRelogin
              ? (canSaveMailForAllDevices ? 'Сохраните пароль корпоративной почты' : 'Для доступа к почте войдите заново')
              : 'Требуется корпоративный пароль'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {mailRequiresRelogin
            ? (
              canSaveMailForAllDevices
                ? 'Текущая веб-сессия не может автоматически открыть Exchange. Сохраните пароль один раз, и этот ящик будет доступен на этом и других ваших устройствах.'
                : 'Текущая веб-сессия больше не может автоматически подтвердить доступ к Exchange. Выйдите и войдите заново.'
            )
            : mailCredentialsReason === 'expired'
              ? 'Пароль от корпоративного компьютера изменился. Логин сохранён — введите только новый пароль от Windows.'
              : 'При первом входе в раздел Почта нужно один раз подтвердить логин и пароль от корпоративного компьютера. После этого почта откроется без повторного ввода.'}
        </Typography>
        {!mailRequiresRelogin || canSaveMailForAllDevices ? (
          <>
            <Alert severity="info" sx={{ borderRadius: ui.radiusMd }}>
              {MAIL_COMPUTER_PASSWORD_HINT}
            </Alert>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Chip size="small" variant="outlined" label={`Логин: ${mailCredentialsLogin || mailboxInfo?.effective_mailbox_login || 'не указан'}`} />
              <Chip size="small" variant="outlined" label={`Ящик: ${mailCredentialsEmail || mailboxInfo?.mailbox_email || 'не указан'}`} />
            </Stack>
            <Box>
              <Button
                variant="contained"
                disabled={mailConfigLoading}
                onClick={() => openMailCredentialsDialog(mailboxInfo, { reason: canSaveMailForAllDevices ? 'shared' : 'missing' })}
              >
                {canSaveMailForAllDevices ? 'Сохранить пароль для всех устройств' : 'Ввести пароль'}
              </Button>
            </Box>
          </>
        ) : null}
      </Stack>
    </Paper>
  );
  const hasHydratedMailScreen = Boolean(
    mailboxInfo
    || (Array.isArray(folderTree) && folderTree.length > 0)
    || (Array.isArray(listData?.items) && listData.items.length > 0)
  );
  const showRecentMailFallback = Boolean(
    !mailRequiresPassword
    && !mailRequiresRelogin
    && !mailboxInfo
    && recentHydratedScope === mailCacheScope
    && hasHydratedMailScreen
  );
  const canRenderMailArea = Boolean(mailAccessReady || showRecentMailFallback);
  const showInitialMailLoading = Boolean(
    !mailRequiresPassword
    && !mailRequiresRelogin
    && !hasHydratedMailScreen
    && (mailConfigLoading || loading)
  );
  const showQuotasSection = canQuotasRead && mailShellSection === 'quotas';
  const showSearchToolbar = !showQuotasSection && (!isMobile || !hasMobileSelection) && !showInitialMailLoading;
  const showPageChrome = !isMobileFullscreenPreview;
  const mailHeaderTabs = canQuotasRead && !isMobileFullscreenPreview ? (
    <MailSectionTabs
      value={mailShellSection}
      onChange={handleMailShellSectionChange}
    />
  ) : null;

  return (
    <MainLayout
      contentMode={isMobile ? 'edge-to-edge-mobile' : 'default'}
      mobileBottomNavMode={isMobileFullscreenPreview ? 'hidden' : 'auto'}
    >
      <PageShell
        fullHeight={!isMobile}
        sx={{
          ...getMailUiFontScopeSx(),
          flex: '1 1 0%',
          height: isMobile ? 0 : undefined,
          gap: 0,
          minHeight: 0,
          minWidth: 0,
          position: 'relative',
          overflow: 'hidden',
          bgcolor: isMobileFullscreenPreview ? ui.panelBg : 'transparent',
          '--mail-shell-bg': ui.panelBg,
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
        {showPageChrome && showSearchToolbar ? (
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
            currentFolderLabel={currentFolderLabel}
            hasActiveFilters={hasActiveFilters}
            mobile={isMobile}
            mobileHeaderTabs={isMobile && !isMobileFullscreenPreview ? mailHeaderTabs : null}
            sectionTabs={!isMobile && !isMobileFullscreenPreview ? mailHeaderTabs : null}
            loading={loading}
            searchInputRef={searchInputRef}
          />
        ) : null}

        <Drawer
          anchor="left"
          open={isMobile && mobileNavigationOpen}
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

        <MailToolsMenu
          anchorEl={toolsAnchorEl}
          open={Boolean(toolsAnchorEl)}
          onClose={() => setToolsAnchorEl(null)}
          onOpenViewSettings={() => {
            setMailPreferencesDraft(mailPreferences);
            setMailPreferencesOpen(true);
          }}
          onMarkAllRead={handleMarkAllRead}
          mobile={isMobile}
        />

        {showQuotasSection ? (
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {mailHeaderTabs ? (
              <Box
                className="mail-safe-top"
                data-testid="mail-quotas-section-header"
                sx={{
                  px: 1,
                  py: 0.75,
                  bgcolor: ui.panelBg,
                  borderBottom: '1px solid',
                  borderColor: ui.borderSoft,
                  flexShrink: 0,
                }}
              >
                {mailHeaderTabs}
              </Box>
            ) : null}
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', p: { xs: 0.5, md: 1 } }}>
              <MailQuotaReport isMobile={isMobile} />
            </Box>
          </Box>
        ) : showInitialMailLoading ? (
          <MailInitialLoadingState ui={ui} />
        ) : (
          canRenderMailArea ? mainMailArea : mailCredentialsPanel
        )}

        {canRenderMailArea && !showQuotasSection && !isMobileFullscreenPreview && !composeOpen ? (
          <IconButton
            data-testid="mail-compose-fab"
            data-mobile-bulk-offset={isMobile && selectedMessageIds.length > 0 ? 'true' : 'false'}
            aria-label="Написать письмо"
            onClick={openCompose}
            sx={{
              position: 'fixed',
              right: { xs: 16, md: 24 },
              bottom: {
                xs: getMailMobileFabBottomOffset(ui, { bulkActive: selectedMessageIds.length > 0 }),
                md: 28,
              },
              width: 58,
              height: 58,
              borderRadius: ui.radius.round,
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              boxShadow: '0 18px 40px rgba(37, 99, 235, 0.28)',
              zIndex: 14,
              '&:hover': {
                bgcolor: theme.palette.primary.dark,
              },
            }}
          >
            <EditRoundedIcon />
          </IconButton>
        ) : null}

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
          onClose={() => setMailPreferencesOpen(false)}
          onChange={(key, value) => setMailPreferencesDraft((prev) => ({ ...(prev || {}), [key]: value }))}
          onSave={handleSaveMailPreferences}
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

        <Dialog open={mailCredentialsOpen} maxWidth="xs" fullWidth disableEscapeKeyDown PaperProps={{ sx: getMailDialogPaperSx(ui) }}>
          <DialogTitle sx={getMailDialogTitleSx(ui)}>
            {mailCredentialsReason === 'expired'
              ? 'Обновите корпоративный пароль'
              : mailCredentialsReason === 'shared'
                ? 'Сохраните пароль для всех устройств'
                : 'Введите корпоративный пароль'}
          </DialogTitle>
          <DialogContent dividers sx={getMailDialogContentSx(ui)}>
            <Stack spacing={1.3} sx={{ mt: 0.5 }}>
              <Alert severity={mailCredentialsReason === 'expired' ? 'warning' : 'info'} sx={{ borderRadius: ui.radiusMd }}>
                {mailCredentialsReason === 'expired'
                  ? 'Exchange больше не принимает сохранённый пароль. Введите новый пароль от корпоративного компьютера — тот же, что вы используете для входа в Windows.'
                  : mailCredentialsReason === 'shared'
                    ? 'После успешной проверки логин и пароль сохранятся в вашем профиле, и этот ящик будет работать на всех ваших устройствах.'
                    : 'После успешной проверки логин и пароль будут сохранены и почта откроется без повторного ввода.'}
              </Alert>
              <Alert severity="info" sx={{ borderRadius: ui.radiusMd }}>
                {MAIL_COMPUTER_PASSWORD_HINT}
              </Alert>
              <TextField
                fullWidth
                size="small"
                label="Логин Exchange"
                value={mailCredentialsLogin}
                onChange={(event) => setMailCredentialsLogin(event.target.value)}
                placeholder={mailboxInfo?.effective_mailbox_login || 'username@zsgp.corp'}
              />
              <TextField
                fullWidth
                size="small"
                label="Почта Exchange"
                value={mailCredentialsEmail}
                onChange={(event) => setMailCredentialsEmail(event.target.value)}
                placeholder={mailboxInfo?.mailbox_email || ''}
              />
              <TextField
                fullWidth
                size="small"
                type="password"
                label={MAIL_COMPUTER_PASSWORD_LABEL}
                helperText={MAIL_COMPUTER_PASSWORD_HELPER}
                value={mailCredentialsPassword}
                onChange={(event) => setMailCredentialsPassword(event.target.value)}
                autoFocus
              />
              {mailCredentialsError ? <Alert severity="error" sx={{ borderRadius: ui.radiusMd }}>{mailCredentialsError}</Alert> : null}
            </Stack>
          </DialogContent>
          <DialogActions sx={getMailDialogActionsSx(ui)}>
            <Button variant="contained" onClick={handleSaveMailCredentials} disabled={mailCredentialsSaving}>
              {mailCredentialsSaving ? 'Проверяем...' : 'Сохранить и открыть почту'}
            </Button>
          </DialogActions>
        </Dialog>

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
              onCloseSession={() => setComposeSession(null)}
              onRegisterCloseHandler={(handler) => { composeCloseRequestRef.current = handler; }}
              onSendSuccess={handleComposeSent}
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
