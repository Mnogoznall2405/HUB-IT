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
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
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
  getMailRecentMessageDetail,
  writeMailRecentBootstrap,
  writeMailRecentList,
  writeMailRecentMessageDetail,
} from '../lib/mailRecentCache';
import MailBulkActionBar from '../components/mail/MailBulkActionBar';
import MailAttachmentCard from '../components/mail/MailAttachmentCard';
import MailFolderRail from '../components/mail/MailFolderRail';
import MailInitialLoadingState from '../components/mail/MailInitialLoadingState';
import MailMessageList from '../components/mail/MailMessageList';
import MailPreviewHeader from '../components/mail/MailPreviewHeader';
import MailShortcutHelpDialog from '../components/mail/MailShortcutHelpDialog';
import MailToolbar from '../components/mail/MailToolbar';
import MailToolsMenu from '../components/mail/MailToolsMenu';
import MailViewSettingsDialog from '../components/mail/MailViewSettingsDialog';
import { buildRenderedMailHtml, filterVisibleMailAttachments } from '../components/mail/mailHtmlContent';
import { normalizeComposeSubject } from '../components/mail/mailComposeSubject';
import {
  buildMailUiTokens,
  getMailDialogActionsSx,
  getMailDialogContentSx,
  getMailDialogPaperSx,
  getMailDialogTitleSx,
  getMailUiFontScopeSx,
} from '../components/mail/mailUiTokens';
import { formatMailPersonWithEmail, getMailPersonDisplay, getMailPersonEmail } from '../components/mail/mailPeople';
import { mergeQuotedHistoryHtml, splitQuotedHistoryHtml } from '../components/mail/mailQuotedHistory';

const loadMailComposeDialog = () => import('../components/mail/MailComposeDialog');
const MailComposeDialog = lazy(loadMailComposeDialog);
const MailAttachmentPreviewDialog = lazy(() => import('../components/mail/MailAttachmentPreviewDialog'));
const MailAdvancedSearchDialog = lazy(() => import('../components/mail/MailAdvancedSearchDialog'));
const MailHeadersDialog = lazy(() => import('../components/mail/MailHeadersDialog'));
const MailSignatureDialog = lazy(() => import('../components/mail/MailSignatureDialog'));
const MailTemplatesDialog = lazy(() => import('../components/mail/MailTemplatesDialog'));

const MAIL_ACTIVE_REFRESH_INTERVAL_MS = 90000;
const MAIL_VIEW_REFRESH_COOLDOWN_MS = 4000;
const MAIL_SWR_STALE_TIME_MS = 45000;
const MAIL_DETAIL_SWR_STALE_TIME_MS = 120000;
const MAIL_FOLDER_SUMMARY_REFRESH_COOLDOWN_MS = 120000;
const MAIL_AUTO_READ_GUARD_TTL_MS = 120000;
const MAIL_DETAIL_PREFETCH_LIMIT = 0;
const MAIL_DETAIL_PREFETCH_COOLDOWN_MS = 600000;
const MAIL_MOBILE_EDGE_SWIPE_ZONE_PX = 24;
const MAIL_MOBILE_EDGE_SWIPE_LOCK_PX = 10;
const MAIL_MOBILE_EDGE_SWIPE_CLOSE_THRESHOLD_PX = 72;
const MAIL_MOBILE_EDGE_SWIPE_FLING_VELOCITY_PX_MS = 0.35;
const MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS = 180;
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
const MAIL_MOBILE_HISTORY_FLAG = '__hubMailMobileShell';
const MAIL_MOBILE_HISTORY_VIEW_KEY = '__hubMailMobileShellView';
const MAIL_MOBILE_HISTORY_DRAWER_KEY = '__hubMailMobileShellDrawer';
const MAIL_MOBILE_HISTORY_MESSAGE_KEY = '__hubMailMobileShellMessageId';
const MAIL_MOBILE_HISTORY_MODE_KEY = '__hubMailMobileShellMode';
const MAX_PREVIEW_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const COMPOSE_DRAFT_STORAGE_KEY = 'mail_compose_draft_v2';
const MAIL_RECENT_SEARCHES_KEY = 'mail_recent_searches_v1';
const MAIL_VIEW_STATE_STORAGE_KEY = 'mail_view_state_v1';
const MAIL_LIST_VIEW_STATE_STORAGE_KEY = 'mail_list_view_state_v1';
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
  density: 'comfortable',
  show_preview_snippets: true,
  show_favorites_first: true,
};

const DEFAULT_ADVANCED_FILTERS = {
  q: '',
  from_filter: '',
  to_filter: '',
  subject_filter: '',
  body_filter: '',
  importance: '',
  folder_scope: 'current',
};

const EDGE_GESTURE_INTERACTIVE_SELECTOR = [
  'a',
  'button',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[role="link"]',
  '[contenteditable="true"]',
].join(', ');

const isElementMatchingSelector = (element, selector) => {
  if (!element || typeof element.closest !== 'function') return false;
  return Boolean(element.closest(selector));
};

const shouldBlockMailEdgeGestureTarget = (target, { blockTableScroll = false } = {}) => {
  if (!target || typeof target !== 'object') return false;
  if (isElementMatchingSelector(target, EDGE_GESTURE_INTERACTIVE_SELECTOR)) return true;
  if (blockTableScroll && isElementMatchingSelector(target, '[data-mail-table-scroll="true"]')) return true;
  return false;
};

const createEmptyListData = () => ({
  items: [],
  total: 0,
  offset: 0,
  limit: 50,
  has_more: false,
  next_offset: null,
  append_offset: null,
  loaded_pages: 0,
  search_limited: false,
  searched_window: 0,
});

const createSelectedMessagePreviewShell = (item, folder = 'inbox') => {
  if (!item || typeof item !== 'object') return null;
  const messageId = String(item?.id || '').trim();
  if (!messageId) return null;
  const bodyPreview = String(item?.body_preview || '').trim();
  return {
    id: messageId,
    exchange_id: String(item?.exchange_id || ''),
    folder: String(item?.folder || folder || 'inbox'),
    subject: String(item?.subject || ''),
    sender: String(item?.sender || ''),
    sender_person: item?.sender_person || null,
    sender_name: item?.sender_name || '',
    sender_email: item?.sender_email || '',
    sender_display: item?.sender_display || '',
    to: [],
    to_people: [],
    cc: [],
    cc_people: [],
    bcc: [],
    bcc_people: [],
    received_at: item?.received_at || null,
    is_read: Boolean(item?.is_read),
    body_html: '',
    body_text: bodyPreview,
    importance: String(item?.importance || 'normal'),
    categories: Array.isArray(item?.categories) ? item.categories : [],
    reminder_is_set: false,
    reminder_due_by: null,
    internet_message_id: null,
    conversation_id: String(item?.conversation_id || ''),
    restore_hint_folder: null,
    attachments: [],
    compose_context: null,
    draft_context: null,
    has_external_images: false,
    can_archive: String(item?.folder || folder || 'inbox') !== 'archive',
    can_move: true,
    __previewOnly: true,
  };
};

const escapeMailPlainText = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const mailPlainTextToHtml = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return `<div>${escapeMailPlainText(text).replace(/\r\n|\r|\n/g, '<br />')}</div>`;
};

const getMessageBodyHtmlSource = (message) => {
  const bodyHtml = String(message?.body_html || '').trim();
  if (bodyHtml) return bodyHtml;
  return mailPlainTextToHtml(message?.body_text);
};

const hasMessageBodyContent = (message) => Boolean(
  String(message?.body_html || '').trim()
  || String(message?.body_text || '').trim()
);

const mergeMessageDetailPreservingBody = (nextMessage, previousMessage) => {
  if (!nextMessage || typeof nextMessage !== 'object') return nextMessage;
  if (!previousMessage || typeof previousMessage !== 'object') return nextMessage;
  if (String(nextMessage?.id || '') !== String(previousMessage?.id || '')) return nextMessage;
  if (hasMessageBodyContent(nextMessage) || !hasMessageBodyContent(previousMessage)) return nextMessage;
  return {
    ...nextMessage,
    body_html: previousMessage.body_html || '',
    body_text: previousMessage.body_text || '',
    attachments: Array.isArray(nextMessage.attachments) && nextMessage.attachments.length > 0
      ? nextMessage.attachments
      : (Array.isArray(previousMessage.attachments) ? previousMessage.attachments : []),
  };
};

const normalizeMailViewMode = (value) => (value === 'conversations' ? 'conversations' : 'messages');
const normalizeMailboxId = (value) => String(value || '').trim();
const getMailboxEntryId = (value) => normalizeMailboxId(value?.id || value?.mailbox_id);

const normalizeMailViewState = (value = {}) => ({
  folder: String(value?.folder || 'inbox').trim().toLowerCase() || 'inbox',
  viewMode: normalizeMailViewMode(value?.viewMode),
  search: String(value?.search || ''),
  unreadOnly: Boolean(value?.unreadOnly),
  hasAttachmentsOnly: Boolean(value?.hasAttachmentsOnly),
  filterDateFrom: String(value?.filterDateFrom || ''),
  filterDateTo: String(value?.filterDateTo || ''),
  advancedFiltersApplied: {
    ...DEFAULT_ADVANCED_FILTERS,
    ...((value?.advancedFiltersApplied && typeof value.advancedFiltersApplied === 'object')
      ? value.advancedFiltersApplied
      : {}),
  },
});

const buildMailViewStateStorageKey = (mailboxId = '') => (
  `${MAIL_VIEW_STATE_STORAGE_KEY}:${normalizeMailboxId(mailboxId) || 'default'}`
);

const readStoredMailViewState = (mailboxId = '') => {
  if (typeof window === 'undefined') return normalizeMailViewState();
  const normalizedMailboxId = normalizeMailboxId(mailboxId);
  const candidateKeys = normalizedMailboxId
    ? [
        buildMailViewStateStorageKey(normalizedMailboxId),
        MAIL_VIEW_STATE_STORAGE_KEY,
        buildMailViewStateStorageKey('default'),
      ]
    : [
        MAIL_VIEW_STATE_STORAGE_KEY,
        buildMailViewStateStorageKey('default'),
      ];
  try {
    for (const storageKey of candidateKeys) {
      const raw = window.sessionStorage.getItem(storageKey);
      if (!raw) continue;
      return normalizeMailViewState(JSON.parse(raw));
    }
    return normalizeMailViewState();
  } catch {
    return normalizeMailViewState();
  }
};

const buildMailRoute = ({ folder = 'inbox', messageId = '', mailboxId = '' } = {}) => {
  const params = new URLSearchParams();
  const normalizedFolder = String(folder || 'inbox').trim().toLowerCase() || 'inbox';
  params.set('folder', normalizedFolder);
  const normalizedMessageId = String(messageId || '').trim();
  const normalizedMailboxId = normalizeMailboxId(mailboxId);
  if (normalizedMessageId) params.set('message', normalizedMessageId);
  if (normalizedMailboxId) params.set('mailbox_id', normalizedMailboxId);
  return `/mail?${params.toString()}`;
};

const buildFallbackMailboxEntry = (mailbox) => {
  if (!mailbox || typeof mailbox !== 'object') return null;
  const mailboxId = getMailboxEntryId(mailbox);
  if (!mailboxId) return null;
  return {
    id: mailboxId,
    label: mailbox?.label || mailbox?.mailbox_email || mailbox?.effective_mailbox_login || 'Почтовый ящик',
    mailbox_email: mailbox?.mailbox_email || '',
    mailbox_login: mailbox?.mailbox_login || '',
    effective_mailbox_login: mailbox?.effective_mailbox_login || '',
    auth_mode: mailbox?.auth_mode || mailbox?.mail_auth_mode || 'stored_credentials',
    is_primary: Boolean(mailbox?.is_primary),
    is_active: mailbox?.is_active !== false,
    unread_count: Number(mailbox?.unread_count || 0),
    unread_count_state: normalizeUnreadCountState(mailbox?.unread_count_state || 'deferred'),
    last_selected_at: mailbox?.last_selected_at || null,
    selected: true,
  };
};

const normalizeUnreadCountState = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'fresh' || normalized === 'stale') return normalized;
  return 'deferred';
};

const mergeMailboxEntries = (entries, selectedMailbox = null, existingEntries = []) => {
  const existingById = new Map(
    (Array.isArray(existingEntries) ? existingEntries : [])
      .map((entry) => [getMailboxEntryId(entry), entry])
      .filter(([mailboxId]) => Boolean(mailboxId))
  );
  const result = [];
  const seen = new Set();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const mailboxId = getMailboxEntryId(entry);
    if (!mailboxId || seen.has(mailboxId)) return;
    seen.add(mailboxId);
    const existingEntry = existingById.get(mailboxId) || null;
    const nextUnreadState = normalizeUnreadCountState(entry?.unread_count_state);
    const existingUnreadState = normalizeUnreadCountState(existingEntry?.unread_count_state);
    const preserveFreshUnread = existingUnreadState === 'fresh' && nextUnreadState !== 'fresh';
    result.push({
      ...(existingEntry || {}),
      ...entry,
      id: mailboxId,
      unread_count: preserveFreshUnread
        ? Number(existingEntry?.unread_count || 0)
        : Number((entry?.unread_count ?? existingEntry?.unread_count) || 0),
      unread_count_state: preserveFreshUnread ? existingUnreadState : nextUnreadState,
      is_active: entry?.is_active !== false,
      is_primary: Boolean(entry?.is_primary),
    });
  });
  const fallback = buildFallbackMailboxEntry(selectedMailbox);
  if (fallback && !seen.has(fallback.id)) {
    const existingFallback = existingById.get(fallback.id) || null;
    const existingUnreadState = normalizeUnreadCountState(existingFallback?.unread_count_state);
    const preserveFreshUnread = existingUnreadState === 'fresh'
      && normalizeUnreadCountState(fallback?.unread_count_state) !== 'fresh';
    result.unshift({
      ...(existingFallback || {}),
      ...fallback,
      unread_count: preserveFreshUnread
        ? Number(existingFallback?.unread_count || 0)
        : Number((fallback?.unread_count ?? existingFallback?.unread_count) || 0),
      unread_count_state: preserveFreshUnread
        ? existingUnreadState
        : normalizeUnreadCountState(fallback?.unread_count_state),
    });
  }
  return result;
};

const normalizeMailListViewContextState = (value) => ({
  scrollTop: Math.max(0, Number(value?.scrollTop || 0)),
  selectedMessageIdAtOpen: String(value?.selectedMessageIdAtOpen || ''),
});

const readStoredMailListViewState = () => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(MAIL_LIST_VIEW_STATE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.entries(parsed).reduce((acc, [key, value]) => {
      const normalizedKey = String(key || '');
      if (!normalizedKey) return acc;
      acc[normalizedKey] = normalizeMailListViewContextState(value);
      return acc;
    }, {});
  } catch {
    return {};
  }
};

const buildMailBootstrapCacheKey = ({ scope, limit = MAIL_BOOTSTRAP_LIMIT }) => ['mail', scope, 'bootstrap', Number(limit || MAIL_BOOTSTRAP_LIMIT)];
const buildMailFolderSummaryCacheKey = ({ scope }) => ['mail', scope, 'folder-summary'];
const buildMailFolderTreeCacheKey = ({ scope }) => ['mail', scope, 'folder-tree'];

const buildMailListCacheKey = ({
  scope,
  folder,
  viewMode,
  q,
  unreadOnly,
  hasAttachmentsOnly,
  dateFrom,
  dateTo,
  folderScope,
  fromFilter,
  toFilter,
  subjectFilter,
  bodyFilter,
  importance,
  limit,
  offset,
}) => [
  'mail',
  scope,
  'list',
  normalizeMailViewMode(viewMode),
  String(folder || 'inbox').trim().toLowerCase() || 'inbox',
  String(q || ''),
  unreadOnly ? 1 : 0,
  hasAttachmentsOnly ? 1 : 0,
  String(dateFrom || ''),
  String(dateTo || ''),
  String(folderScope || 'current'),
  String(fromFilter || ''),
  String(toFilter || ''),
  String(subjectFilter || ''),
  String(bodyFilter || ''),
  String(importance || ''),
  Number(limit || 50),
  Number(offset || 0),
];

const buildMailMessageDetailCacheKey = ({ scope, messageId }) => [
  'mail',
  scope,
  'message-detail',
  String(messageId || ''),
];

const buildMailConversationDetailCacheKey = ({ scope, conversationId, folder, folderScope }) => [
  'mail',
  scope,
  'conversation-detail',
  String(conversationId || ''),
  String(folder || 'inbox').trim().toLowerCase() || 'inbox',
  String(folderScope || 'current'),
];

const normalizeMailListResponse = (payload = {}, fallbackItems = []) => ({
  items: Array.isArray(payload?.items) ? payload.items : fallbackItems,
  total: Number(payload?.total || fallbackItems.length || 0),
  offset: Number(payload?.offset || 0),
  limit: Number(payload?.limit || 50),
  has_more: Boolean(payload?.has_more),
  next_offset: payload?.next_offset ?? null,
  append_offset: payload?.append_offset ?? payload?.next_offset ?? null,
  loaded_pages: Math.max(
    0,
    Number(
      payload?.loaded_pages
      || ((Array.isArray(payload?.items) ? payload.items.length : fallbackItems.length) > 0 ? 1 : 0)
    )
  ),
  search_limited: Boolean(payload?.search_limited),
  searched_window: Number(payload?.searched_window || 0),
});

const getMailListItemKey = (item, viewMode = 'messages') => String(
  viewMode === 'conversations'
    ? (item?.conversation_id || item?.id || '')
    : (item?.id || '')
).trim();

const dedupeMailListItems = (items = [], viewMode = 'messages') => {
  const result = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = getMailListItemKey(item, viewMode);
    if (!key) {
      result.push(item);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
};

const isExpandedMailListData = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  const itemsCount = Array.isArray(source.items) ? source.items.length : 0;
  const limit = Math.max(1, Number(source.limit || 50));
  return Number(source.loaded_pages || 0) > 1 || itemsCount > limit;
};

const buildMailListState = ({
  previousListData,
  nextListData,
  updateMode = 'replace',
  selectionMode = 'messages',
} = {}) => {
  const previous = normalizeMailListResponse(
    previousListData,
    Array.isArray(previousListData?.items) ? previousListData.items : []
  );
  const incoming = normalizeMailListResponse(
    nextListData,
    Array.isArray(nextListData?.items) ? nextListData.items : []
  );
  const limit = Math.max(1, Number(incoming.limit || previous.limit || 50));

  if (updateMode === 'append') {
    const items = dedupeMailListItems([...(previous.items || []), ...(incoming.items || [])], selectionMode);
    const total = Math.max(Number(incoming.total || previous.total || items.length), items.length);
    const loadedPages = Math.max(
      Number(previous.loaded_pages || 0) + 1,
      items.length > 0 ? Math.ceil(items.length / limit) : 0
    );
    const nextAppendOffset = incoming.append_offset ?? incoming.next_offset ?? previous.append_offset ?? previous.next_offset ?? null;
    const hasMore = total > items.length && nextAppendOffset !== null;
    return normalizeMailListResponse({
      ...incoming,
      items,
      total,
      offset: 0,
      has_more: hasMore,
      next_offset: incoming.next_offset ?? null,
      append_offset: hasMore ? nextAppendOffset : null,
      loaded_pages: loadedPages,
    }, items);
  }

  if (updateMode === 'head-merge') {
    const total = Math.max(0, Number(incoming.total || previous.total || 0));
    const mergedItems = dedupeMailListItems([...(incoming.items || []), ...(previous.items || [])], selectionMode);
    const items = total > 0 && mergedItems.length > total ? mergedItems.slice(0, total) : mergedItems;
    const loadedPages = Math.max(
      Number(previous.loaded_pages || 0),
      items.length > 0 ? Math.ceil(items.length / limit) : 0
    );
    const nextAppendOffset = previous.append_offset ?? previous.next_offset ?? incoming.append_offset ?? incoming.next_offset ?? null;
    const hasMore = Math.max(total, items.length) > items.length && nextAppendOffset !== null;
    return normalizeMailListResponse({
      ...incoming,
      items,
      total: Math.max(total, items.length),
      offset: 0,
      has_more: hasMore,
      next_offset: incoming.next_offset ?? null,
      append_offset: hasMore ? nextAppendOffset : null,
      loaded_pages: loadedPages,
    }, items);
  }

  return normalizeMailListResponse(nextListData, Array.isArray(nextListData?.items) ? nextListData.items : []);
};

const TEMPLATE_FIELD_TYPES = [
  { value: 'text', label: 'Текст' },
  { value: 'textarea', label: 'Многострочный текст' },
  { value: 'select', label: 'Список' },
  { value: 'multiselect', label: 'Множественный список' },
  { value: 'date', label: 'Дата' },
  { value: 'checkbox', label: 'Флаг' },
  { value: 'email', label: 'Email' },
  { value: 'tel', label: 'Телефон' },
];

const createEmptyAttachmentPreview = () => ({
  open: false,
  loading: false,
  error: '',
  filename: '',
  contentType: '',
  kind: 'unsupported',
  objectUrl: '',
  textContent: '',
  textTruncated: false,
  tooLargeForPreview: false,
  blob: null,
});

const formatTime = (isoStr) => {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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

const formatConversationDay = (isoStr) => {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
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

const parseDownloadFilename = (contentDisposition, fallbackName = 'attachment.bin') => {
  const source = String(contentDisposition || '');
  const utf8Match = source.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // ignore
    }
  }
  const simpleMatch = source.match(/filename=\"([^\"]+)\"/i) || source.match(/filename=([^;]+)/i);
  return simpleMatch?.[1] ? String(simpleMatch[1]).trim() : String(fallbackName || 'attachment.bin');
};

const shouldPreferBlobOpenFallback = () => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const displayModeStandalone = typeof window.matchMedia === 'function'
    ? Boolean(window.matchMedia('(display-mode: standalone)').matches)
    : false;
  const iosStandalone = Boolean(window.navigator?.standalone);
  const userAgent = String(window.navigator?.userAgent || '');
  const isiOS = /iPad|iPhone|iPod/.test(userAgent)
    || (window.navigator?.platform === 'MacIntel' && Number(window.navigator?.maxTouchPoints || 0) > 1);
  return Boolean((displayModeStandalone || iosStandalone) && isiOS);
};

const downloadBlobFile = (blob, filename, { preferOpenFallback = false } = {}) => {
  const url = window.URL.createObjectURL(blob);
  const useOpenFallback = Boolean(preferOpenFallback) && shouldPreferBlobOpenFallback();
  if (useOpenFallback) {
    const popup = window.open(url, '_blank', 'noopener,noreferrer');
    if (popup) {
      window.setTimeout(() => {
        window.URL.revokeObjectURL(url);
      }, 60_000);
      return;
    }
  }
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'attachment.bin');
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
};

const MAIL_ATTACHMENT_CONTEXT_MISSING_CODE = 'MAIL_ATTACHMENT_CONTEXT_MISSING';

const buildAttachmentContextError = ({ attachment, messageId, mailboxId }) => {
  const attachmentName = String(attachment?.name || 'вложение').trim() || 'вложение';
  const error = new Error(
    !messageId
      ? 'Не удалось определить письмо для скачивания вложения.'
      : `Вложение "${attachmentName}" пришло без идентификатора для скачивания.`
  );
  error.code = MAIL_ATTACHMENT_CONTEXT_MISSING_CODE;
  error.attachment = {
    name: attachmentName,
    content_type: String(attachment?.content_type || '').trim(),
    size: Number(attachment?.size || 0),
    id: String(attachment?.id || '').trim(),
    download_token: String(attachment?.download_token || '').trim(),
    mailbox_id: String(mailboxId || '').trim(),
    message_id: String(messageId || '').trim(),
  };
  return error;
};

const readBlobAsText = (blob) => new Promise((resolve, reject) => {
  if (!blob || typeof FileReader === 'undefined') {
    resolve('');
    return;
  }
  try {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob payload.'));
    reader.readAsText(blob);
  } catch (error) {
    reject(error);
  }
});

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

const normalizeRecipient = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/<([^>]+)>/);
  return String(match?.[1] || text).trim();
};

const toRecipientEmails = (values) => (
  Array.isArray(values)
    ? values
      .map((item) => (typeof item === 'string' ? item : item?.email || item?.name || ''))
      .map(normalizeRecipient)
      .filter(Boolean)
    : []
);

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
  || normalizeRecipient(value?.sender || '')
);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+$/.test(String(value || '').trim());

const normalizeTemplateFieldKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_.-]/g, '_')
  .replace(/_+/g, '_')
  .replace(/^_+|_+$/g, '');

const normalizeTemplateFieldOptions = (value) => {
  const raw = Array.isArray(value) ? value : String(value || '').split(/\r?\n|;/);
  const dedup = new Set();
  raw.forEach((item) => {
    const normalized = String(item || '').trim();
    if (normalized) dedup.add(normalized);
  });
  return Array.from(dedup);
};

const makeTemplateField = (index = 0) => ({
  key: `field_${index + 1}`,
  label: `Поле ${index + 1}`,
  type: 'text',
  required: true,
  placeholder: '',
  default_value: '',
  options: [],
});

const isListItemSame = (left, right, mode) => {
  if (mode === 'conversations') {
    return (
      String(left?.conversation_id || left?.id || '') === String(right?.conversation_id || right?.id || '')
      && Number(left?.unread_count || 0) === Number(right?.unread_count || 0)
      && Number(left?.messages_count || 0) === Number(right?.messages_count || 0)
      && String(left?.last_received_at || '') === String(right?.last_received_at || '')
      && Boolean(left?.has_attachments) === Boolean(right?.has_attachments)
      && String(left?.preview || '') === String(right?.preview || '')
    );
  }
  return (
    String(left?.id || '') === String(right?.id || '')
    && Boolean(left?.is_read) === Boolean(right?.is_read)
    && String(left?.received_at || '') === String(right?.received_at || '')
    && Boolean(left?.has_attachments) === Boolean(right?.has_attachments)
    && String(left?.subject || '') === String(right?.subject || '')
    && String(left?.body_preview || '') === String(right?.body_preview || '')
  );
};

const getComposeDialogTitle = (composeMode = 'new') => {
  if (composeMode === 'reply') return 'Ответ';
  if (composeMode === 'reply_all') return 'Ответ всем';
  if (composeMode === 'forward') return 'Пересылка';
  if (composeMode === 'draft') return 'Черновик';
  return 'Новое письмо';
};

const createComposeInitialState = (overrides = {}) => ({
  composeMode: String(overrides.composeMode || 'new'),
  composeFromMailboxId: String(overrides.composeFromMailboxId || ''),
  composeToValues: toRecipientEmails(overrides.composeToValues ?? overrides.to ?? []),
  composeCcValues: toRecipientEmails(overrides.composeCcValues ?? overrides.cc ?? []),
  composeBccValues: toRecipientEmails(overrides.composeBccValues ?? overrides.bcc ?? []),
  composeSubject: String(overrides.composeSubject ?? overrides.subject ?? ''),
  composeBody: String(overrides.composeBody ?? overrides.body ?? ''),
  composeQuotedOriginalHtml: String(overrides.composeQuotedOriginalHtml ?? overrides.quotedOriginalHtml ?? ''),
  composeFiles: Array.isArray(overrides.composeFiles) ? [...overrides.composeFiles] : [],
  composeDraftAttachments: Array.isArray(overrides.composeDraftAttachments ?? overrides.draftAttachments)
    ? [...(overrides.composeDraftAttachments ?? overrides.draftAttachments)]
    : [],
  composeFieldErrors: { ...(overrides.composeFieldErrors || {}) },
  composeError: String(overrides.composeError || ''),
  composeSending: Boolean(overrides.composeSending),
  composeDraftId: String(overrides.composeDraftId ?? overrides.draftId ?? ''),
  composeReplyToMessageId: String(overrides.composeReplyToMessageId ?? overrides.replyToMessageId ?? ''),
  composeForwardMessageId: String(overrides.composeForwardMessageId ?? overrides.forwardMessageId ?? ''),
  composeUploadProgress: Number(overrides.composeUploadProgress || 0),
  composeDragActive: Boolean(overrides.composeDragActive),
  draftSyncState: String(overrides.draftSyncState || 'idle'),
  draftSavedAt: String(overrides.draftSavedAt || ''),
  dismissedComposeWarnings: Array.isArray(overrides.dismissedComposeWarnings)
    ? overrides.dismissedComposeWarnings.map((value) => String(value || '')).filter(Boolean)
    : [],
});

const getComposeCombinedBody = (state) => mergeQuotedHistoryHtml(
  state?.composeBody || '',
  state?.composeQuotedOriginalHtml || '',
);

const composeStateHasContent = (state) => Boolean(
  toRecipientEmails(state?.composeToValues).length
  || toRecipientEmails(state?.composeCcValues).length
  || toRecipientEmails(state?.composeBccValues).length
  || String(state?.composeSubject || '').trim()
  || String(getComposeCombinedBody(state) || '').replace(/<[^>]*>/g, '').trim()
  || Array.isArray(state?.composeFiles) && state.composeFiles.length > 0
  || Array.isArray(state?.composeDraftAttachments) && state.composeDraftAttachments.length > 0
);

const readStoredComposeState = ({ composeDraftKey, resolveComposeMailboxId }) => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(composeDraftKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const quotedOriginalHtml = String(parsed.quoted_original_html || '');
    const splitBody = quotedOriginalHtml && Object.prototype.hasOwnProperty.call(parsed, 'editor_body')
      ? {
          primaryHtml: String(parsed.editor_body || ''),
          quotedHtml: quotedOriginalHtml,
        }
      : splitQuotedHistoryHtml(parsed.body || '');
    return createComposeInitialState({
      composeMode: String(parsed.compose_mode || 'draft'),
      composeFromMailboxId: resolveComposeMailboxId(parsed.from_mailbox_id || ''),
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc,
      subject: String(parsed.subject || ''),
      composeBody: String(splitBody?.primaryHtml || ''),
      composeQuotedOriginalHtml: String(splitBody?.quotedHtml || ''),
      draftAttachments: Array.isArray(parsed.draft_attachments) ? parsed.draft_attachments : [],
      draftId: String(parsed.draft_id || ''),
      replyToMessageId: String(parsed.reply_to_message_id || ''),
      forwardMessageId: String(parsed.forward_message_id || ''),
      draftSyncState: 'local_only',
      draftSavedAt: String(parsed.saved_at || ''),
    });
  } catch {
    return null;
  }
};

function MailComposeHost({
  session,
  layoutMode,
  activeMailboxId,
  composeFromOptions,
  composeDraftKey,
  resolveComposeMailboxId,
  mailboxPrimaryDomain,
  mailboxSignatureHtml,
  signatureOpen,
  signatureHtml,
  signatureMailboxId,
  formatFullDate,
  formatFileSize,
  sumFilesSize,
  sumAttachmentSize,
  onOpenSignatureEditor,
  onCloseSession,
  onRegisterCloseHandler,
  onSendSuccess,
  handleMailCredentialsRequired,
  getMailErrorDetail,
}) {
  const [composeState, setComposeState] = useState(() => createComposeInitialState(session?.initialState));
  const [composeToSearch, setComposeToSearch] = useState('');
  const [composeToOptions, setComposeToOptions] = useState([]);
  const [composeToLoading, setComposeToLoading] = useState(false);
  const composeStateRef = useRef(composeState);
  const composeUploadAbortRef = useRef(null);
  const mountedRef = useRef(true);
  const debouncedComposeToSearch = useDebounce(composeToSearch, 400);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (composeUploadAbortRef.current) {
        composeUploadAbortRef.current.abort();
        composeUploadAbortRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    composeStateRef.current = composeState;
  }, [composeState]);

  useEffect(() => {
    const nextState = createComposeInitialState(session?.initialState);
    if (composeUploadAbortRef.current) {
      composeUploadAbortRef.current.abort();
      composeUploadAbortRef.current = null;
    }
    setComposeState(nextState);
    setComposeToSearch('');
    setComposeToOptions([]);
    setComposeToLoading(false);
  }, [session?.id]);

  const patchComposeState = useCallback((updater) => {
    if (!mountedRef.current) return;
    setComposeState((prev) => {
      const patch = typeof updater === 'function' ? updater(prev) : updater;
      if (!patch || typeof patch !== 'object') return prev;
      return { ...prev, ...patch };
    });
  }, []);

  useEffect(() => {
    if (composeFromOptions.length === 0) return;
    patchComposeState((current) => {
      const normalizedCurrent = normalizeMailboxId(current.composeFromMailboxId);
      if (normalizedCurrent && composeFromOptions.some((item) => getMailboxEntryId(item) === normalizedCurrent)) {
        return null;
      }
      return {
        composeFromMailboxId: normalizeMailboxId(activeMailboxId || getMailboxEntryId(composeFromOptions[0])),
      };
    });
  }, [activeMailboxId, composeFromOptions, patchComposeState]);

  useEffect(() => {
    const query = String(debouncedComposeToSearch || '').trim();
    if (query.length < 2) {
      setComposeToOptions([]);
      return;
    }
    let active = true;
    setComposeToLoading(true);
    mailAPI.searchContacts(query, { mailboxId: activeMailboxId })
      .then((items) => {
        if (active) setComposeToOptions(Array.isArray(items) ? items : []);
      })
      .finally(() => {
        if (active) setComposeToLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeMailboxId, debouncedComposeToSearch]);

  useEffect(() => {
    const fieldErrors = composeState.composeFieldErrors || {};
    if (!fieldErrors.to && !fieldErrors.cc && !fieldErrors.bcc) return;
    const to = toRecipientEmails(composeState.composeToValues);
    const cc = toRecipientEmails(composeState.composeCcValues);
    const bcc = toRecipientEmails(composeState.composeBccValues);
    const nextErrors = { ...fieldErrors };
    let changed = false;
    if (nextErrors.to && to.length > 0 && to.every((value) => isValidEmail(value))) {
      delete nextErrors.to;
      changed = true;
    }
    if (nextErrors.cc && cc.every((value) => isValidEmail(value))) {
      delete nextErrors.cc;
      changed = true;
    }
    if (nextErrors.bcc && bcc.every((value) => isValidEmail(value))) {
      delete nextErrors.bcc;
      changed = true;
    }
    if (changed) {
      patchComposeState({ composeFieldErrors: nextErrors });
    }
  }, [
    composeState.composeBccValues,
    composeState.composeCcValues,
    composeState.composeFieldErrors,
    composeState.composeToValues,
    patchComposeState,
  ]);

  const composeCombinedBody = useMemo(
    () => getComposeCombinedBody(composeState),
    [composeState.composeBody, composeState.composeQuotedOriginalHtml]
  );

  const hasComposeContent = useMemo(
    () => composeStateHasContent(composeState),
    [
      composeState.composeBccValues,
      composeState.composeBody,
      composeState.composeCcValues,
      composeState.composeDraftAttachments,
      composeState.composeFiles,
      composeState.composeQuotedOriginalHtml,
      composeState.composeSubject,
      composeState.composeToValues,
    ],
  );

  const composeSignaturePreviewHtml = useMemo(() => {
    const composeMailboxId = resolveComposeMailboxId(composeState.composeFromMailboxId || activeMailboxId);
    const editingMailboxId = resolveComposeMailboxId(signatureMailboxId || composeState.composeFromMailboxId || activeMailboxId);
    if (signatureOpen && composeMailboxId && composeMailboxId === editingMailboxId) {
      return String(signatureHtml || '');
    }
    return String(mailboxSignatureHtml || '');
  }, [
    activeMailboxId,
    composeState.composeFromMailboxId,
    mailboxSignatureHtml,
    resolveComposeMailboxId,
    signatureHtml,
    signatureMailboxId,
    signatureOpen,
  ]);

  const composeWarnings = useMemo(() => {
    const recipientValues = [
      ...toRecipientEmails(composeState.composeToValues),
      ...toRecipientEmails(composeState.composeCcValues),
      ...toRecipientEmails(composeState.composeBccValues),
    ];
    const warnings = [];
    if (!String(composeState.composeSubject || '').trim()) {
      warnings.push({
        id: 'empty_subject',
        severity: 'warning',
        message: 'Тема письма пустая.',
      });
    }
    if (mailboxPrimaryDomain) {
      const hasExternal = recipientValues.some((email) => {
        const domain = String(email.split('@')[1] || '').trim().toLowerCase();
        return domain && domain !== mailboxPrimaryDomain;
      });
      if (hasExternal) {
        warnings.push({
          id: 'external_recipients',
          severity: 'info',
          message: 'В письме есть внешние получатели.',
        });
      }
    }
    const plainBody = String(composeState.composeBody || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const attachmentMentioned = /(влож|прикреп|attach|attachment|файл)/i.test(plainBody);
    if (attachmentMentioned && composeState.composeFiles.length === 0 && composeState.composeDraftAttachments.length === 0) {
      warnings.push({
        id: 'missing_attachment',
        severity: 'warning',
        message: 'В тексте упомянуто вложение, но файлы не прикреплены.',
      });
    }
    return warnings.filter((item) => !composeState.dismissedComposeWarnings.includes(item.id));
  }, [
    composeState.composeBccValues,
    composeState.composeBody,
    composeState.composeCcValues,
    composeState.composeDraftAttachments,
    composeState.composeFiles,
    composeState.composeSubject,
    composeState.composeToValues,
    composeState.dismissedComposeWarnings,
    mailboxPrimaryDomain,
  ]);

  const clearStoredComposeDraft = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(composeDraftKey);
    } catch {
      // ignore local storage issues
    }
  }, [composeDraftKey]);

  const persistLocalComposeDraft = useCallback((stateOverride = composeStateRef.current) => {
    if (typeof window === 'undefined') return;
    const state = stateOverride || composeStateRef.current;
    const payload = {
      compose_mode: state.composeMode || 'draft',
      from_mailbox_id: resolveComposeMailboxId(state.composeFromMailboxId),
      to: toRecipientEmails(state.composeToValues),
      cc: toRecipientEmails(state.composeCcValues),
      bcc: toRecipientEmails(state.composeBccValues),
      subject: String(state.composeSubject || ''),
      body: String(getComposeCombinedBody(state) || ''),
      editor_body: String(state.composeBody || ''),
      quoted_original_html: String(state.composeQuotedOriginalHtml || ''),
      draft_id: String(state.composeDraftId || ''),
      reply_to_message_id: String(state.composeReplyToMessageId || ''),
      forward_message_id: String(state.composeForwardMessageId || ''),
      draft_attachments: Array.isArray(state.composeDraftAttachments) ? state.composeDraftAttachments : [],
      local_attachment_names: (Array.isArray(state.composeFiles) ? state.composeFiles : []).map((file) => String(file?.name || '')).filter(Boolean),
      saved_at: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(composeDraftKey, JSON.stringify(payload));
    } catch {
      // ignore local storage issues
    }
  }, [composeDraftKey, resolveComposeMailboxId]);

  const flushComposeDraft = useCallback(async ({ includeFiles = false } = {}) => {
    const state = composeStateRef.current;
    if (!composeStateHasContent(state) && !state.composeDraftId) return null;
    patchComposeState({ draftSyncState: 'saving' });
    try {
      const data = await mailAPI.saveDraftMultipart({
        fromMailboxId: resolveComposeMailboxId(state.composeFromMailboxId),
        draftId: state.composeDraftId,
        composeMode: state.composeMode,
        to: toRecipientEmails(state.composeToValues),
        cc: toRecipientEmails(state.composeCcValues),
        bcc: toRecipientEmails(state.composeBccValues),
        subject: String(state.composeSubject || ''),
        body: String(getComposeCombinedBody(state) || ''),
        isHtml: true,
        replyToMessageId: state.composeReplyToMessageId,
        forwardMessageId: state.composeForwardMessageId,
        retainExistingAttachments: state.composeDraftAttachments.map((item) => item?.download_token || item?.id).filter(Boolean),
        files: includeFiles ? state.composeFiles : [],
      });
      patchComposeState((current) => ({
        composeDraftId: String(data?.draft_id || current.composeDraftId || ''),
        composeDraftAttachments: Array.isArray(data?.attachments) ? data.attachments : current.composeDraftAttachments,
        composeFiles: includeFiles && current.composeFiles.length > 0 ? [] : current.composeFiles,
        draftSavedAt: String(data?.saved_at || new Date().toISOString()),
        draftSyncState: 'synced',
      }));
      clearStoredComposeDraft();
      return data;
    } catch (requestError) {
      persistLocalComposeDraft(state);
      patchComposeState({ draftSyncState: 'local_only' });
      throw requestError;
    }
  }, [clearStoredComposeDraft, patchComposeState, persistLocalComposeDraft, resolveComposeMailboxId]);

  useEffect(() => {
    if (composeState.composeSending || (!hasComposeContent && !composeState.composeDraftId)) return undefined;
    const timer = setTimeout(() => {
      flushComposeDraft({ includeFiles: false }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [composeState, flushComposeDraft, hasComposeContent]);

  const handleCloseCompose = useCallback(async () => {
    const state = composeStateRef.current;
    if (state.composeSending) return;
    if (!composeStateHasContent(state) && state.composeDraftId) {
      try {
        await mailAPI.deleteDraft(state.composeDraftId, { mailboxId: resolveComposeMailboxId(state.composeFromMailboxId) });
      } catch {
        // ignore draft cleanup errors
      }
      clearStoredComposeDraft();
      onCloseSession?.();
      return;
    }
    if (composeStateHasContent(state) || state.composeDraftId) {
      try {
        await flushComposeDraft({ includeFiles: true });
      } catch {
        // fallback draft already persisted locally
      }
    }
    onCloseSession?.();
  }, [clearStoredComposeDraft, flushComposeDraft, onCloseSession, resolveComposeMailboxId]);

  const handleCloseComposeRef = useRef(handleCloseCompose);
  handleCloseComposeRef.current = handleCloseCompose;

  useEffect(() => {
    if (!onRegisterCloseHandler) return undefined;
    onRegisterCloseHandler(() => {
      void handleCloseComposeRef.current();
    });
    return () => onRegisterCloseHandler(null);
  }, [onRegisterCloseHandler]);

  const handleSendCompose = useCallback(async () => {
    const state = composeStateRef.current;
    const to = toRecipientEmails(state.composeToValues);
    const cc = toRecipientEmails(state.composeCcValues);
    const bcc = toRecipientEmails(state.composeBccValues);
    const validationErrors = {};
    if (to.length === 0) validationErrors.to = 'Укажите хотя бы одного получателя.';
    if (to.some((value) => !isValidEmail(value))) validationErrors.to = 'Проверьте адреса в поле "Кому".';
    if (cc.some((value) => !isValidEmail(value))) validationErrors.cc = 'Проверьте адреса в поле "Копия".';
    if (bcc.some((value) => !isValidEmail(value))) validationErrors.bcc = 'Проверьте адреса в поле "Скрытая копия".';
    if (Object.keys(validationErrors).length > 0) {
      patchComposeState({ composeFieldErrors: validationErrors });
      return;
    }
    patchComposeState({
      composeFieldErrors: {},
      composeError: '',
      composeSending: true,
      composeUploadProgress: 0,
    });
    try {
      if (state.composeFiles.length > 0) {
        const controller = new AbortController();
        composeUploadAbortRef.current = controller;
        await mailAPI.sendMessageMultipart({
          fromMailboxId: resolveComposeMailboxId(state.composeFromMailboxId),
          to,
          cc,
          bcc,
          subject: String(state.composeSubject || ''),
          body: String(getComposeCombinedBody(state) || ''),
          isHtml: true,
          replyToMessageId: state.composeReplyToMessageId,
          forwardMessageId: state.composeForwardMessageId,
          draftId: state.composeDraftId,
          files: state.composeFiles,
          signal: controller.signal,
          onUploadProgress: (event) => {
            const total = Number(event?.total || 0);
            const loaded = Number(event?.loaded || 0);
            if (total <= 0) return;
            const nextProgress = Math.max(0, Math.min(100, Math.round((loaded / total) * 100)));
            patchComposeState((current) => (
              current.composeUploadProgress === nextProgress
                ? null
                : { composeUploadProgress: nextProgress }
            ));
          },
        });
      } else {
        await mailAPI.sendMessage({
          from_mailbox_id: resolveComposeMailboxId(state.composeFromMailboxId),
          to,
          cc,
          bcc,
          subject: String(state.composeSubject || ''),
          body: String(getComposeCombinedBody(state) || ''),
          is_html: true,
          reply_to_message_id: state.composeReplyToMessageId,
          forward_message_id: state.composeForwardMessageId,
          draft_id: state.composeDraftId,
        });
      }
      clearStoredComposeDraft();
      await onSendSuccess?.();
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError, 'Не удалось отправить письмо.')) {
        patchComposeState({ composeError: '' });
      } else {
        patchComposeState({ composeError: getMailErrorDetail(requestError, 'Не удалось отправить письмо.') });
      }
    } finally {
      composeUploadAbortRef.current = null;
      patchComposeState({
        composeUploadProgress: 0,
        composeSending: false,
      });
    }
  }, [
    clearStoredComposeDraft,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    onSendSuccess,
    patchComposeState,
    resolveComposeMailboxId,
  ]);

  return (
    <MailComposeDialog
      open
      onClose={handleCloseCompose}
      dialogTitle={getComposeDialogTitle(composeState.composeMode)}
      composeMode={composeState.composeMode}
      draftSyncState={composeState.draftSyncState}
      draftSavedAt={composeState.draftSavedAt}
      composeError={composeState.composeError}
      onClearComposeError={() => patchComposeState({ composeError: '' })}
      formatFullDate={formatFullDate}
      composeDragActive={composeState.composeDragActive}
      onDragEnter={(event) => {
        event.preventDefault();
        patchComposeState({ composeDragActive: true });
      }}
      onDragOver={(event) => {
        event.preventDefault();
        patchComposeState({ composeDragActive: true });
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        patchComposeState({ composeDragActive: false });
      }}
      onDrop={(event) => {
        event.preventDefault();
        patchComposeState((current) => ({
          composeDragActive: false,
          composeFiles: Array.from(event.dataTransfer?.files || []).length > 0
            ? [...current.composeFiles, ...Array.from(event.dataTransfer?.files || [])]
            : current.composeFiles,
        }));
      }}
      onFileChange={(event) => {
        const files = Array.from(event.target.files || []);
        patchComposeState((current) => ({
          composeFiles: files.length > 0 ? [...current.composeFiles, ...files] : current.composeFiles,
        }));
        event.target.value = '';
      }}
      composeToOptions={composeToOptions}
      composeToLoading={composeToLoading}
      composeFromOptions={composeFromOptions}
      composeFromMailboxId={composeState.composeFromMailboxId}
      onComposeFromMailboxIdChange={(value) => patchComposeState({ composeFromMailboxId: String(value || '') })}
      composeToValues={composeState.composeToValues}
      onComposeToValuesChange={(value) => patchComposeState({ composeToValues: Array.isArray(value) ? value : [] })}
      onComposeToSearchChange={setComposeToSearch}
      composeFieldErrors={composeState.composeFieldErrors}
      composeCcValues={composeState.composeCcValues}
      onComposeCcValuesChange={(value) => patchComposeState({ composeCcValues: Array.isArray(value) ? value : [] })}
      composeBccValues={composeState.composeBccValues}
      onComposeBccValuesChange={(value) => patchComposeState({ composeBccValues: Array.isArray(value) ? value : [] })}
      composeSubject={composeState.composeSubject}
      onComposeSubjectChange={(value) => patchComposeState({ composeSubject: String(value || '') })}
      composeBody={composeState.composeBody}
      onComposeBodyChange={(value) => patchComposeState({ composeBody: String(value || '') })}
      quotedOriginalHtml={composeState.composeQuotedOriginalHtml}
      composeSignatureHtml={composeSignaturePreviewHtml}
      composeDraftAttachments={composeState.composeDraftAttachments}
      composeFiles={composeState.composeFiles}
      composeWarnings={composeWarnings}
      onDismissComposeWarning={(warningId) => patchComposeState((current) => ({
        dismissedComposeWarnings: [...new Set([...(current.dismissedComposeWarnings || []), String(warningId || '')])],
      }))}
      onComposePasteFiles={(files) => {
        const incoming = Array.isArray(files) ? files : Array.from(files || []);
        patchComposeState((current) => ({
          composeFiles: incoming.length > 0 ? [...current.composeFiles, ...incoming] : current.composeFiles,
        }));
      }}
      onSendComposeShortcut={handleSendCompose}
      formatFileSize={formatFileSize}
      sumFilesSize={sumFilesSize}
      sumAttachmentSize={sumAttachmentSize}
      onRemoveDraftAttachment={(id) => patchComposeState((current) => ({
        composeDraftAttachments: current.composeDraftAttachments.filter((item) => String(item.id) !== String(id)),
      }))}
      onRemoveComposeFile={(indexToRemove) => patchComposeState((current) => ({
        composeFiles: current.composeFiles.filter((_, index) => index !== indexToRemove),
      }))}
      composeSending={composeState.composeSending}
      composeUploadProgress={composeState.composeUploadProgress}
      onCancelComposeUpload={() => {
        if (composeUploadAbortRef.current) composeUploadAbortRef.current.abort();
      }}
      onOpenSignatureEditor={() => onOpenSignatureEditor?.(composeState.composeFromMailboxId)}
      onSendCompose={handleSendCompose}
      layoutMode={layoutMode}
    />
  );
}

function Mail() {
  const theme = useTheme();
  const ui = useMemo(() => buildMailUiTokens(theme), [theme]);
  const mailRenderColorScheme = ui.isDark ? 'dark' : 'light';
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, user } = useAuth();
  const initialRouteMailboxId = useMemo(
    () => normalizeMailboxId(new URLSearchParams(location.search || '').get('mailbox_id')),
    [location.search]
  );
  const initialMailViewState = useMemo(() => readStoredMailViewState(initialRouteMailboxId), [initialRouteMailboxId]);
  const initialMailCacheScope = useMemo(
    () => initialRouteMailboxId || String(user?.id || 'anonymous'),
    [initialRouteMailboxId, user?.id]
  );
  const initialMailRecentContextKey = useMemo(() => JSON.stringify(buildMailListCacheKey({
    scope: initialMailCacheScope,
    folder: initialMailViewState.folder,
    viewMode: initialMailViewState.viewMode,
    q: initialMailViewState.search,
    unreadOnly: initialMailViewState.unreadOnly,
    hasAttachmentsOnly: initialMailViewState.hasAttachmentsOnly,
    dateFrom: initialMailViewState.filterDateFrom,
    dateTo: initialMailViewState.filterDateTo,
    folderScope: initialMailViewState?.advancedFiltersApplied?.folder_scope || 'current',
    fromFilter: initialMailViewState?.advancedFiltersApplied?.from_filter,
    toFilter: initialMailViewState?.advancedFiltersApplied?.to_filter,
    subjectFilter: initialMailViewState?.advancedFiltersApplied?.subject_filter,
    bodyFilter: initialMailViewState?.advancedFiltersApplied?.body_filter,
    importance: initialMailViewState?.advancedFiltersApplied?.importance,
    limit: 50,
    offset: 0,
  })), [initialMailCacheScope, initialMailViewState]);
  const initialMailRecentHydration = useMemo(
    () => getMailRecentHydration({ scope: initialMailCacheScope, contextKey: initialMailRecentContextKey }),
    [initialMailCacheScope, initialMailRecentContextKey]
  );
  const canManageUsers = hasPermission('settings.users.manage');

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [messageActionLoading, setMessageActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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
  const [selectedMailboxId, setSelectedMailboxId] = useState(initialRouteMailboxId);
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
  const [selectedId, setSelectedId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedByMode, setSelectedByMode] = useState({ messages: '', conversations: '' });
  const [moveTarget, setMoveTarget] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState(initialMailViewState.advancedFiltersApplied);
  const [advancedFiltersApplied, setAdvancedFiltersApplied] = useState(initialMailViewState.advancedFiltersApplied);
  const [recentSearches, setRecentSearches] = useState([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [headersOpen, setHeadersOpen] = useState(false);
  const [headersLoading, setHeadersLoading] = useState(false);
  const [messageHeaders, setMessageHeaders] = useState({ items: [] });

  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState('create');
  const [folderDialogParentId, setFolderDialogParentId] = useState('');
  const [folderDialogScope, setFolderDialogScope] = useState('mailbox');
  const [folderDialogTarget, setFolderDialogTarget] = useState(null);
  const [folderDialogName, setFolderDialogName] = useState('');
  const [folderDialogSaving, setFolderDialogSaving] = useState(false);

  const [attachmentPreview, setAttachmentPreview] = useState(createEmptyAttachmentPreview);
  const [toolsAnchorEl, setToolsAnchorEl] = useState(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  const [composeSession, setComposeSession] = useState(null);

  const [quickReplyBody, setQuickReplyBody] = useState('');
  const [quickReplySending, setQuickReplySending] = useState(false);
  const [showQuotedHistory, setShowQuotedHistory] = useState(false);

  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureMailboxId, setSignatureMailboxId] = useState('');

  const [templates, setTemplates] = useState([]);
  const [itOpen, setItOpen] = useState(false);
  const [itTemplateId, setItTemplateId] = useState('');
  const [itFieldValues, setItFieldValues] = useState({});
  const [revealedRemoteImagesByMessageId, setRevealedRemoteImagesByMessageId] = useState({});

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templateEditId, setTemplateEditId] = useState('');
  const [templateCode, setTemplateCode] = useState('');
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateCategory, setTemplateCategory] = useState('');
  const [templateSubject, setTemplateSubject] = useState('');
  const [templateBody, setTemplateBody] = useState('');
  const [templateFields, setTemplateFields] = useState([]);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateDeleting, setTemplateDeleting] = useState(false);
  const [mobilePreviewSwipeOffset, setMobilePreviewSwipeOffset] = useState(0);
  const [mobilePreviewSwipeTransition, setMobilePreviewSwipeTransition] = useState(false);
  const composeOpen = Boolean(composeSession);

  const messageListRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const conversationScrollRef = useRef(null);
  const searchInputRef = useRef(null);
  const composeSessionCounterRef = useRef(0);
  const composeCloseRequestRef = useRef(null);
  const dragMessageIdsRef = useRef([]);
  const detailRequestAbortRef = useRef(null);
  const templatesInitRef = useRef(false);
  const templatesLoadedRef = useRef(false);
  const listDataRef = useRef(listData);
  const selectedIdRef = useRef(selectedId);
  const viewModeRef = useRef(viewMode);
  const folderSummaryRef = useRef(folderSummary);
  const folderTreeRef = useRef(folderTree);
  const mailboxesRef = useRef(mailboxes);
  const selectedMessageRef = useRef(selectedMessage);
  const selectedConversationRef = useRef(selectedConversation);
  const detailContextRef = useRef('');
  const deepLinkKeyRef = useRef('');
  const suppressNextAutoReadRef = useRef('');
  const autoReadInFlightRef = useRef(new Set());
  const autoReadCompletedAtRef = useRef(new Map());
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
  const mailViewRefreshInFlightRef = useRef(new Map());
  const mailViewRefreshCompletedAtRef = useRef(new Map());
  const folderSummaryRefreshCompletedAtRef = useRef(0);
  const mailboxUnreadRefreshInFlightRef = useRef(new Set());
  const attachmentDownloadInFlightRef = useRef(new Set());
  const mobilePreviewSwipeRef = useRef(null);
  const mobilePreviewSwipeTimeoutRef = useRef(null);
  const mobileHistoryReadyRef = useRef(false);
  const mobileHistoryModeRef = useRef('list:closed:none:messages');

  const activeMailboxId = useMemo(
    () => normalizeMailboxId(selectedMailboxId || mailboxInfo?.mailbox_id || initialRouteMailboxId),
    [initialRouteMailboxId, mailboxInfo?.mailbox_id, selectedMailboxId]
  );
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
  const activeTemplate = useMemo(() => templates.find((item) => String(item.id) === String(itTemplateId)) || null, [templates, itTemplateId]);
  const templateVariableHints = useMemo(() => {
    const seen = new Set();
    const values = [];
    (Array.isArray(templateFields) ? templateFields : []).forEach((field) => {
      const key = normalizeTemplateFieldKey(field?.key);
      if (!key || seen.has(key)) return;
      seen.add(key);
      values.push(key);
    });
    return values;
  }, [templateFields]);
  const templateEditorPreview = useMemo(() => {
    const values = {};
    templateVariableHints.forEach((key) => { values[key] = `{{${key}}}`; });
    (Array.isArray(templateFields) ? templateFields : []).forEach((field) => {
      const key = normalizeTemplateFieldKey(field?.key);
      if (!key) return;
      const fallback = Array.isArray(field?.default_value)
        ? field.default_value.join(', ')
        : String(field?.default_value || '');
      if (fallback) values[key] = fallback;
    });
    const render = (text) => String(text || '').replace(/\{\{\s*([a-z0-9_.-]+)\s*\}\}/gi, (match, key) => values[String(key || '').toLowerCase()] || match);
    const subjectPreview = render(templateSubject);
    const bodyPreview = render(templateBody);
    return `Тема: ${subjectPreview || '(без темы)'}\n\n${bodyPreview || '(пустой текст)'}`;
  }, [templateSubject, templateBody, templateFields, templateVariableHints]);
  const selectedMessageAllowsExternalImages = Boolean(
    selectedMessage?.id && revealedRemoteImagesByMessageId?.[String(selectedMessage.id)]
  );
  const selectedMessageAllAttachments = useMemo(
    () => (Array.isArray(selectedMessage?.attachments) ? selectedMessage.attachments : []),
    [selectedMessage?.attachments]
  );
  const selectedMessageBodyHtmlSource = useMemo(
    () => getMessageBodyHtmlSource(selectedMessage),
    [selectedMessage?.body_html, selectedMessage?.body_text]
  );
  const selectedMessageRenderResult = useMemo(
    () => buildRenderedMailHtml(
      selectedMessageBodyHtmlSource,
      selectedMessageAllAttachments,
      { allowExternalImages: selectedMessageAllowsExternalImages, colorScheme: mailRenderColorScheme }
    ),
    [selectedMessageBodyHtmlSource, selectedMessageAllAttachments, selectedMessageAllowsExternalImages, mailRenderColorScheme]
  );
  const selectedMessageAttachments = useMemo(
    () => filterVisibleMailAttachments(selectedMessageAllAttachments, selectedMessageRenderResult.usedInlineAttachmentIds),
    [selectedMessageAllAttachments, selectedMessageRenderResult.usedInlineAttachmentIds]
  );
  const selectedMessageAttachmentTotalSize = useMemo(
    () => formatFileSize(sumAttachmentSize(selectedMessageAttachments)),
    [selectedMessageAttachments]
  );
  const selectedMessageQuotedHistory = useMemo(
    () => splitQuotedHistoryHtml(selectedMessageRenderResult?.html),
    [selectedMessageRenderResult?.html]
  );
  const selectedMessageHasQuotedHistory = useMemo(
    () => Boolean(selectedMessageQuotedHistory?.hasQuotedHistory),
    [selectedMessageQuotedHistory]
  );
  const selectedMessagePrimaryHtml = useMemo(
    () => (
      selectedMessageQuotedHistory?.quotedHtml
        ? selectedMessageQuotedHistory.primaryHtml
        : selectedMessageRenderResult.html
    ),
    [selectedMessageQuotedHistory, selectedMessageRenderResult.html]
  );
  const selectedMessageQuotedHtml = useMemo(
    () => String(selectedMessageQuotedHistory?.quotedHtml || ''),
    [selectedMessageQuotedHistory]
  );
  const selectedMessageUsesQuoteFallback = useMemo(
    () => Boolean(selectedMessageHasQuotedHistory && !selectedMessageQuotedHtml),
    [selectedMessageHasQuotedHistory, selectedMessageQuotedHtml]
  );
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
  const refreshMailboxUnreadCounts = useCallback(async ({ mailboxIds = null, force = false } = {}) => {
    const requestedIds = Array.isArray(mailboxIds)
      ? mailboxIds.map((value) => normalizeMailboxId(value)).filter(Boolean)
      : null;
    const requestedIdSet = requestedIds ? new Set(requestedIds) : null;
    const currentMailboxes = Array.isArray(mailboxesRef.current) ? mailboxesRef.current : [];
    const targets = currentMailboxes
      .filter((entry) => {
        const mailboxId = getMailboxEntryId(entry);
        if (!mailboxId || entry?.is_active === false) return false;
        if (mailboxId === activeMailboxId) return false;
        if (requestedIdSet && !requestedIdSet.has(mailboxId)) return false;
        if (mailboxUnreadRefreshInFlightRef.current.has(mailboxId)) return false;
        if (force) return true;
        return normalizeUnreadCountState(entry?.unread_count_state) !== 'fresh';
      })
      .map((entry) => getMailboxEntryId(entry))
      .filter(Boolean);
    if (targets.length === 0) return;

    const results = await Promise.allSettled(targets.map(async (mailboxId) => {
      mailboxUnreadRefreshInFlightRef.current.add(mailboxId);
      try {
        const response = await mailAPI.getUnreadCount({ mailboxId });
        return {
          mailboxId,
          unreadCount: Number(response?.unread_count || 0),
        };
      } finally {
        mailboxUnreadRefreshInFlightRef.current.delete(mailboxId);
      }
    }));

    const nextCounts = new Map();
    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      nextCounts.set(result.value.mailboxId, result.value.unreadCount);
    });
    if (nextCounts.size === 0) return;

    setMailboxes((prev) => (Array.isArray(prev) ? prev.map((entry) => {
      const mailboxId = getMailboxEntryId(entry);
      if (!mailboxId || !nextCounts.has(mailboxId)) return entry;
      return {
        ...entry,
        unread_count: Number(nextCounts.get(mailboxId) || 0),
        unread_count_state: 'fresh',
      };
    }) : prev));
  }, [activeMailboxId]);
  const handleOpenMailboxList = useCallback(() => {
    void refreshMailboxUnreadCounts();
  }, [refreshMailboxUnreadCounts]);
  const withActiveMailboxParams = useCallback((params = {}) => (
    activeMailboxId
      ? { ...(params || {}), mailbox_id: activeMailboxId }
      : { ...(params || {}) }
  ), [activeMailboxId]);
  const withActiveMailboxPayload = useCallback((payload = {}) => (
    activeMailboxId
      ? { ...(payload || {}), mailbox_id: activeMailboxId }
      : { ...(payload || {}) }
  ), [activeMailboxId]);
  const resolveItemMailboxId = useCallback((item) => (
    normalizeMailboxId(
      item?.mailbox_id
      || item?.compose_context?.mailbox_id
      || item?.draft_context?.mailbox_id
      || activeMailboxId
    )
  ), [activeMailboxId]);
  const resolveAttachmentRequestContext = useCallback((messageOrId, attachment, fallbackMessage = null) => {
    const message = messageOrId && typeof messageOrId === 'object'
      ? messageOrId
      : (fallbackMessage && typeof fallbackMessage === 'object' ? fallbackMessage : null);
    const messageId = String(
      (messageOrId && typeof messageOrId === 'object' ? messageOrId?.id : messageOrId)
      || message?.id
      || ''
    ).trim();
    const attachmentRef = String(attachment?.download_token || attachment?.id || attachment?.attachment_ref || '').trim();
    const mailboxId = resolveItemMailboxId(message);
    return { messageId, attachmentRef, mailboxId };
  }, [resolveItemMailboxId]);
  const resolveComposeMailboxId = useCallback((candidate = '') => {
    const normalizedCandidate = normalizeMailboxId(candidate);
    if (normalizedCandidate) return normalizedCandidate;
    if (activeMailboxId) return activeMailboxId;
    return getMailboxEntryId(composeFromOptions[0]);
  }, [activeMailboxId, composeFromOptions]);
  const mailCacheScope = useMemo(
    () => activeMailboxId || initialMailCacheScope || 'mailbox:pending',
    [activeMailboxId, initialMailCacheScope]
  );
  const currentContextUsesBootstrapList = useMemo(() => (
    folder === 'inbox'
    && viewMode === 'messages'
    && !debouncedSearch
    && !unreadOnly
    && !hasAttachmentsOnly
    && !filterDateFrom
    && !filterDateTo
    && !advancedFiltersApplied?.from_filter
    && !advancedFiltersApplied?.to_filter
    && !advancedFiltersApplied?.subject_filter
    && !advancedFiltersApplied?.body_filter
    && !advancedFiltersApplied?.importance
    && String(advancedFiltersApplied?.folder_scope || 'current') === 'current'
  ), [
    advancedFiltersApplied,
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    unreadOnly,
    viewMode,
  ]);
  const currentFolderScope = String(advancedFiltersApplied?.folder_scope || 'current');
  const currentListParams = useMemo(() => ({
    folder,
    q: debouncedSearch || undefined,
    unread_only: unreadOnly || undefined,
    has_attachments: hasAttachmentsOnly || undefined,
    date_from: filterDateFrom || undefined,
    date_to: filterDateTo || undefined,
    folder_scope: currentFolderScope || undefined,
    from_filter: advancedFiltersApplied?.from_filter || undefined,
    to_filter: advancedFiltersApplied?.to_filter || undefined,
    subject_filter: advancedFiltersApplied?.subject_filter || undefined,
    body_filter: advancedFiltersApplied?.body_filter || undefined,
    importance: advancedFiltersApplied?.importance || undefined,
    limit: 50,
    offset: 0,
  }), [
    advancedFiltersApplied,
    currentFolderScope,
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    unreadOnly,
  ]);
  const currentListCacheKey = useMemo(() => buildMailListCacheKey({
    scope: mailCacheScope,
    folder,
    viewMode,
    q: debouncedSearch,
    unreadOnly,
    hasAttachmentsOnly,
    dateFrom: filterDateFrom,
    dateTo: filterDateTo,
    folderScope: currentFolderScope,
    fromFilter: advancedFiltersApplied?.from_filter,
    toFilter: advancedFiltersApplied?.to_filter,
    subjectFilter: advancedFiltersApplied?.subject_filter,
    bodyFilter: advancedFiltersApplied?.body_filter,
    importance: advancedFiltersApplied?.importance,
    limit: 50,
    offset: 0,
  }), [
    advancedFiltersApplied,
    currentFolderScope,
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    mailCacheScope,
    unreadOnly,
    viewMode,
  ]);
  const currentListContextKey = useMemo(() => JSON.stringify(currentListCacheKey), [currentListCacheKey]);
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
  const getMailMobileHistoryKey = useCallback((state = {}) => {
    const view = String(state?.view || '').trim() === 'preview' ? 'preview' : 'list';
    const drawerKey = view === 'list' && Boolean(state?.drawerOpen) ? 'open' : 'closed';
    const selectionMode = String(state?.selectionMode || '').trim() === 'conversations' ? 'conversations' : 'messages';
    const previewId = view === 'preview' ? (String(state?.selectedId || '').trim() || 'none') : 'none';
    return `${view}:${drawerKey}:${previewId}:${selectionMode}`;
  }, []);
  const readMailMobileHistoryState = useCallback((state = typeof window !== 'undefined' ? window.history.state : null) => {
    if (!state || typeof state !== 'object' || state[MAIL_MOBILE_HISTORY_FLAG] !== true) return null;
    const view = String(state[MAIL_MOBILE_HISTORY_VIEW_KEY] || '').trim() === 'preview' ? 'preview' : 'list';
    const selectionMode = String(state[MAIL_MOBILE_HISTORY_MODE_KEY] || '').trim() === 'conversations' ? 'conversations' : 'messages';
    return {
      view,
      drawerOpen: view === 'list' && Boolean(state[MAIL_MOBILE_HISTORY_DRAWER_KEY]),
      selectedId: view === 'preview' ? String(state[MAIL_MOBILE_HISTORY_MESSAGE_KEY] || '').trim() : '',
      selectionMode,
    };
  }, []);
  const writeMailMobileHistoryState = useCallback((nextState, strategy = 'push') => {
    if (!isMobile || typeof window === 'undefined') return;
    const view = String(nextState?.view || '').trim() === 'preview' ? 'preview' : 'list';
    const selectionMode = String(nextState?.selectionMode || '').trim() === 'conversations' ? 'conversations' : 'messages';
    const selectedPreviewId = view === 'preview' ? String(nextState?.selectedId || '').trim() : '';
    const nextHistoryState = {
      ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
      [MAIL_MOBILE_HISTORY_FLAG]: true,
      [MAIL_MOBILE_HISTORY_VIEW_KEY]: view,
      [MAIL_MOBILE_HISTORY_DRAWER_KEY]: view === 'list' ? Boolean(nextState?.drawerOpen) : false,
      [MAIL_MOBILE_HISTORY_MESSAGE_KEY]: selectedPreviewId,
      [MAIL_MOBILE_HISTORY_MODE_KEY]: selectionMode,
    };
    const nextUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (strategy === 'replace') {
      window.history.replaceState(nextHistoryState, '', nextUrl);
    } else {
      window.history.pushState(nextHistoryState, '', nextUrl);
    }
    mobileHistoryModeRef.current = getMailMobileHistoryKey({
      view,
      drawerOpen: view === 'list' ? Boolean(nextState?.drawerOpen) : false,
      selectedId: selectedPreviewId,
      selectionMode,
    });
  }, [getMailMobileHistoryKey, isMobile]);

  const getMailErrorDetail = useCallback((requestError, fallbackMessage = '') => {
    const detail = requestError?.response?.data?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (detail && typeof detail?.message === 'string' && detail.message.trim()) return detail.message;
    if (typeof requestError?.message === 'string' && requestError.message.trim()) return requestError.message.trim();
    return String(fallbackMessage || '').trim();
  }, []);
  const getMailErrorDetailAsync = useCallback(async (requestError, fallbackMessage = '') => {
    const responseData = requestError?.response?.data;
    const blobTag = Object.prototype.toString.call(responseData);
    const isBlobLike = Boolean(
      responseData
      && typeof responseData === 'object'
      && (
        typeof responseData.text === 'function'
        || typeof responseData.arrayBuffer === 'function'
        || blobTag === '[object Blob]'
      )
    );
    if (isBlobLike) {
      try {
        let rawText = '';
        if (typeof responseData.text === 'function') {
          rawText = await responseData.text();
        } else if (typeof responseData.arrayBuffer === 'function' && typeof TextDecoder !== 'undefined') {
          rawText = new TextDecoder().decode(await responseData.arrayBuffer());
        } else if (blobTag === '[object Blob]') {
          rawText = await readBlobAsText(responseData);
        } else if (typeof Response !== 'undefined') {
          rawText = await new Response(responseData).text();
        }
        const text = String(rawText || '').trim();
        if (text && text !== '[object Blob]') {
          const contentType = String(
            requestError?.response?.headers?.['content-type']
            || responseData.type
            || ''
          ).toLowerCase();
          if (contentType.includes('json') || text.startsWith('{') || text.startsWith('[')) {
            try {
              const parsed = JSON.parse(text);
              const detail = parsed?.detail;
              if (typeof detail === 'string' && detail.trim()) return detail.trim();
              if (detail && typeof detail?.message === 'string' && detail.message.trim()) {
                return detail.message.trim();
              }
              if (typeof parsed?.message === 'string' && parsed.message.trim()) {
                return parsed.message.trim();
              }
            } catch {
              // Fall through to plain-text handling below.
            }
          }
          if (!/^<!doctype html/i.test(text) && !/^<html/i.test(text)) {
            return text;
          }
        }
      } catch {
        // Fall through to the normal mail error detail extraction.
      }
    }
    return getMailErrorDetail(requestError, fallbackMessage);
  }, [getMailErrorDetail]);
  const isMissingMailDetailError = useCallback((requestError, detailText = '') => {
    const statusCode = Number(requestError?.response?.status || 0);
    if (statusCode === 404) return true;
    if (statusCode !== 400) return false;
    const normalizedDetail = String(detailText || '').trim().toLowerCase();
    return normalizedDetail.includes('message not found')
      || normalizedDetail.includes('invalid message id')
      || normalizedDetail.includes('message id is required');
  }, []);

  const getMailErrorCode = useCallback((requestError) => String(
    requestError?.response?.headers?.['x-mail-error-code']
    || requestError?.response?.headers?.['X-Mail-Error-Code']
    || ''
  ).trim(), []);
  const isTransientMailRequestError = useCallback((requestError) => {
    const statusCode = Number(requestError?.response?.status || 0);
    if ([408, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;
    const errorCode = String(requestError?.code || '').trim().toUpperCase();
    if (['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(errorCode)) {
      return true;
    }
    const detailText = String(
      requestError?.message
      || requestError?.response?.data?.detail
      || ''
    ).trim().toLowerCase();
    if (!statusCode && (
      detailText.includes('network error')
      || detailText.includes('failed to fetch')
      || detailText.includes('load failed')
      || detailText.includes('timeout')
    )) {
      return true;
    }
    return false;
  }, []);

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
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { mailboxesRef.current = mailboxes; }, [mailboxes]);
  useEffect(() => { selectedMessageRef.current = selectedMessage; }, [selectedMessage]);
  useEffect(() => { selectedConversationRef.current = selectedConversation; }, [selectedConversation]);
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
    const routeFolder = String(searchParams.get('folder') || '').trim().toLowerCase();
    const routeMessageId = String(searchParams.get('message') || '').trim();
    const storedState = readStoredMailViewState(activeMailboxId);
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
    try {
      if (activeMailboxId) {
        window.sessionStorage.setItem(
          buildMailViewStateStorageKey(activeMailboxId),
          JSON.stringify(nextState),
        );
      }
      window.sessionStorage.setItem(MAIL_VIEW_STATE_STORAGE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore session storage errors
    }
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
  useEffect(() => {
    if (!isMobile) setMobileNavigationOpen(false);
  }, [isMobile]);
  useEffect(() => {
    if (isMobile && selectedId) setMobileNavigationOpen(false);
  }, [isMobile, selectedId]);
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
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(MAIL_LIST_VIEW_STATE_STORAGE_KEY, JSON.stringify(nextState));
    } catch {
      // ignore session storage errors
    }
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
  const revealRemoteImagesForMessage = useCallback((messageId) => {
    const normalizedMessageId = String(messageId || '').trim();
    if (!normalizedMessageId) return;
    setRevealedRemoteImagesByMessageId((prev) => {
      if (prev?.[normalizedMessageId]) return prev;
      return {
        ...(prev || {}),
        [normalizedMessageId]: true,
      };
    });
  }, []);
  const persistRecentBootstrapSnapshot = useCallback((nextFolderSummary, nextFolderTree, scope = mailCacheScope) => {
    writeMailRecentBootstrap({
      scope: scope || mailCacheScope,
      folderSummary: nextFolderSummary,
      folderTree: nextFolderTree,
    });
  }, [mailCacheScope]);
  const persistRecentListSnapshot = useCallback((contextKey, nextListData, scope = mailCacheScope) => {
    const normalizedContextKey = String(contextKey || '').trim();
    if (!normalizedContextKey) return;
    writeMailRecentList({
      scope: scope || mailCacheScope,
      contextKey: normalizedContextKey,
      listData: normalizeMailListResponse(nextListData),
    });
  }, [mailCacheScope]);
  const persistRecentMessageDetailSnapshot = useCallback((detailPayload) => {
    if (!detailPayload || typeof detailPayload !== 'object') return;
    const normalizedMessageId = String(detailPayload?.id || '').trim();
    if (!normalizedMessageId) return;
    writeMailRecentMessageDetail({
      scope: mailCacheScope,
      message: detailPayload,
    });
  }, [mailCacheScope]);
  const getRecentMessageDetailSnapshot = useCallback((messageId) => {
    const fromCurrentScope = getMailRecentMessageDetail({
      scope: mailCacheScope,
      messageId,
    });
    if (fromCurrentScope) return fromCurrentScope;
    if (initialMailCacheScope && initialMailCacheScope !== mailCacheScope) {
      return getMailRecentMessageDetail({
        scope: initialMailCacheScope,
        messageId,
      });
    }
    return null;
  }, [initialMailCacheScope, mailCacheScope]);
  const beginAutoReadGuard = useCallback((guardKey) => {
    const normalizedGuardKey = String(guardKey || '').trim();
    if (!normalizedGuardKey) return false;
    const now = Date.now();
    for (const [key, value] of autoReadCompletedAtRef.current.entries()) {
      if ((now - Number(value || 0)) >= MAIL_AUTO_READ_GUARD_TTL_MS) {
        autoReadCompletedAtRef.current.delete(key);
      }
    }
    if (autoReadInFlightRef.current.has(normalizedGuardKey)) {
      return false;
    }
    const completedAt = Number(autoReadCompletedAtRef.current.get(normalizedGuardKey) || 0);
    if (completedAt > 0 && (now - completedAt) < MAIL_AUTO_READ_GUARD_TTL_MS) {
      return false;
    }
    autoReadInFlightRef.current.add(normalizedGuardKey);
    return true;
  }, []);
  const settleAutoReadGuard = useCallback((guardKey, succeeded) => {
    const normalizedGuardKey = String(guardKey || '').trim();
    if (!normalizedGuardKey) return;
    autoReadInFlightRef.current.delete(normalizedGuardKey);
    if (succeeded) {
      autoReadCompletedAtRef.current.set(normalizedGuardKey, Date.now());
    }
  }, []);
  const getReadStateOverrideKey = useCallback((mode, targetId) => {
    const normalizedMode = normalizeMailViewMode(mode);
    const normalizedTargetId = String(targetId || '').trim();
    return normalizedTargetId ? `${normalizedMode}:${normalizedTargetId}` : '';
  }, []);
  const pruneLocalReadStateOverrides = useCallback(() => {
    const now = Date.now();
    const overrides = localReadStateOverridesRef.current || new Map();
    for (const [key, entry] of overrides.entries()) {
      if ((now - Number(entry?.updatedAt || 0)) >= MAIL_AUTO_READ_GUARD_TTL_MS) {
        overrides.delete(key);
      }
    }
    localReadStateOverridesRef.current = overrides;
  }, []);
  const setLocalReadStateOverride = useCallback((mode, targetId, isRead) => {
    const key = getReadStateOverrideKey(mode, targetId);
    if (!key) return;
    pruneLocalReadStateOverrides();
    localReadStateOverridesRef.current.set(key, {
      isRead: Boolean(isRead),
      updatedAt: Date.now(),
    });
  }, [getReadStateOverrideKey, pruneLocalReadStateOverrides]);
  const clearLocalReadStateOverride = useCallback((mode, targetId) => {
    const key = getReadStateOverrideKey(mode, targetId);
    if (!key) return;
    localReadStateOverridesRef.current.delete(key);
  }, [getReadStateOverrideKey]);
  const getLocalReadStateOverride = useCallback((mode, targetId) => {
    const key = getReadStateOverrideKey(mode, targetId);
    if (!key) return null;
    pruneLocalReadStateOverrides();
    const entry = localReadStateOverridesRef.current.get(key);
    return entry ? Boolean(entry.isRead) : null;
  }, [getReadStateOverrideKey, pruneLocalReadStateOverrides]);
  const applyReadStateOverridesToListData = useCallback((nextListData, selectionMode = viewMode) => {
    const normalized = normalizeMailListResponse(nextListData);
    const normalizedMode = normalizeMailViewMode(selectionMode);
    const items = (Array.isArray(normalized.items) ? normalized.items : []).map((item) => {
      if (normalizedMode === 'conversations') {
        const conversationId = String(item?.conversation_id || item?.id || '').trim();
        const override = getLocalReadStateOverride('conversations', conversationId);
        if (override === null) return item;
        return {
          ...item,
          unread_count: override ? 0 : Math.max(1, Number(item?.unread_count || 0)),
        };
      }
      const messageId = String(item?.id || '').trim();
      const override = getLocalReadStateOverride('messages', messageId);
      return override === null ? item : { ...item, is_read: override };
    });
    return {
      ...normalized,
      items,
    };
  }, [getLocalReadStateOverride, viewMode]);
  const applyReadStateOverridesToMessageDetail = useCallback((message) => {
    if (!message || typeof message !== 'object') return message;
    const messageId = String(message?.id || '').trim();
    const override = getLocalReadStateOverride('messages', messageId);
    return override === null ? message : { ...message, is_read: override };
  }, [getLocalReadStateOverride]);
  const applyReadStateOverridesToConversationDetail = useCallback((conversation) => {
    if (!conversation || typeof conversation !== 'object') return conversation;
    const conversationId = String(conversation?.conversation_id || conversation?.id || '').trim();
    const override = getLocalReadStateOverride('conversations', conversationId);
    if (override === null) return conversation;
    return {
      ...conversation,
      unread_count: override ? 0 : Math.max(1, Number(conversation?.unread_count || 0)),
      items: (Array.isArray(conversation?.items) ? conversation.items : []).map((item) => ({
        ...item,
        is_read: override,
      })),
    };
  }, [getLocalReadStateOverride]);
  const prefetchMailDetail = useCallback((targetId, { mode = viewMode } = {}) => {
    if (!mailAccessReady) return;
    const normalizedId = String(targetId || '').trim();
    const normalizedMode = normalizeMailViewMode(mode);
    if (!normalizedId) return;
    const folderScope = advancedFiltersApplied?.folder_scope || 'current';
    const detailCacheKey = normalizedMode === 'conversations'
      ? buildMailConversationDetailCacheKey({
          scope: mailCacheScope,
          conversationId: normalizedId,
          folder,
          folderScope,
        })
      : buildMailMessageDetailCacheKey({
          scope: mailCacheScope,
          messageId: normalizedId,
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
    void getOrFetchSWR(
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
    const detailCacheKey = normalizedMode === 'conversations'
      ? buildMailConversationDetailCacheKey({
          scope: mailCacheScope,
          conversationId: normalizedId,
          folder,
          folderScope,
        })
      : buildMailMessageDetailCacheKey({
          scope: mailCacheScope,
          messageId: normalizedId,
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
    const nextFolder = String(searchParams.get('folder') || '').trim().toLowerCase();
    const nextMessageId = String(searchParams.get('message') || '').trim();
    if (nextMailboxId && nextMailboxId !== activeMailboxId) {
      lastAppliedMailboxViewStateRef.current = '';
      setSelectedMailboxId(nextMailboxId);
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

  const clearSelection = useCallback(({ mode = viewMode, allModes = false, restoreListState = false } = {}) => {
    if (detailRequestAbortRef.current) {
      detailRequestAbortRef.current.abort();
      detailRequestAbortRef.current = null;
    }
    const targetMode = mode === 'conversations' ? 'conversations' : 'messages';
    if (restoreListState && targetMode === 'messages') {
      queueListScrollRestore();
    }
    detailContextRef.current = '';
    selectedIdRef.current = '';
    setDetailLoading(false);
    setMoveTarget('');
    setSelectedId('');
    setSelectedByMode((prev) => {
      const current = prev || {};
      if (allModes) {
        if (!current.messages && !current.conversations) return current;
        return { ...current, messages: '', conversations: '' };
      }
      if (!current[targetMode]) return current;
      return { ...current, [targetMode]: '' };
    });
    setSelectedMessage(null);
    setSelectedConversation(null);
  }, [queueListScrollRestore, viewMode]);
  const handleBackToList = useCallback(() => {
    if (isMobile && mobileHistoryReadyRef.current && typeof window !== 'undefined') {
      const currentState = readMailMobileHistoryState();
      if (currentState?.view === 'preview') {
        window.history.back();
        return;
      }
    }
    clearSelection({ mode: viewMode, restoreListState: isMobile && viewMode === 'messages' });
  }, [clearSelection, isMobile, readMailMobileHistoryState, viewMode]);
  const clearMobilePreviewSwipeTimeout = useCallback(() => {
    if (!mobilePreviewSwipeTimeoutRef.current || typeof window === 'undefined') return;
    window.clearTimeout(mobilePreviewSwipeTimeoutRef.current);
    mobilePreviewSwipeTimeoutRef.current = null;
  }, []);
  const resetMobilePreviewSwipe = useCallback(({ animate = false } = {}) => {
    clearMobilePreviewSwipeTimeout();
    mobilePreviewSwipeRef.current = null;
    if (!animate) {
      setMobilePreviewSwipeTransition(false);
      setMobilePreviewSwipeOffset(0);
      return;
    }
    setMobilePreviewSwipeTransition(true);
    setMobilePreviewSwipeOffset(0);
    if (typeof window !== 'undefined') {
      mobilePreviewSwipeTimeoutRef.current = window.setTimeout(() => {
        setMobilePreviewSwipeTransition(false);
        mobilePreviewSwipeTimeoutRef.current = null;
      }, MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS);
    }
  }, [clearMobilePreviewSwipeTimeout]);
  const commitMobilePreviewSwipeClose = useCallback((screenWidth = 0) => {
    clearMobilePreviewSwipeTimeout();
    mobilePreviewSwipeRef.current = null;
    const targetOffset = Math.max(
      Number(screenWidth || 0),
      Number(typeof window !== 'undefined' ? window.innerWidth : 0),
      MAIL_MOBILE_EDGE_SWIPE_CLOSE_THRESHOLD_PX,
    );
    setMobilePreviewSwipeTransition(true);
    setMobilePreviewSwipeOffset(targetOffset);
    if (typeof window !== 'undefined') {
      mobilePreviewSwipeTimeoutRef.current = window.setTimeout(() => {
        setMobilePreviewSwipeTransition(false);
        setMobilePreviewSwipeOffset(0);
        mobilePreviewSwipeTimeoutRef.current = null;
        handleBackToList();
      }, MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS);
    } else {
      setMobilePreviewSwipeTransition(false);
      setMobilePreviewSwipeOffset(0);
      handleBackToList();
    }
  }, [clearMobilePreviewSwipeTimeout, handleBackToList]);
  const handlePreviewEdgeTouchStart = useCallback((event) => {
    if (!isMobileFullscreenPreview) return;
    const firstTouch = event.touches?.[0];
    if (!firstTouch || firstTouch.clientX > MAIL_MOBILE_EDGE_SWIPE_ZONE_PX) return;
    if (shouldBlockMailEdgeGestureTarget(event.target, { blockTableScroll: true })) return;
    clearMobilePreviewSwipeTimeout();
    setMobilePreviewSwipeTransition(false);
    mobilePreviewSwipeRef.current = {
      startX: firstTouch.clientX,
      startY: firstTouch.clientY,
      lastX: firstTouch.clientX,
      startTime: Date.now(),
      locked: false,
      width: Math.max(
        Number(event.currentTarget?.clientWidth || 0),
        Number(typeof window !== 'undefined' ? window.innerWidth : 0),
      ),
    };
  }, [clearMobilePreviewSwipeTimeout, isMobileFullscreenPreview]);
  const handlePreviewEdgeTouchMove = useCallback((event) => {
    const gesture = mobilePreviewSwipeRef.current;
    if (!gesture) return;
    const firstTouch = event.touches?.[0];
    if (!firstTouch) return;
    const deltaX = firstTouch.clientX - gesture.startX;
    const deltaY = firstTouch.clientY - gesture.startY;
    if (!gesture.locked) {
      if (Math.abs(deltaX) < MAIL_MOBILE_EDGE_SWIPE_LOCK_PX && Math.abs(deltaY) < MAIL_MOBILE_EDGE_SWIPE_LOCK_PX) {
        return;
      }
      if (deltaX <= 0 || Math.abs(deltaY) > Math.abs(deltaX)) {
        resetMobilePreviewSwipe();
        return;
      }
      gesture.locked = true;
    }
    gesture.lastX = firstTouch.clientX;
    const nextOffset = Math.max(0, Math.min(deltaX, gesture.width || deltaX));
    setMobilePreviewSwipeTransition(false);
    setMobilePreviewSwipeOffset(nextOffset);
    if (event.cancelable) {
      event.preventDefault();
    }
  }, [resetMobilePreviewSwipe]);
  const handlePreviewEdgeTouchEnd = useCallback((event) => {
    const gesture = mobilePreviewSwipeRef.current;
    mobilePreviewSwipeRef.current = null;
    if (!gesture?.locked) {
      resetMobilePreviewSwipe();
      return;
    }
    const changedTouch = event.changedTouches?.[0];
    const finalX = changedTouch?.clientX ?? gesture.lastX;
    const deltaX = Math.max(0, finalX - gesture.startX);
    const durationMs = Math.max(1, Date.now() - gesture.startTime);
    const velocity = deltaX / durationMs;
    if (deltaX >= MAIL_MOBILE_EDGE_SWIPE_CLOSE_THRESHOLD_PX || velocity >= MAIL_MOBILE_EDGE_SWIPE_FLING_VELOCITY_PX_MS) {
      commitMobilePreviewSwipeClose(gesture.width);
      return;
    }
    resetMobilePreviewSwipe({ animate: deltaX > 0 });
  }, [commitMobilePreviewSwipeClose, resetMobilePreviewSwipe]);
  useEffect(() => {
    if (!isMobileFullscreenPreview) {
      resetMobilePreviewSwipe();
    }
  }, [isMobileFullscreenPreview, resetMobilePreviewSwipe]);
  useEffect(() => {
    if (!isMobile) {
      mobileHistoryReadyRef.current = false;
      mobileHistoryModeRef.current = 'list:closed:none:messages';
      return;
    }
    if (typeof window === 'undefined') return;
    const existingState = readMailMobileHistoryState();
    if (existingState) {
      mobileHistoryReadyRef.current = true;
      mobileHistoryModeRef.current = getMailMobileHistoryKey(existingState);
      return;
    }
    writeMailMobileHistoryState({
      view: 'list',
      drawerOpen: false,
      selectedId: '',
      selectionMode: viewModeRef.current,
    }, 'replace');
    if (selectedIdRef.current) {
      writeMailMobileHistoryState({
        view: 'preview',
        drawerOpen: false,
        selectedId: selectedIdRef.current,
        selectionMode: viewModeRef.current,
      }, 'push');
    }
    mobileHistoryReadyRef.current = true;
  }, [getMailMobileHistoryKey, isMobile, readMailMobileHistoryState, writeMailMobileHistoryState]);
  useEffect(() => {
    if (!isMobile || !mobileHistoryReadyRef.current || typeof window === 'undefined') return;
    const nextState = selectedId
      ? {
          view: 'preview',
          drawerOpen: false,
          selectedId,
          selectionMode: viewMode,
        }
      : {
          view: 'list',
          drawerOpen: Boolean(mobileNavigationOpen),
          selectedId: '',
          selectionMode: viewMode,
        };
    const currentState = readMailMobileHistoryState();
    const currentKey = currentState ? getMailMobileHistoryKey(currentState) : mobileHistoryModeRef.current;
    const nextKey = getMailMobileHistoryKey(nextState);
    if (currentKey === nextKey) return;
    writeMailMobileHistoryState(nextState, 'push');
  }, [
    getMailMobileHistoryKey,
    isMobile,
    mobileNavigationOpen,
    readMailMobileHistoryState,
    selectedId,
    viewMode,
    writeMailMobileHistoryState,
  ]);
  useEffect(() => {
    if (!isMobile || !mobileHistoryReadyRef.current || typeof window === 'undefined') return undefined;
    const handlePopState = (event) => {
      const nextState = readMailMobileHistoryState(event.state);
      if (!nextState) return;
      mobileHistoryModeRef.current = getMailMobileHistoryKey(nextState);
      if (nextState.view === 'preview' && nextState.selectedId) {
        setMobileNavigationOpen(false);
        if (viewModeRef.current !== nextState.selectionMode) {
          setViewMode(nextState.selectionMode);
        }
        setSelectedItems([]);
        setSelectedByMode((prev) => ({ ...(prev || {}), [nextState.selectionMode]: nextState.selectedId }));
        selectedIdRef.current = nextState.selectedId;
        setSelectedId(nextState.selectedId);
        return;
      }
      setMobileNavigationOpen(Boolean(nextState.drawerOpen));
      if (selectedIdRef.current) {
        clearSelection({
          mode: viewModeRef.current,
          restoreListState: viewModeRef.current === 'messages',
        });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [clearSelection, getMailMobileHistoryKey, isMobile, readMailMobileHistoryState]);
  useEffect(() => () => {
    clearMobilePreviewSwipeTimeout();
  }, [clearMobilePreviewSwipeTimeout]);

  const handleManageMailboxes = useCallback(() => {
    navigate('/settings');
  }, [navigate]);

  const handleSelectMailbox = useCallback((nextMailboxId) => {
    const normalizedMailboxId = normalizeMailboxId(nextMailboxId);
    if (!normalizedMailboxId || normalizedMailboxId === activeMailboxId) return;
    void refreshMailboxUnreadCounts({ mailboxIds: [normalizedMailboxId], force: true });
    const storedState = readStoredMailViewState(normalizedMailboxId);
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

  const applyBootstrapPayload = useCallback((payload, { applyList = true } = {}) => {
    const configPayload = payload?.selected_mailbox || payload?.mailboxInfo || null;
    const nextMailboxEntries = mergeMailboxEntries(payload?.mailboxes, configPayload, mailboxesRef.current);
    const resolvedMailboxId = getMailboxEntryId(configPayload) || activeMailboxId;
    const resolvedScope = resolvedMailboxId || mailCacheScope;
    const resolvedFolderSummaryCacheKey = buildMailFolderSummaryCacheKey({ scope: resolvedScope });
    const resolvedFolderTreeCacheKey = buildMailFolderTreeCacheKey({ scope: resolvedScope });
    const resolvedListCacheKey = buildMailListCacheKey({
      scope: resolvedScope,
      folder,
      viewMode,
      q: debouncedSearch,
      unreadOnly,
      hasAttachmentsOnly,
      dateFrom: filterDateFrom,
      dateTo: filterDateTo,
      folderScope: currentFolderScope,
      fromFilter: advancedFiltersApplied?.from_filter,
      toFilter: advancedFiltersApplied?.to_filter,
      subjectFilter: advancedFiltersApplied?.subject_filter,
      bodyFilter: advancedFiltersApplied?.body_filter,
      importance: advancedFiltersApplied?.importance,
      limit: 50,
      offset: 0,
    });
    const resolvedListContextKey = JSON.stringify(resolvedListCacheKey);
    const preferencesPayload = payload?.preferences?.preferences || payload?.preferences || {};
    const folderSummaryPayload = payload?.folder_summary && typeof payload.folder_summary === 'object'
      ? payload.folder_summary
      : {};
    const folderTreePayload = Array.isArray(payload?.folder_tree?.items) ? payload.folder_tree.items : [];
    const messagesPayload = payload?.messages || {};
    setMailboxInfo(configPayload);
    setMailboxes(nextMailboxEntries);
    if (resolvedMailboxId) {
      setSelectedMailboxId(resolvedMailboxId);
    }
    const nextPreferences = { ...DEFAULT_MAIL_PREFERENCES, ...(preferencesPayload || {}) };
    setMailPreferences(nextPreferences);
    setMailPreferencesDraft(nextPreferences);
    setFolderSummary(folderSummaryPayload);
    folderSummaryRefreshCompletedAtRef.current = Date.now();
    setFolderTree(folderTreePayload);
    setSWRCache(resolvedFolderSummaryCacheKey, { items: folderSummaryPayload });
    setSWRCache(resolvedFolderTreeCacheKey, { items: folderTreePayload });
    persistRecentBootstrapSnapshot(folderSummaryPayload, folderTreePayload, resolvedScope);
    if (applyList) {
      const previousListData = listDataRef.current || createEmptyListData();
      const normalizedMessagesPayload = normalizeMailListResponse(messagesPayload);
      const bootstrapHasVisibleMessages = Array.isArray(normalizedMessagesPayload.items)
        && normalizedMessagesPayload.items.length > 0;
      skipNextListRefreshRef.current = bootstrapHasVisibleMessages;
      const resolvedListData = applyReadStateOverridesToListData(buildMailListState({
        previousListData,
        nextListData: normalizedMessagesPayload,
        updateMode: currentListKeyRef.current === resolvedListContextKey && isExpandedMailListData(previousListData)
          ? 'head-merge'
          : 'replace',
        selectionMode: viewMode,
      }), viewMode);
      listDataRef.current = resolvedListData;
      setListData((prev) => {
        const prevItems = Array.isArray(prev?.items) ? prev.items : [];
        const nextItems = Array.isArray(resolvedListData.items) ? resolvedListData.items : [];
        const sameItems = prevItems.length === nextItems.length
          && prevItems.every((item, index) => isListItemSame(item, nextItems[index], viewMode));
        const sameMeta = Number(prev?.total || 0) === Number(resolvedListData.total || 0)
          && Number(prev?.offset || 0) === Number(resolvedListData.offset || 0)
          && Number(prev?.limit || 0) === Number(resolvedListData.limit || 0)
          && Boolean(prev?.has_more) === Boolean(resolvedListData.has_more)
          && String(prev?.next_offset ?? '') === String(resolvedListData.next_offset ?? '')
          && String(prev?.append_offset ?? '') === String(resolvedListData.append_offset ?? '')
          && Number(prev?.loaded_pages || 0) === Number(resolvedListData.loaded_pages || 0)
          && Boolean(prev?.search_limited) === Boolean(resolvedListData.search_limited)
          && Number(prev?.searched_window || 0) === Number(resolvedListData.searched_window || 0);
        if (sameItems && sameMeta) return prev;
        return resolvedListData;
      });
      if (bootstrapHasVisibleMessages) {
        setSWRCache(resolvedListCacheKey, resolvedListData);
        persistRecentListSnapshot(resolvedListContextKey, resolvedListData, resolvedScope);
      }
    }
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    applyReadStateOverridesToListData,
    currentFolderScope,
    debouncedSearch,
    filterDateFrom,
    filterDateTo,
    folder,
    hasAttachmentsOnly,
    mailCacheScope,
    persistRecentBootstrapSnapshot,
    persistRecentListSnapshot,
    unreadOnly,
    viewMode,
  ]);

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

  const refreshBootstrap = useCallback(async ({ force = false } = {}) => {
    const bootstrapCacheKey = buildMailBootstrapCacheKey({ scope: mailCacheScope, limit: MAIL_BOOTSTRAP_LIMIT });
    const shouldApplyBootstrapList = currentContextUsesBootstrapList;
    const cachedBootstrap = peekSWRCache(bootstrapCacheKey, { staleTimeMs: MAIL_SWR_STALE_TIME_MS });
    const hasRecentHydration = recentHydratedScope === mailCacheScope;
    if (cachedBootstrap?.data) {
      applyBootstrapPayload(cachedBootstrap.data || {}, { applyList: shouldApplyBootstrapList });
      setMailConfigLoading(false);
    } else {
      setMailConfigLoading(true);
    }
    if (hasRecentHydration) {
      setMailBackgroundRefreshing(true);
    }
    try {
      const fetcher = () => mailAPI.getBootstrap({ limit: MAIL_BOOTSTRAP_LIMIT, mailbox_id: activeMailboxId || undefined });
      const result = await getOrFetchSWR(
        bootstrapCacheKey,
        fetcher,
        {
          staleTimeMs: MAIL_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        }
      );
      if (result?.data) {
        applyBootstrapPayload(result.data || {}, { applyList: shouldApplyBootstrapList });
      }
      if (result?.fromCache && !result?.isFresh) {
        void getOrFetchSWR(
          bootstrapCacheKey,
          fetcher,
          {
            staleTimeMs: MAIL_SWR_STALE_TIME_MS,
            force: true,
            revalidateStale: false,
          }
        ).then((freshResult) => {
          if (freshResult?.data) {
            applyBootstrapPayload(freshResult.data || {}, { applyList: shouldApplyBootstrapList });
          }
        }).catch(() => {});
      }
      return result?.data || null;
    } catch (requestError) {
      if (!cachedBootstrap?.data && !hasRecentHydration) {
        setMailboxInfo(null);
        setFolderSummary({});
        setFolderTree([]);
        setListData(createEmptyListData());
        setError(getMailErrorDetail(requestError, 'Не удалось загрузить почтовый экран.'));
      }
      return null;
    } finally {
      setMailConfigLoading(false);
      if (hasRecentHydration) {
        setMailBackgroundRefreshing(false);
      }
    }
  }, [
    activeMailboxId,
    applyBootstrapPayload,
    currentContextUsesBootstrapList,
    getMailErrorDetail,
    mailCacheScope,
    recentHydratedScope,
  ]);

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
        ? 'Пароль корпоративной почты устарел или неверен. Введите новый пароль.'
        : '',
    });
    setError(errorCode === 'MAIL_AUTH_INVALID'
      ? 'Пароль корпоративной почты устарел или неверен. Введите новый пароль.'
      : String(fallbackMessage || '').trim());
    return true;
  }, [getMailErrorCode, mailboxInfo, openMailCredentialsDialog, refreshConfig]);

  const refreshTemplates = useCallback(async () => {
    try {
      const data = await mailAPI.getTemplates({ include_inactive: canManageUsers ? true : undefined });
      setTemplates(Array.isArray(data?.items) ? data.items : []);
      templatesLoadedRef.current = true;
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось загрузить шаблоны IT-заявок.');
    }
  }, [canManageUsers]);

  const refreshFolderSummary = useCallback(async ({ force = false } = {}) => {
    if (!mailAccessReady) {
      setFolderSummary({});
      return {};
    }
    try {
      const result = await getOrFetchSWR(
        currentFolderSummaryCacheKey,
        () => mailAPI.getFolderSummary({ mailbox_id: activeMailboxId || undefined }),
        {
          staleTimeMs: MAIL_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        }
      );
      const data = result?.data || {};
      const nextItems = data?.items && typeof data.items === 'object' ? data.items : {};
      setFolderSummary(nextItems);
      folderSummaryRefreshCompletedAtRef.current = Date.now();
      persistRecentBootstrapSnapshot(nextItems, folderTreeRef.current, activeMailboxId || mailCacheScope);
      return nextItems;
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError)) {
        setFolderSummary({});
        return {};
      }
      setFolderSummary({});
      return {};
    }
  }, [
    activeMailboxId,
    currentFolderSummaryCacheKey,
    handleMailCredentialsRequired,
    mailAccessReady,
    mailCacheScope,
    persistRecentBootstrapSnapshot,
  ]);

  const refreshFolderTree = useCallback(async ({ force = false } = {}) => {
    if (!mailAccessReady) {
      setFolderTree([]);
      return [];
    }
    try {
      const result = await getOrFetchSWR(
        currentFolderTreeCacheKey,
        () => mailAPI.getFolderTree({ mailbox_id: activeMailboxId || undefined }),
        {
          staleTimeMs: MAIL_SWR_STALE_TIME_MS,
          force,
          revalidateStale: false,
        }
      );
      const data = result?.data || {};
      const nextItems = Array.isArray(data?.items) ? data.items : [];
      setFolderTree(nextItems);
      persistRecentBootstrapSnapshot(folderSummaryRef.current, nextItems, activeMailboxId || mailCacheScope);
      return nextItems;
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError)) {
        setFolderTree([]);
        return [];
      }
      setFolderTree([]);
      return [];
    }
  }, [
    activeMailboxId,
    currentFolderTreeCacheKey,
    handleMailCredentialsRequired,
    mailAccessReady,
    mailCacheScope,
    persistRecentBootstrapSnapshot,
  ]);

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

  const startCreateTemplate = useCallback(() => {
    setTemplateEditId('');
    setTemplateCode('');
    setTemplateTitle('');
    setTemplateCategory('');
    setTemplateSubject('');
    setTemplateBody('');
    setTemplateFields([]);
  }, []);

  const startEditTemplate = useCallback((template) => {
    if (!template || typeof template !== 'object') {
      startCreateTemplate();
      return;
    }
    const fields = Array.isArray(template.fields) ? template.fields : [];
    setTemplateEditId(String(template.id || ''));
    setTemplateCode(String(template.code || ''));
    setTemplateTitle(String(template.title || ''));
    setTemplateCategory(String(template.category || ''));
    setTemplateSubject(String(template.subject_template || ''));
    setTemplateBody(String(template.body_template_md || ''));
    setTemplateFields(fields.map((field, index) => ({
      key: normalizeTemplateFieldKey(field?.key) || `field_${index + 1}`,
      label: String(field?.label || `Поле ${index + 1}`),
      type: String(field?.type || 'text'),
      required: Boolean(field?.required ?? true),
      placeholder: String(field?.placeholder || ''),
      default_value: Array.isArray(field?.default_value)
        ? field.default_value.join(', ')
        : String(field?.default_value ?? ''),
      options: normalizeTemplateFieldOptions(field?.options),
    })));
  }, [startCreateTemplate]);

  const addTemplateField = useCallback(() => {
    setTemplateFields((prev) => [...prev, makeTemplateField(prev.length)]);
  }, []);

  const moveTemplateField = useCallback((index, direction) => {
    setTemplateFields((prev) => {
      const from = Number(index);
      const delta = Number(direction);
      const to = from + delta;
      if (from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }, []);

  const removeTemplateField = useCallback((index) => {
    setTemplateFields((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const updateTemplateField = useCallback((index, patch) => {
    setTemplateFields((prev) => prev.map((field, itemIndex) => {
      if (itemIndex !== index) return field;
      return {
        ...field,
        ...(patch || {}),
      };
    }));
  }, []);

  const saveTemplate = useCallback(async () => {
    const code = String(templateCode || '').trim().toLowerCase();
    const title = String(templateTitle || '').trim();
    const subject = String(templateSubject || '').trim();
    if (!code) {
      setError('Укажите код шаблона.');
      return;
    }
    if (!title) {
      setError('Укажите название шаблона.');
      return;
    }
    if (!subject) {
      setError('Укажите тему шаблона.');
      return;
    }

    const seenKeys = new Set();
    const fieldsPayload = (Array.isArray(templateFields) ? templateFields : []).map((field, index) => {
      let key = normalizeTemplateFieldKey(field?.key) || `field_${index + 1}`;
      if (seenKeys.has(key)) {
        let suffix = 2;
        while (seenKeys.has(`${key}_${suffix}`)) suffix += 1;
        key = `${key}_${suffix}`;
      }
      seenKeys.add(key);
      const type = String(field?.type || 'text');
      const options = normalizeTemplateFieldOptions(field?.options);
      let defaultValue = field?.default_value ?? '';
      if (type === 'multiselect') {
        defaultValue = normalizeTemplateFieldOptions(defaultValue);
      } else if (type === 'checkbox') {
        const normalized = String(defaultValue).trim().toLowerCase();
        defaultValue = ['1', 'true', 'yes', 'on', 'да'].includes(normalized);
      } else {
        defaultValue = String(defaultValue || '');
      }
      return {
        key,
        label: String(field?.label || key),
        type,
        required: Boolean(field?.required ?? true),
        placeholder: String(field?.placeholder || ''),
        default_value: defaultValue,
        options,
      };
    });

    const payload = {
      code,
      title,
      category: String(templateCategory || '').trim(),
      subject_template: subject,
      body_template_md: String(templateBody || ''),
      fields: fieldsPayload,
    };

    setTemplateSaving(true);
    try {
      const saved = templateEditId
        ? await mailAPI.updateTemplate(templateEditId, payload)
        : await mailAPI.createTemplate(payload);
      await refreshTemplates();
      startEditTemplate(saved);
      setMessage(templateEditId ? 'Шаблон обновлен.' : 'Шаблон создан.');
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось сохранить шаблон.');
    } finally {
      setTemplateSaving(false);
    }
  }, [
    templateCode,
    templateTitle,
    templateSubject,
    templateFields,
    templateCategory,
    templateBody,
    templateEditId,
    refreshTemplates,
    startEditTemplate,
  ]);

  const deleteTemplate = useCallback(async () => {
    if (!templateEditId) return;
    setTemplateDeleting(true);
    try {
      await mailAPI.deleteTemplate(templateEditId);
      await refreshTemplates();
      startCreateTemplate();
      setMessage('Шаблон деактивирован.');
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось удалить шаблон.');
    } finally {
      setTemplateDeleting(false);
    }
  }, [templateEditId, refreshTemplates, startCreateTemplate]);

  const applyResolvedListData = useCallback((nextListData, {
    reset = true,
    selectionMode = viewMode,
    selectFirstIfSelectionMissing = false,
    updateMode = reset ? 'replace' : 'append',
  } = {}) => {
    const normalizedMode = normalizeMailViewMode(selectionMode);
    const previousListData = listDataRef.current || createEmptyListData();
    const resolvedListData = applyReadStateOverridesToListData(buildMailListState({
      previousListData,
      nextListData,
      updateMode,
      selectionMode: normalizedMode,
    }), normalizedMode);
    const incomingItems = Array.isArray(resolvedListData?.items) ? resolvedListData.items : [];
    listDataRef.current = resolvedListData;
    setListData((prev) => {
      const prevItems = Array.isArray(prev?.items) ? prev.items : [];
      const sameItems = prevItems.length === incomingItems.length
        && prevItems.every((item, index) => isListItemSame(item, incomingItems[index], normalizedMode));
      const sameMeta = Number(prev?.total || 0) === Number(resolvedListData.total || 0)
        && Number(prev?.offset || 0) === Number(resolvedListData.offset || 0)
        && Number(prev?.limit || 0) === Number(resolvedListData.limit || 0)
        && Boolean(prev?.has_more) === Boolean(resolvedListData.has_more)
        && String(prev?.next_offset ?? '') === String(resolvedListData.next_offset ?? '')
        && String(prev?.append_offset ?? '') === String(resolvedListData.append_offset ?? '')
        && Number(prev?.loaded_pages || 0) === Number(resolvedListData.loaded_pages || 0)
        && Boolean(prev?.search_limited) === Boolean(resolvedListData.search_limited)
        && Number(prev?.searched_window || 0) === Number(resolvedListData.searched_window || 0);
      if (sameItems && sameMeta) return prev;
      return resolvedListData;
    });
    setSWRCache(currentListCacheKey, resolvedListData);
    if (reset) {
      const currentSelectedId = String(selectedIdRef.current || '');
      const exists = incomingItems.some((item) => String(normalizedMode === 'conversations' ? item.conversation_id : item.id) === currentSelectedId);
      if (currentSelectedId && !exists) {
        const firstItem = incomingItems[0] || null;
        const nextSelectedId = firstItem
          ? String(normalizedMode === 'conversations' ? (firstItem.conversation_id || firstItem.id || '') : (firstItem.id || ''))
          : '';
        if (selectFirstIfSelectionMissing && nextSelectedId) {
          suppressNextAutoReadRef.current = `${normalizedMode}:${folder}:${nextSelectedId}`;
          selectedIdRef.current = nextSelectedId;
          setSelectedId(nextSelectedId);
          setSelectedByMode((prev) => ({ ...(prev || {}), [normalizedMode]: nextSelectedId }));
        } else {
          const selectedDetail = normalizedMode === 'conversations'
            ? selectedConversationRef.current
            : selectedMessageRef.current;
          const selectedDetailId = normalizedMode === 'conversations'
            ? String(selectedDetail?.conversation_id || selectedDetail?.id || '')
            : String(selectedDetail?.id || '');
          if (selectedDetailId !== currentSelectedId) {
            clearSelection({
              mode: normalizedMode,
              restoreListState: isMobile && normalizedMode === 'messages',
            });
          }
        }
      }
    }
    persistRecentListSnapshot(currentListContextKey, resolvedListData);
    return resolvedListData;
  }, [applyReadStateOverridesToListData, clearSelection, currentListCacheKey, currentListContextKey, folder, isMobile, persistRecentListSnapshot, viewMode]);

  const invalidateMailClientCache = useCallback((prefixes = ['bootstrap', 'folder-summary', 'folder-tree', 'list', 'message-detail', 'conversation-detail']) => {
    (Array.isArray(prefixes) ? prefixes : []).forEach((prefix) => {
      invalidateSWRCacheByPrefix('mail', mailCacheScope, prefix);
    });
    clearMailRecentCacheForScope(mailCacheScope);
  }, [mailCacheScope]);

  const fetchList = useCallback(async ({
    reset = true,
    silent = false,
    selectFirstIfSelectionMissing = false,
    force = false,
  } = {}) => {
    if (!mailAccessReady) {
      if (reset) {
        setListData(createEmptyListData());
      }
      return null;
    }
    const currentListData = listDataRef.current || {};
    const currentOffset = reset ? 0 : Number(currentListData.append_offset ?? currentListData.next_offset ?? currentListData.offset ?? 0);
    const cachedList = reset ? peekSWRCache(currentListCacheKey, { staleTimeMs: MAIL_SWR_STALE_TIME_MS }) : null;
    const nextContextKey = JSON.stringify(currentListCacheKey);
    const shouldForceHydratedRefresh = reset && recentHydratedListContextsRef.current.has(nextContextKey);
    const forceNetwork = force || shouldForceHydratedRefresh;
    const isContextSwitchWithoutCache = reset
      && String(currentListKeyRef.current || '') !== nextContextKey
      && !cachedList?.data;
    if (reset) {
      currentListKeyRef.current = nextContextKey;
    } else {
      setLoadingMore(true);
    }
    try {
      const fetcher = (params) => (
        viewMode === 'conversations'
          ? mailAPI.getConversations(withActiveMailboxParams(params))
          : mailAPI.getMessages(withActiveMailboxParams(params))
      );
      if (reset) {
        const contextKey = nextContextKey;
        if (cachedList?.data) {
          applyResolvedListData(cachedList.data, {
            reset: true,
            selectionMode: viewMode,
            selectFirstIfSelectionMissing,
          });
          setLoading(false);
        } else if (!silent) {
          if (isContextSwitchWithoutCache) {
            const emptyList = createEmptyListData();
            listDataRef.current = emptyList;
            setListData(emptyList);
          }
          setLoading(true);
        }

        const result = await getOrFetchSWR(
          currentListCacheKey,
          () => fetcher(currentListParams),
          {
            staleTimeMs: MAIL_SWR_STALE_TIME_MS,
            force: forceNetwork,
            revalidateStale: false,
          }
        );
        if (shouldForceHydratedRefresh) {
          recentHydratedListContextsRef.current.delete(contextKey);
        }
        if (currentListKeyRef.current === contextKey && result?.data) {
          const nextUpdateMode = !result?.fromCache && isExpandedMailListData(listDataRef.current)
            ? 'head-merge'
            : 'replace';
          applyResolvedListData(result.data, {
            reset: true,
            selectionMode: viewMode,
            selectFirstIfSelectionMissing,
            updateMode: nextUpdateMode,
          });
        }
        if (result?.fromCache && !result?.isFresh) {
          void getOrFetchSWR(
            currentListCacheKey,
            () => fetcher(currentListParams),
            {
              staleTimeMs: MAIL_SWR_STALE_TIME_MS,
              force: true,
              revalidateStale: false,
            }
          ).then((freshResult) => {
            if (currentListKeyRef.current !== contextKey || !freshResult?.data) return;
            applyResolvedListData(freshResult.data, {
              reset: true,
              selectionMode: viewMode,
              selectFirstIfSelectionMissing,
              updateMode: isExpandedMailListData(listDataRef.current) ? 'head-merge' : 'replace',
            });
          }).catch(() => {});
        }
        return normalizeMailListResponse(result?.data);
      }

      const params = {
        ...currentListParams,
        offset: currentOffset,
      };
      const data = await fetcher(params);
      return applyResolvedListData(data, { reset: false, selectionMode: viewMode, updateMode: 'append' });
    } catch (requestError) {
      if (await handleMailCredentialsRequired(requestError)) {
        if (reset) setListData((prev) => ({ ...prev, items: [] }));
        return null;
      }
      const currentVisibleList = listDataRef.current;
      const hasVisibleItems = Array.isArray(currentVisibleList?.items) && currentVisibleList.items.length > 0;
      if (silent && isTransientMailRequestError(requestError) && (hasVisibleItems || cachedList?.data)) {
        return normalizeMailListResponse(hasVisibleItems ? currentVisibleList : cachedList?.data);
      }
      setError(getMailErrorDetail(requestError, 'Не удалось загрузить список писем.'));
      if (reset && !cachedList?.data && recentHydratedScope !== mailCacheScope) {
        setListData((prev) => ({ ...prev, items: [] }));
      }
      return null;
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, [
    activeMailboxId,
    applyResolvedListData,
    currentListCacheKey,
    currentListParams,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    isTransientMailRequestError,
    mailAccessReady,
    mailCacheScope,
    recentHydratedScope,
    withActiveMailboxParams,
    viewMode,
  ]);

  const refreshList = useCallback(async ({
    silent = false,
    selectFirstIfSelectionMissing = false,
    force = false,
  } = {}) => {
    return fetchList({ reset: true, silent, selectFirstIfSelectionMissing, force });
  }, [fetchList]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !listData.has_more || listData.append_offset === null) return;
    await fetchList({ reset: false, silent: true });
  }, [loadingMore, listData.append_offset, listData.has_more, fetchList]);
  const revalidateSelectedMailDetail = useCallback(async ({ force = false } = {}) => {
    if (!mailAccessReady || !selectedId) return null;
    const folderScope = advancedFiltersApplied?.folder_scope || 'current';
    const currentSelectionKey = `${viewMode}:${folder}:${selectedId}`;
    const detailCacheKey = viewMode === 'conversations'
      ? buildMailConversationDetailCacheKey({
          scope: mailCacheScope,
          conversationId: selectedId,
          folder,
          folderScope,
        })
      : buildMailMessageDetailCacheKey({
          scope: mailCacheScope,
          messageId: selectedId,
        });
    const cachedDetail = peekSWRCache(detailCacheKey, { staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS });
    if (!force && cachedDetail?.data && cachedDetail?.isFresh) {
      return cachedDetail.data;
    }
    const fetcher = () => (
      viewMode === 'conversations'
        ? mailAPI.getConversation(selectedId, withActiveMailboxParams({ folder, folder_scope: folderScope }))
        : mailAPI.getMessage(selectedId, { mailboxId: activeMailboxId })
    );
    const result = await getOrFetchSWR(
      detailCacheKey,
      fetcher,
      {
        staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS,
        force: force || Boolean(cachedDetail?.data),
        revalidateStale: false,
      }
    );
    if (!result?.data || detailContextRef.current !== currentSelectionKey) return result?.data || null;
    if (viewMode === 'conversations') {
      const nextConversation = applyReadStateOverridesToConversationDetail(result.data);
      const items = Array.isArray(nextConversation?.items) ? nextConversation.items : [];
      setSelectedConversation(nextConversation || null);
      setSelectedMessage(items.length > 0 ? items[items.length - 1] : null);
      return nextConversation || result.data;
    }
    const nextMessage = applyReadStateOverridesToMessageDetail(
      mergeMessageDetailPreservingBody(result.data, selectedMessageRef.current)
    );
    setSWRCache(detailCacheKey, nextMessage);
    persistRecentMessageDetailSnapshot(nextMessage);
    setSelectedConversation(null);
    setSelectedMessage(nextMessage || null);
    return nextMessage || result.data;
  }, [
    activeMailboxId,
    advancedFiltersApplied?.folder_scope,
    applyReadStateOverridesToConversationDetail,
    applyReadStateOverridesToMessageDetail,
    folder,
    mailAccessReady,
    mailCacheScope,
    persistRecentMessageDetailSnapshot,
    selectedId,
    withActiveMailboxParams,
    viewMode,
  ]);
  const silentRevalidateCurrentMailView = useCallback(async ({ reason = 'auto', force = false } = {}) => {
    if (!mailAccessReady) return;
    const refreshKey = `${mailCacheScope}:${currentListContextKey}:${viewMode}:${folder}`;
    const inFlight = mailViewRefreshInFlightRef.current.get(refreshKey);
    if (inFlight) return inFlight;
    const now = Date.now();
    const lastCompletedAt = Number(mailViewRefreshCompletedAtRef.current.get(refreshKey) || 0);
    if (!force && reason !== 'mail-needs-refresh' && (now - lastCompletedAt) < MAIL_VIEW_REFRESH_COOLDOWN_MS) {
      return null;
    }
    const refreshPromise = (async () => {
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
        mailViewRefreshCompletedAtRef.current.set(refreshKey, Date.now());
        mailViewRefreshInFlightRef.current.delete(refreshKey);
        setMailBackgroundRefreshing(false);
      }
    })();
    mailViewRefreshInFlightRef.current.set(refreshKey, refreshPromise);
    return refreshPromise;
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
    viewMode,
  ]);

  const emitMailUnreadRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('mail-read'));
  }, []);

  const updateCurrentFolderUnread = useCallback((delta) => {
    if (!delta) return;
    setFolderSummary((prev) => {
      const current = prev?.[folder];
      if (!current) return prev;
      return {
        ...(prev || {}),
        [folder]: {
          ...(current || {}),
          unread: Math.max(0, Number(current?.unread || 0) + Number(delta || 0)),
        },
      };
    });
  }, [folder]);

  const applyMessageReadStateLocally = useCallback(({ messageId, isRead, unreadDelta = 0 }) => {
    const normalizedMessageId = String(messageId || '');
    if (!normalizedMessageId) return;
    const applyToList = (source) => ({
      ...(source || {}),
      items: (Array.isArray(source?.items) ? source.items : []).map((item) => (
        String(item?.id || '') === normalizedMessageId ? { ...item, is_read: Boolean(isRead) } : item
      )),
    });
    listDataRef.current = applyToList(listDataRef.current);
    setListData((prev) => applyToList(prev));
    setSelectedMessage((prev) => {
      if (String(prev?.id || '') !== normalizedMessageId) return prev;
      const nextMessage = { ...(prev || {}), is_read: Boolean(isRead) };
      selectedMessageRef.current = nextMessage;
      return nextMessage;
    });
    if (String(selectedMessageRef.current?.id || '') === normalizedMessageId) {
      selectedMessageRef.current = {
        ...(selectedMessageRef.current || {}),
        is_read: Boolean(isRead),
      };
    }
    const recentDetail = getRecentMessageDetailSnapshot(normalizedMessageId);
    if (recentDetail) {
      persistRecentMessageDetailSnapshot({
        ...recentDetail,
        is_read: Boolean(isRead),
      });
    }
    updateCurrentFolderUnread(unreadDelta);
  }, [mailCacheScope, persistRecentMessageDetailSnapshot, updateCurrentFolderUnread]);

  const applyConversationReadStateLocally = useCallback(({
    conversationId,
    isRead,
    unreadCount = 0,
    messageCount = 0,
    unreadDelta = 0,
  }) => {
    const normalizedConversationId = String(conversationId || '');
    if (!normalizedConversationId) return;
    const finalUnreadCount = Boolean(isRead)
      ? 0
      : Math.max(
          1,
          Number(messageCount || 0),
          Number(unreadCount || 0),
        );
    const applyToList = (source) => ({
      ...(source || {}),
      items: (Array.isArray(source?.items) ? source.items : []).map((item) => (
        String(item?.conversation_id || item?.id || '') === normalizedConversationId
          ? { ...item, unread_count: finalUnreadCount }
          : item
      )),
    });
    listDataRef.current = applyToList(listDataRef.current);
    setListData((prev) => applyToList(prev));
    setSelectedConversation((prev) => {
      if (String(prev?.conversation_id || '') !== normalizedConversationId) return prev;
      const nextConversation = {
        ...(prev || {}),
        unread_count: finalUnreadCount,
        items: (Array.isArray(prev?.items) ? prev.items : []).map((item) => ({
          ...item,
          is_read: Boolean(isRead),
        })),
      };
      selectedConversationRef.current = nextConversation;
      return nextConversation;
    });
    if (String(selectedConversationRef.current?.conversation_id || '') === normalizedConversationId) {
      selectedConversationRef.current = {
        ...(selectedConversationRef.current || {}),
        unread_count: finalUnreadCount,
        items: (Array.isArray(selectedConversationRef.current?.items) ? selectedConversationRef.current.items : []).map((item) => ({
          ...item,
          is_read: Boolean(isRead),
        })),
      };
    }
    setSelectedMessage((prev) => {
      if (!prev) return prev;
      if (String(prev?.conversation_id || '') !== normalizedConversationId) return prev;
      const nextMessage = { ...(prev || {}), is_read: Boolean(isRead) };
      selectedMessageRef.current = nextMessage;
      return nextMessage;
    });
    if (String(selectedMessageRef.current?.conversation_id || '') === normalizedConversationId) {
      selectedMessageRef.current = {
        ...(selectedMessageRef.current || {}),
        is_read: Boolean(isRead),
      };
    }
    updateCurrentFolderUnread(unreadDelta);
  }, [updateCurrentFolderUnread]);

  const performMailReadMutation = useCallback(async ({
    mode,
    targetId,
    nextIsRead,
    currentUnreadCount = 0,
    currentMessageCount = 1,
    errorMessage = 'Не удалось изменить статус письма.',
    autoReadGuardKey = '',
  }) => {
    const normalizedMode = mode === 'conversations' ? 'conversations' : 'messages';
    const normalizedTargetId = String(targetId || '');
    if (!normalizedTargetId) return false;
    const normalizedUnreadCount = Math.max(0, Number(currentUnreadCount || 0));
    const normalizedMessageCount = Math.max(1, Number(currentMessageCount || 1));
    const unreadDelta = normalizedMode === 'conversations'
      ? (nextIsRead ? -normalizedUnreadCount : Math.max(0, normalizedMessageCount - normalizedUnreadCount))
      : (nextIsRead ? (normalizedUnreadCount > 0 ? -1 : 0) : (normalizedUnreadCount > 0 ? 0 : 1));

    setLocalReadStateOverride(normalizedMode, normalizedTargetId, nextIsRead);
    if (normalizedMode === 'conversations') {
      applyConversationReadStateLocally({
        conversationId: normalizedTargetId,
        isRead: nextIsRead,
        unreadCount: normalizedUnreadCount,
        messageCount: normalizedMessageCount,
        unreadDelta,
      });
    } else {
      applyMessageReadStateLocally({
        messageId: normalizedTargetId,
        isRead: nextIsRead,
        unreadDelta,
      });
    }

    let mutationSucceeded = false;
    try {
      if (normalizedMode === 'conversations') {
        const payload = withActiveMailboxPayload({
          folder,
          folder_scope: advancedFiltersApplied?.folder_scope || 'current',
        });
        if (nextIsRead) {
          await mailAPI.markConversationAsRead(normalizedTargetId, payload);
        } else {
          await mailAPI.markConversationAsUnread(normalizedTargetId, payload);
        }
      } else if (nextIsRead) {
        if (activeMailboxId) await mailAPI.markAsRead(normalizedTargetId, activeMailboxId);
        else await mailAPI.markAsRead(normalizedTargetId);
      } else {
        if (activeMailboxId) await mailAPI.markAsUnread(normalizedTargetId, activeMailboxId);
        else await mailAPI.markAsUnread(normalizedTargetId);
      }

      invalidateMailClientCache(['bootstrap', 'list', 'notification-feed']);
      emitMailUnreadRefresh();
      const refreshTasks = [];
      if (unreadOnly) {
        refreshTasks.unshift(
          refreshList({
            silent: true,
            selectFirstIfSelectionMissing: Boolean(nextIsRead && unreadOnly),
            force: true,
          })
        );
      }
      if (refreshTasks.length > 0) {
        await Promise.all(refreshTasks);
      }
      mutationSucceeded = true;
      return true;
    } catch (requestError) {
      clearLocalReadStateOverride(normalizedMode, normalizedTargetId);
      await Promise.allSettled([
        refreshList({ silent: true, force: true }),
        refreshFolderSummary({ force: true }),
      ]);
      if (await handleMailCredentialsRequired(requestError, errorMessage)) {
        return false;
      }
      setError(getMailErrorDetail(requestError, errorMessage));
      return false;
    } finally {
      settleAutoReadGuard(autoReadGuardKey, mutationSucceeded);
    }
  }, [
    advancedFiltersApplied,
    applyConversationReadStateLocally,
    applyMessageReadStateLocally,
    clearLocalReadStateOverride,
    emitMailUnreadRefresh,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    refreshFolderSummary,
    refreshList,
    settleAutoReadGuard,
    setLocalReadStateOverride,
    withActiveMailboxPayload,
    activeMailboxId,
    unreadOnly,
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
    try {
      const raw = window.localStorage.getItem(MAIL_RECENT_SEARCHES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      setRecentSearches(Array.isArray(parsed) ? parsed : []);
    } catch {
      setRecentSearches([]);
    }
  }, []);

  useEffect(() => {
    if (!templatesOpen) {
      templatesInitRef.current = false;
      return;
    }
    if (!templatesLoadedRef.current) {
      refreshTemplates();
      return;
    }
    if (templatesInitRef.current) return;
    templatesInitRef.current = true;
    if (!templateEditId) {
      if (templates.length > 0) startEditTemplate(templates[0]);
      else startCreateTemplate();
    }
  }, [templatesOpen, templateEditId, templates, startEditTemplate, startCreateTemplate, refreshTemplates]);

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
      candidateIds.forEach((id) => prefetchMailDetail(id, { mode: 'messages' }));
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
    if (!mailAccessReady || !selectedId) {
      if (detailRequestAbortRef.current) {
        detailRequestAbortRef.current.abort();
        detailRequestAbortRef.current = null;
      }
      detailContextRef.current = '';
      setDetailLoading(false);
      setSelectedMessage(null);
      setSelectedConversation(null);
      return;
    }
    const detailContextKey = `${viewMode}:${folder}:${selectedId}`;
    const shouldShowSkeleton = detailContextRef.current !== detailContextKey;
    detailContextRef.current = detailContextKey;
    const controller = new AbortController();
    if (detailRequestAbortRef.current) {
      detailRequestAbortRef.current.abort();
    }
    detailRequestAbortRef.current = controller;
    let cancelled = false;
    const folderScope = advancedFiltersApplied?.folder_scope || 'current';
    const detailCacheKey = viewMode === 'conversations'
      ? buildMailConversationDetailCacheKey({
          scope: mailCacheScope,
          conversationId: selectedId,
          folder,
          folderScope,
        })
      : buildMailMessageDetailCacheKey({
          scope: mailCacheScope,
          messageId: selectedId,
        });
    const applyDetailPayload = (data, { suppressAutoRead = false } = {}) => {
      if (!data) return;
      if (viewMode === 'conversations') {
        const nextConversation = applyReadStateOverridesToConversationDetail(data);
        const items = Array.isArray(nextConversation?.items) ? nextConversation.items : [];
        setSelectedConversation(nextConversation || null);
        setSelectedMessage(items.length > 0 ? items[items.length - 1] : null);
        const autoReadGuardKey = `${detailContextKey}:auto-read`;
        if (!suppressAutoRead && Number(nextConversation?.unread_count || 0) > 0 && beginAutoReadGuard(autoReadGuardKey)) {
          void performMailReadMutation({
            mode: 'conversations',
            targetId: String(nextConversation?.conversation_id || selectedId),
            nextIsRead: true,
            currentUnreadCount: Number(nextConversation?.unread_count || 0),
            currentMessageCount: Number(nextConversation?.messages_count || items.length || 1),
            errorMessage: 'Не удалось отметить диалог как прочитанный.',
            autoReadGuardKey,
          });
        }
      } else {
        const nextMessage = applyReadStateOverridesToMessageDetail(
          mergeMessageDetailPreservingBody(data, selectedMessageRef.current)
        );
        setSelectedConversation(null);
        setSelectedMessage(nextMessage || null);
        const autoReadGuardKey = `${detailContextKey}:auto-read`;
        if (!suppressAutoRead && nextMessage?.id && nextMessage?.is_read === false && beginAutoReadGuard(autoReadGuardKey)) {
          void performMailReadMutation({
            mode: 'messages',
            targetId: String(nextMessage.id),
            nextIsRead: true,
            currentUnreadCount: 1,
            currentMessageCount: 1,
            errorMessage: 'Не удалось отметить письмо как прочитанное.',
            autoReadGuardKey,
          });
        }
      }
    };
    const loadDetails = async () => {
      const cachedDetail = peekSWRCache(detailCacheKey, { staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS });
      const recentDetail = viewMode === 'messages'
        ? getRecentMessageDetailSnapshot(selectedId)
        : null;
      const preferRecentDetail = Boolean(
        viewMode === 'messages'
        && recentDetail
        && (!cachedDetail?.data || (!hasMessageBodyContent(cachedDetail.data) && hasMessageBodyContent(recentDetail)))
      );
      if (cachedDetail?.data && !preferRecentDetail) {
        const suppressAutoReadForSelection = suppressNextAutoReadRef.current === detailContextKey;
        if (suppressAutoReadForSelection) {
          suppressNextAutoReadRef.current = '';
        }
        applyDetailPayload(cachedDetail.data, { suppressAutoRead: suppressAutoReadForSelection });
        setDetailLoading(false);
      } else if (recentDetail) {
        const suppressAutoReadForSelection = suppressNextAutoReadRef.current === detailContextKey;
        if (suppressAutoReadForSelection) {
          suppressNextAutoReadRef.current = '';
        }
        applyDetailPayload(recentDetail, { suppressAutoRead: suppressAutoReadForSelection });
        setDetailLoading(false);
      } else if (shouldShowSkeleton) {
        setDetailLoading(true);
      }
      try {
        const suppressAutoReadForSelection = suppressNextAutoReadRef.current === detailContextKey;
        if (suppressAutoReadForSelection) {
          suppressNextAutoReadRef.current = '';
        }
        const fetcher = () => (
          viewMode === 'conversations'
            ? mailAPI.getConversation(
                selectedId,
                withActiveMailboxParams({ folder, folder_scope: folderScope }),
                { signal: controller.signal }
              )
            : mailAPI.getMessage(selectedId, { signal: controller.signal, mailboxId: activeMailboxId })
        );
        const result = await getOrFetchSWR(
          detailCacheKey,
          fetcher,
          {
            staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS,
            revalidateStale: false,
          }
        );
        if (cancelled || controller.signal.aborted) return;
        if (result?.data && detailContextRef.current === detailContextKey) {
          const nextDetail = viewMode === 'messages'
            ? applyReadStateOverridesToMessageDetail(
                mergeMessageDetailPreservingBody(result.data, selectedMessageRef.current)
              )
            : applyReadStateOverridesToConversationDetail(result.data);
          if (viewMode === 'messages') {
            setSWRCache(detailCacheKey, nextDetail);
            persistRecentMessageDetailSnapshot(nextDetail);
          }
          applyDetailPayload(nextDetail, { suppressAutoRead: suppressAutoReadForSelection });
        }
        if (result?.fromCache && !result?.isFresh) {
          void getOrFetchSWR(
            detailCacheKey,
            fetcher,
            {
              staleTimeMs: MAIL_DETAIL_SWR_STALE_TIME_MS,
              force: true,
              revalidateStale: false,
            }
          ).then((freshResult) => {
            if (cancelled || controller.signal.aborted || detailContextRef.current !== detailContextKey) return;
            if (freshResult?.data) {
              const nextDetail = viewMode === 'messages'
                ? applyReadStateOverridesToMessageDetail(
                    mergeMessageDetailPreservingBody(freshResult.data, selectedMessageRef.current)
                  )
                : applyReadStateOverridesToConversationDetail(freshResult.data);
              if (viewMode === 'messages') {
                setSWRCache(detailCacheKey, nextDetail);
                persistRecentMessageDetailSnapshot(nextDetail);
              }
              applyDetailPayload(nextDetail, { suppressAutoRead: suppressAutoReadForSelection });
            }
          }).catch(() => {});
        }
      } catch (requestError) {
        if (cancelled || controller.signal.aborted || requestError?.code === 'ERR_CANCELED') return;
        const errorDetail = getMailErrorDetail(requestError, 'Не удалось загрузить письмо.');
        const statusCode = Number(requestError?.response?.status || 0);
        if (viewMode === 'conversations' && statusCode === 404) {
          clearSelection({ mode: 'conversations' });
          return;
        }
        if (viewMode === 'messages' && isMissingMailDetailError(requestError, errorDetail)) {
          invalidateMailClientCache(['bootstrap', 'list', 'message-detail']);
          navigate(buildMailRoute({
            folder,
            mailboxId: activeMailboxId,
          }), { replace: true });
          clearSelection({ mode: 'messages' });
          void refreshList({ silent: true, force: true });
          setError('Выбранное письмо больше недоступно. Список обновлен.');
          return;
        }
        if (await handleMailCredentialsRequired(requestError)) return;
        const selectedMessageSnapshot = selectedMessageRef.current;
        const hasStableSelectedMessageBody = Boolean(
          selectedMessageSnapshot
          && !selectedMessageSnapshot?.__previewOnly
          && hasMessageBodyContent(selectedMessageSnapshot)
        );
        if (viewMode === 'messages' && hasStableSelectedMessageBody && isTransientMailRequestError(requestError)) {
          return;
        }
        setError(errorDetail);
      } finally {
        if (detailRequestAbortRef.current === controller) {
          detailRequestAbortRef.current = null;
        }
        if (!cancelled) setDetailLoading(false);
      }
    };
    loadDetails();
    return () => {
      cancelled = true;
      controller.abort();
      if (detailRequestAbortRef.current === controller) {
        detailRequestAbortRef.current = null;
      }
    };
  }, [
    activeMailboxId,
    advancedFiltersApplied,
    applyReadStateOverridesToConversationDetail,
    applyReadStateOverridesToMessageDetail,
    clearSelection,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    invalidateMailClientCache,
    isTransientMailRequestError,
    isMissingMailDetailError,
    mailAccessReady,
    mailCacheScope,
    navigate,
    beginAutoReadGuard,
    persistRecentMessageDetailSnapshot,
    performMailReadMutation,
    refreshList,
    selectedId,
    withActiveMailboxParams,
    viewMode,
  ]);

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

  const openComposeFromDraft = useCallback(() => {
    if (!selectedMessage || String(selectedMessage.folder || '').toLowerCase() !== 'drafts') return;
    const draftContext = selectedMessage?.draft_context || {};
    const splitDraftBody = splitQuotedHistoryHtml(selectedMessage.body_html || '');
    openComposeSession({
      composeMode: String(draftContext.compose_mode || 'draft'),
      composeFromMailboxId: resolveComposeMailboxId(draftContext.mailbox_id || selectedMessage?.mailbox_id),
      to: selectedMessage.to,
      cc: selectedMessage.cc,
      bcc: selectedMessage.bcc,
      subject: String(selectedMessage.subject || ''),
      composeBody: String(splitDraftBody?.primaryHtml || ''),
      composeQuotedOriginalHtml: String(splitDraftBody?.quotedHtml || ''),
      draftAttachments: Array.isArray(selectedMessage.attachments) ? selectedMessage.attachments : [],
      draftId: String(selectedMessage.id || ''),
      replyToMessageId: String(draftContext.reply_to_message_id || ''),
      forwardMessageId: String(draftContext.forward_message_id || ''),
      draftSyncState: 'synced',
    });
    try {
      window.localStorage.removeItem(composeDraftKey);
    } catch {
      // ignore local storage issues
    }
  }, [composeDraftKey, openComposeSession, resolveComposeMailboxId, selectedMessage]);

  const handleComposeSent = useCallback(async () => {
    setComposeSession(null);
    setMessage('Письмо отправлено.');
    invalidateMailClientCache();
    await refreshList({ silent: true, force: true });
    await refreshFolderSummary();
  }, [invalidateMailClientCache, refreshFolderSummary, refreshList]);

  const openSignatureEditor = useCallback(async (mailboxIdOverride = '') => {
    const targetMailboxId = resolveComposeMailboxId(mailboxIdOverride || activeMailboxId);
    try {
      const shouldUseActiveMailbox = !targetMailboxId || String(targetMailboxId) === String(activeMailboxId || '');
      const config = shouldUseActiveMailbox
        ? mailboxInfo
        : await mailAPI.getMyConfig({ mailbox_id: targetMailboxId || undefined });
      setSignatureMailboxId(targetMailboxId);
      setSignatureHtml(String(config?.mail_signature_html || ''));
      setSignatureOpen(true);
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось загрузить подпись.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось загрузить подпись.'));
      }
    }
  }, [
    activeMailboxId,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    mailboxInfo,
    resolveComposeMailboxId,
  ]);

  const handleSaveMailCredentials = useCallback(async () => {
    const login = String(mailCredentialsLogin || '').trim();
    const password = String(mailCredentialsPassword || '').trim();
    const mailboxEmail = String(mailCredentialsEmail || '').trim();
    if (!password) {
      setMailCredentialsError('Введите корпоративный пароль.');
      return;
    }
    setMailCredentialsSaving(true);
    setMailCredentialsError('');
    try {
      const data = await mailAPI.saveMyCredentials({
        mailbox_id: activeMailboxId || undefined,
        mailbox_login: login || undefined,
        mailbox_password: password,
        mailbox_email: mailboxEmail || undefined,
      });
      setMailboxInfo(data || null);
      setMailboxes((prev) => mergeMailboxEntries(prev, data || null));
      setMailCredentialsPassword('');
      setMailCredentialsOpen(false);
      setError('');
      setMessage('Корпоративный пароль сохранён в профиле. Этот ящик доступен на всех ваших устройствах.');
      invalidateMailClientCache();
      await refreshBootstrap({ force: true });
    } catch (requestError) {
      setMailCredentialsError(getMailErrorDetail(requestError, 'Не удалось сохранить корпоративный пароль.'));
    } finally {
      setMailCredentialsSaving(false);
    }
  }, [
    activeMailboxId,
    getMailErrorDetail,
    mailCredentialsEmail,
    mailCredentialsLogin,
    mailCredentialsPassword,
    invalidateMailClientCache,
    refreshBootstrap,
  ]);

  const handleSaveSignature = useCallback(async () => {
    const targetMailboxId = resolveComposeMailboxId(signatureMailboxId || activeMailboxId);
    setSignatureSaving(true);
    try {
      const data = await mailAPI.updateMyConfig({
        mailbox_id: targetMailboxId || undefined,
        mail_signature_html: String(signatureHtml || ''),
      });
      if (String(targetMailboxId || '') === String(activeMailboxId || '')) {
        setMailboxInfo(data || null);
      } else {
        setMailboxInfo((prev) => (
          prev
            ? { ...prev, mail_signature_html: String(data?.mail_signature_html || '') }
            : prev
        ));
      }
      setMailboxes((prev) => mergeMailboxEntries(prev, data || null));
      setSignatureOpen(false);
      setMessage('Подпись сохранена.');
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось сохранить подпись.');
    } finally {
      setSignatureSaving(false);
    }
  }, [activeMailboxId, resolveComposeMailboxId, signatureHtml, signatureMailboxId]);

  const rememberRecentSearch = useCallback((filters) => {
    const nextEntry = {
      ...DEFAULT_ADVANCED_FILTERS,
      ...(filters || {}),
    };
    const labelParts = [];
    if (nextEntry.q) labelParts.push(nextEntry.q);
    if (nextEntry.from_filter) labelParts.push(`от:${nextEntry.from_filter}`);
    if (nextEntry.to_filter) labelParts.push(`кому:${nextEntry.to_filter}`);
    if (nextEntry.subject_filter) labelParts.push(`тема:${nextEntry.subject_filter}`);
    if (nextEntry.importance) labelParts.push(`важность:${nextEntry.importance}`);
    const label = labelParts.join(' • ') || 'Фильтр';
    const payload = { ...nextEntry, label };

    setRecentSearches((prev) => {
      const current = Array.isArray(prev) ? prev : [];
      const deduped = current.filter((item) => JSON.stringify({ ...item, label: undefined }) !== JSON.stringify({ ...payload, label: undefined }));
      const next = [payload, ...deduped].slice(0, 8);
      try {
        window.localStorage.setItem(MAIL_RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // ignore local storage issues
      }
      return next;
    });
  }, []);

  const handleApplyAdvancedSearch = useCallback(() => {
    const nextFilters = { ...DEFAULT_ADVANCED_FILTERS, ...(advancedFiltersDraft || {}) };
    setAdvancedFiltersApplied(nextFilters);
    setSearch(String(nextFilters.q || ''));
    if (
      nextFilters.q
      || nextFilters.from_filter
      || nextFilters.to_filter
      || nextFilters.subject_filter
      || nextFilters.body_filter
      || nextFilters.importance
      || (nextFilters.folder_scope && nextFilters.folder_scope !== 'current')
    ) {
      rememberRecentSearch(nextFilters);
    }
    setAdvancedSearchOpen(false);
  }, [advancedFiltersDraft, rememberRecentSearch]);

  const handleResetAdvancedSearch = useCallback(() => {
    setAdvancedFiltersDraft(DEFAULT_ADVANCED_FILTERS);
    setAdvancedFiltersApplied(DEFAULT_ADVANCED_FILTERS);
    setSearch('');
  }, []);

  const handleApplyRecentSearch = useCallback((item) => {
    const nextFilters = { ...DEFAULT_ADVANCED_FILTERS, ...(item || {}) };
    setAdvancedFiltersDraft(nextFilters);
    setAdvancedFiltersApplied(nextFilters);
    setSearch(String(nextFilters.q || ''));
    setAdvancedSearchOpen(false);
  }, []);

  const printMailMessage = useCallback((messageDetail, renderedHtml = '') => {
    if (!messageDetail) return false;
    const senderLine = formatMailPersonWithEmail(
      messageDetail?.sender_person || {
        display: messageDetail?.sender_display,
        name: messageDetail?.sender_name,
        email: messageDetail?.sender_email,
      },
      String(messageDetail?.sender || '-'),
    );
    const html = String(
      renderedHtml
      || buildRenderedMailHtml(
        getMessageBodyHtmlSource(messageDetail),
        Array.isArray(messageDetail?.attachments) ? messageDetail.attachments : [],
        { allowExternalImages: true, colorScheme: 'light' },
      ).html
      || '<p>Нет содержимого</p>',
    );
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=920,height=720');
    if (!printWindow) {
      setError('Не удалось открыть окно печати.');
      return false;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>${String(messageDetail?.subject || 'Письмо')}</title>
          <style>
            body { font-family: Aptos, Calibri, "Segoe UI", Arial, sans-serif; margin: 24px; line-height: 1.5; color: #111827; }
            h1 { font-size: 20px; margin-bottom: 8px; }
            .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
            img { max-width: 100%; }
            blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #cbd5e1; color: #475569; }
          </style>
        </head>
        <body>
          <h1>${String(messageDetail?.subject || '(без темы)')}</h1>
          <div class="meta">От: ${senderLine}<br/>Дата: ${formatFullDate(messageDetail?.received_at)}</div>
          <div>${html}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    return true;
  }, [formatFullDate]);

  const handleOpenHeaders = useCallback(async () => {
    if (!selectedMessage?.id) return;
    setHeadersOpen(true);
    setHeadersLoading(true);
    setMessageHeaders({ items: [] });
    try {
      const data = await mailAPI.getMessageHeaders(selectedMessage.id, {
        mailboxId: resolveItemMailboxId(selectedMessage),
      });
      setMessageHeaders(data?.items ? data : { items: [] });
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось загрузить заголовки письма.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось загрузить заголовки письма.'));
      }
      setMessageHeaders({ items: [] });
    } finally {
      setHeadersLoading(false);
    }
  }, [resolveItemMailboxId, selectedMessage]);

  const handleDownloadMessageSource = useCallback(async () => {
    if (!selectedMessage?.id) return;
    try {
      const response = await mailAPI.downloadMessageSource(selectedMessage.id, {
        mailboxId: resolveItemMailboxId(selectedMessage),
      });
      const contentDisposition = response.headers['content-disposition'];
      const filename = parseDownloadFilename(contentDisposition, `${selectedMessage.subject || 'message'}.eml`);
      const blob = new Blob([response.data], { type: response.headers['content-type'] || 'message/rfc822' });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (requestError) {
      const errorDetail = await getMailErrorDetailAsync(requestError, 'Не удалось скачать исходник письма.');
      if (!(await handleMailCredentialsRequired(requestError, errorDetail))) {
        setError(errorDetail);
      }
    }
  }, [getMailErrorDetailAsync, handleMailCredentialsRequired, resolveItemMailboxId, selectedMessage]);

  const handlePrintSelectedMessage = useCallback(() => {
    if (!selectedMessage) return;
    printMailMessage(selectedMessage, selectedMessageRenderResult.html);
  }, [printMailMessage, selectedMessage, selectedMessageRenderResult.html]);

  const handleOpenCreateFolderDialog = useCallback((target) => {
    const token = String(target || 'mailbox');
    const isScopeOnly = token === 'mailbox' || token === 'archive';
    setFolderDialogMode('create');
    setFolderDialogParentId(isScopeOnly ? '' : token);
    setFolderDialogScope(isScopeOnly ? token : 'mailbox');
    setFolderDialogTarget(isScopeOnly ? null : (Array.isArray(folderTree) ? folderTree.find((item) => String(item?.id || '') === token) || null : null));
    setFolderDialogName('');
    setFolderDialogOpen(true);
  }, [folderTree]);

  const handleOpenRenameFolderDialog = useCallback((item) => {
    if (!item) return;
    setFolderDialogMode('rename');
    setFolderDialogParentId(String(item.id || ''));
    setFolderDialogScope(String(item.scope || 'mailbox'));
    setFolderDialogTarget(item);
    setFolderDialogName(String(item.label || item.name || ''));
    setFolderDialogOpen(true);
  }, []);

  const handleSubmitFolderDialog = useCallback(async () => {
    const name = String(folderDialogName || '').trim();
    if (!name) {
      setError('Укажите название папки.');
      return;
    }
    setFolderDialogSaving(true);
    try {
      if (folderDialogMode === 'rename' && folderDialogTarget?.id) {
        await mailAPI.renameFolder(folderDialogTarget.id, { name, mailbox_id: activeMailboxId || undefined });
        setMessage('Папка переименована.');
      } else {
        await mailAPI.createFolder({
          mailbox_id: activeMailboxId || undefined,
          name,
          parent_folder_id: folderDialogParentId || '',
          scope: folderDialogScope || 'mailbox',
        });
        setMessage('Папка создана.');
      }
      setFolderDialogOpen(false);
      invalidateMailClientCache(['bootstrap', 'folder-tree']);
      await refreshFolderTree({ force: true });
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось сохранить папку.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось сохранить папку.'));
      }
    } finally {
      setFolderDialogSaving(false);
    }
  }, [
    folderDialogMode,
    folderDialogName,
    folderDialogTarget?.id,
    folderDialogParentId,
    folderDialogScope,
    activeMailboxId,
    invalidateMailClientCache,
    refreshFolderTree,
  ]);

  const handleDeleteFolder = useCallback(async (item) => {
    if (!item?.id) return;
    if (!window.confirm(`Удалить папку "${item.label || item.name || 'без названия'}"?`)) return;
    try {
      await mailAPI.deleteFolder(item.id, activeMailboxId);
      if (String(folder) === String(item.id)) {
        clearSelection({ allModes: true });
        setFolder('inbox');
      }
      invalidateMailClientCache(['bootstrap', 'folder-tree']);
      await refreshFolderTree({ force: true });
      setMessage('Папка удалена.');
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось удалить папку.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось удалить папку.'));
      }
    }
  }, [activeMailboxId, folder, clearSelection, invalidateMailClientCache, refreshFolderTree]);

  const handleToggleFavoriteFolder = useCallback(async (item) => {
    if (!item?.id) return;
    try {
      await mailAPI.setFolderFavorite(item.id, !Boolean(item?.is_favorite), activeMailboxId);
      invalidateMailClientCache(['bootstrap', 'folder-tree']);
      await refreshFolderTree({ force: true });
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось обновить избранные папки.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось обновить избранные папки.'));
      }
    }
  }, [activeMailboxId, invalidateMailClientCache, refreshFolderTree]);

  const handleSaveMailPreferences = useCallback(async () => {
    setMailPreferencesSaving(true);
    try {
      const data = await mailAPI.updatePreferences(mailPreferencesDraft);
      const nextValue = { ...DEFAULT_MAIL_PREFERENCES, ...(data || {}) };
      setMailPreferences(nextValue);
      setMailPreferencesDraft(nextValue);
      setMailPreferencesOpen(false);
      setMessage('Настройки вида сохранены.');
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось сохранить настройки вида.');
    } finally {
      setMailPreferencesSaving(false);
    }
  }, [mailPreferencesDraft]);

  const selectedMessageIds = useMemo(
    () => Array.from(new Set((Array.isArray(selectedItems) ? selectedItems : []).map((item) => String(item || '')).filter(Boolean))),
    [selectedItems]
  );

  const afterListMutation = useCallback(async ({ clearBulkSelection = true } = {}) => {
    if (clearBulkSelection) setSelectedItems([]);
    dragMessageIdsRef.current = [];
    invalidateMailClientCache();
    await Promise.all([
      refreshList({ silent: true, force: true }),
      refreshFolderSummary({ force: true }),
    ]);
    window.dispatchEvent(new CustomEvent('mail-list-refreshed'));
  }, [invalidateMailClientCache, refreshList, refreshFolderSummary]);

  const runBulkAction = useCallback(async ({ action, targetFolder = '', permanent = false, successMessage = '' }) => {
    if (selectedMessageIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      await mailAPI.bulkMessageAction({
        mailbox_id: activeMailboxId || undefined,
        message_ids: selectedMessageIds,
        action,
        target_folder: targetFolder || undefined,
        permanent,
      });
      if (selectedMessage?.id && selectedMessageIds.includes(String(selectedMessage.id))) {
        clearSelection({ mode: viewMode });
      }
      await afterListMutation();
      if (successMessage) setMessage(successMessage);
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось выполнить массовое действие.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось выполнить массовое действие.'));
      }
    } finally {
      setBulkActionLoading(false);
    }
  }, [activeMailboxId, afterListMutation, clearSelection, selectedMessage?.id, selectedMessageIds, viewMode]);

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
      setMessage(`Отмечено как прочитанное: ${Number(data?.changed || 0)}.`);
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
    selectedConversation,
    selectedMessage,
    viewMode,
  ]);

  const handleArchiveSelectedMessage = useCallback(async () => {
    if (!selectedMessage?.id) return;
    setMessageActionLoading(true);
    try {
      await mailAPI.moveMessage(selectedMessage.id, withActiveMailboxPayload({ target_folder: 'archive' }));
      clearSelection({ mode: viewMode });
      await afterListMutation();
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось отправить письмо в архив.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось отправить письмо в архив.'));
      }
    } finally {
      setMessageActionLoading(false);
    }
  }, [afterListMutation, clearSelection, selectedMessage?.id, viewMode, withActiveMailboxPayload]);

  const getMessageDetailForListAction = useCallback(async (item) => {
    const messageId = String(item?.id || '').trim();
    if (!messageId) return null;
    if (String(selectedMessage?.id || '') === messageId && selectedMessage?.body_html) {
      return selectedMessage;
    }
    const recentDetail = getRecentMessageDetailSnapshot(messageId);
    if (recentDetail?.body_html) {
      return recentDetail;
    }
    const data = await mailAPI.getMessage(messageId, {
      mailboxId: resolveItemMailboxId(item),
    });
    if (data) {
      persistRecentMessageDetailSnapshot(data);
    }
    return data || null;
  }, [
    getRecentMessageDetailSnapshot,
    persistRecentMessageDetailSnapshot,
    resolveItemMailboxId,
    selectedMessage,
  ]);

  const handleSwipeRead = useCallback(async (item) => {
    if (!item) return;
    if (viewMode === 'conversations') {
      await performMailReadMutation({
        mode: 'conversations',
        targetId: String(item?.conversation_id || item?.id || ''),
        nextIsRead: Number(item?.unread_count || 0) > 0,
        currentUnreadCount: Number(item?.unread_count || 0),
        currentMessageCount: Number(item?.messages_count || item?.items?.length || 1),
        errorMessage: 'Не удалось изменить статус диалога.',
      });
      return;
    }

    await performMailReadMutation({
      mode: 'messages',
      targetId: String(item?.id || ''),
      nextIsRead: !Boolean(item?.is_read),
      currentUnreadCount: item?.is_read ? 0 : 1,
      currentMessageCount: 1,
      errorMessage: 'Не удалось изменить статус письма.',
    });
  }, [performMailReadMutation, viewMode]);

  const handleSwipeDelete = useCallback(async (item, options = {}) => {
    if (!item?.id || viewMode !== 'messages') return;
    const permanent = typeof options?.permanent === 'boolean'
      ? options.permanent
      : folder === 'trash';
    try {
      await mailAPI.deleteMessage(item.id, withActiveMailboxPayload({ permanent }));
      if (selectedMessage?.id && String(selectedMessage.id) === String(item.id)) {
        clearSelection({ mode: viewMode });
      }
      await afterListMutation();
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось удалить письмо.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось удалить письмо.'));
      }
    }
  }, [
    afterListMutation,
    clearSelection,
    folder,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    selectedMessage?.id,
    viewMode,
    withActiveMailboxPayload,
  ]);

  const handleListRestoreMessage = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    try {
      await mailAPI.restoreMessage(
        item.id,
        withActiveMailboxPayload({ target_folder: String(item?.restore_hint_folder || 'inbox') }),
      );
      if (selectedMessage?.id && String(selectedMessage.id) === String(item.id)) {
        clearSelection({ mode: viewMode });
      }
      await afterListMutation();
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось восстановить письмо.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось восстановить письмо.'));
      }
    }
  }, [
    afterListMutation,
    clearSelection,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    selectedMessage?.id,
    viewMode,
    withActiveMailboxPayload,
  ]);

  const handleListArchiveMessage = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    try {
      await mailAPI.moveMessage(item.id, withActiveMailboxPayload({ target_folder: 'archive' }));
      if (selectedMessage?.id && String(selectedMessage.id) === String(item.id)) {
        clearSelection({ mode: viewMode });
      }
      await afterListMutation();
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось отправить письмо в архив.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось отправить письмо в архив.'));
      }
    }
  }, [
    afterListMutation,
    clearSelection,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    selectedMessage?.id,
    viewMode,
    withActiveMailboxPayload,
  ]);

  const handleListMoveMessage = useCallback(async (item, targetFolderId) => {
    const messageId = String(item?.id || '').trim();
    const targetFolder = String(targetFolderId || '').trim();
    if (!messageId || !targetFolder || viewMode !== 'messages') return;
    try {
      await mailAPI.moveMessage(messageId, withActiveMailboxPayload({ target_folder: targetFolder }));
      if (selectedMessage?.id && String(selectedMessage.id) === messageId) {
        clearSelection({ mode: viewMode });
      }
      await afterListMutation();
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось переместить письмо.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось переместить письмо.'));
      }
    }
  }, [
    afterListMutation,
    clearSelection,
    getMailErrorDetail,
    handleMailCredentialsRequired,
    selectedMessage?.id,
    viewMode,
    withActiveMailboxPayload,
  ]);

  const handleListOpenHeaders = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    setHeadersOpen(true);
    setHeadersLoading(true);
    setMessageHeaders({ items: [] });
    try {
      const data = await mailAPI.getMessageHeaders(item.id, {
        mailboxId: resolveItemMailboxId(item),
      });
      setMessageHeaders(data?.items ? data : { items: [] });
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось загрузить заголовки письма.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось загрузить заголовки письма.'));
      }
      setMessageHeaders({ items: [] });
    } finally {
      setHeadersLoading(false);
    }
  }, [
    getMailErrorDetail,
    handleMailCredentialsRequired,
    resolveItemMailboxId,
    viewMode,
  ]);

  const handleListDownloadMessageSource = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    try {
      const response = await mailAPI.downloadMessageSource(item.id, {
        mailboxId: resolveItemMailboxId(item),
      });
      const contentDisposition = response.headers['content-disposition'];
      const filename = parseDownloadFilename(contentDisposition, `${item.subject || 'message'}.eml`);
      const blob = new Blob([response.data], { type: response.headers['content-type'] || 'message/rfc822' });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (requestError) {
      const errorDetail = await getMailErrorDetailAsync(requestError, 'Не удалось скачать исходник письма.');
      if (!(await handleMailCredentialsRequired(requestError, errorDetail))) {
        setError(errorDetail);
      }
    }
  }, [
    getMailErrorDetailAsync,
    handleMailCredentialsRequired,
    resolveItemMailboxId,
    viewMode,
  ]);

  const handleListPrintMessage = useCallback(async (item) => {
    if (!item?.id || viewMode !== 'messages') return;
    try {
      const detail = await getMessageDetailForListAction(item);
      if (!detail) {
        setError('Не удалось загрузить письмо для печати.');
        return;
      }
      printMailMessage(detail);
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось подготовить письмо к печати.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось подготовить письмо к печати.'));
      }
    }
  }, [
    getMailErrorDetail,
    getMessageDetailForListAction,
    handleMailCredentialsRequired,
    printMailMessage,
    viewMode,
  ]);

  const handleStartDragItems = useCallback((ids) => {
    dragMessageIdsRef.current = Array.isArray(ids) ? ids.map((item) => String(item || '')).filter(Boolean) : [];
  }, []);

  const handleDropMessagesToFolder = useCallback(async (targetFolderId) => {
    const targetFolder = String(targetFolderId || '');
    const ids = dragMessageIdsRef.current.length > 0
      ? dragMessageIdsRef.current
      : (selectedMessageIds.length > 0 ? selectedMessageIds : [String(selectedMessage?.id || '')].filter(Boolean));
    if (!targetFolder || ids.length === 0) return;
    if (targetFolder === folder) return;

    try {
      if (ids.length === 1) {
        await mailAPI.moveMessage(ids[0], withActiveMailboxPayload({ target_folder: targetFolder }));
      } else {
        await mailAPI.bulkMessageAction({
          mailbox_id: activeMailboxId || undefined,
          message_ids: ids,
          action: 'move',
          target_folder: targetFolder,
        });
      }
      if (selectedMessage?.id && ids.includes(String(selectedMessage.id))) {
        clearSelection({ mode: viewMode });
      }
      await afterListMutation();
    } catch (requestError) {
      if (!(await handleMailCredentialsRequired(requestError, 'Не удалось переместить письма.'))) {
        setError(getMailErrorDetail(requestError, 'Не удалось переместить письма.'));
      }
    }
  }, [activeMailboxId, afterListMutation, clearSelection, folder, selectedMessage?.id, selectedMessageIds, viewMode, withActiveMailboxPayload]);

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
          setHeadersOpen(false);
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

  const fetchAttachmentBlob = useCallback(async (messageOrId, attachment, fallbackMessage = null) => {
    const { messageId, attachmentRef, mailboxId } = resolveAttachmentRequestContext(messageOrId, attachment, fallbackMessage);
    if (!messageId || !attachmentRef) {
      const contextError = buildAttachmentContextError({ attachment, messageId, mailboxId });
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Mail attachment download skipped because request context is incomplete', contextError.attachment);
      }
      throw contextError;
    }
    return mailAPI.downloadAttachment(messageId, attachmentRef, { mailboxId });
  }, [resolveAttachmentRequestContext]);

  const openAttachmentPreview = useCallback(async (messageOrId, attachment, fallbackMessage = null) => {
    try {
      const response = await fetchAttachmentBlob(messageOrId, attachment, fallbackMessage);
      const contentDisposition = response.headers['content-disposition'];
      const filename = parseDownloadFilename(contentDisposition, attachment?.name || 'attachment.bin');
      const contentType = String(response.headers['content-type'] || attachment?.content_type || 'application/octet-stream');
      const blob = new Blob([response.data], { type: contentType });
      const kind = contentType.includes('pdf') ? 'pdf' : (contentType.startsWith('image/') ? 'image' : 'text');
      let objectUrl = '';
      let textContent = '';
      let textTruncated = false;
      if (kind === 'image' || kind === 'pdf') objectUrl = window.URL.createObjectURL(blob);
      if (kind === 'text') {
        const chunk = blob.slice(0, MAX_TEXT_PREVIEW_BYTES);
        textContent = await chunk.text();
        textTruncated = blob.size > MAX_TEXT_PREVIEW_BYTES;
      }
      setAttachmentPreview({
        open: true,
        loading: false,
        error: '',
        filename,
        contentType,
        kind,
        objectUrl,
        textContent,
        textTruncated,
        tooLargeForPreview: blob.size > MAX_PREVIEW_FILE_BYTES,
        blob,
      });
    } catch (requestError) {
      const errorDetail = await getMailErrorDetailAsync(requestError, 'Не удалось открыть вложение.');
      if (!(await handleMailCredentialsRequired(requestError, errorDetail))) {
        setError(errorDetail);
      }
    }
  }, [fetchAttachmentBlob, getMailErrorDetailAsync, handleMailCredentialsRequired]);

  const downloadAttachmentFile = useCallback(async (messageOrId, attachment, fallbackMessage = null) => {
    const { messageId, attachmentRef, mailboxId } = resolveAttachmentRequestContext(messageOrId, attachment, fallbackMessage);
    if (!messageId || !attachmentRef) {
      const contextError = buildAttachmentContextError({ attachment, messageId, mailboxId });
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn('Mail attachment download skipped because request context is incomplete', contextError.attachment);
      }
      setError(contextError.message);
      return;
    }
    const downloadKey = `${messageId}::${attachmentRef}::${mailboxId || ''}`;
    if (attachmentDownloadInFlightRef.current.has(downloadKey)) {
      return;
    }
    attachmentDownloadInFlightRef.current.add(downloadKey);
    try {
      const response = await mailAPI.downloadAttachment(messageId, attachmentRef, { mailboxId });
      const contentDisposition = response.headers['content-disposition'];
      const filename = parseDownloadFilename(contentDisposition, attachment?.name || 'attachment.bin');
      const blob = new Blob([response.data], { type: response.headers['content-type'] || attachment?.content_type || 'application/octet-stream' });
      downloadBlobFile(blob, filename, { preferOpenFallback: true });
    } catch (requestError) {
      const errorDetail = await getMailErrorDetailAsync(requestError, 'Не удалось скачать вложение.');
      if (!(await handleMailCredentialsRequired(requestError, errorDetail))) {
        setError(errorDetail);
      }
    } finally {
      attachmentDownloadInFlightRef.current.delete(downloadKey);
    }
  }, [getMailErrorDetailAsync, handleMailCredentialsRequired, resolveAttachmentRequestContext]);
  const selectedMessageHtml = useMemo(
    () => selectedMessagePrimaryHtml,
    [selectedMessagePrimaryHtml]
  );
  useEffect(() => {
    setShowQuotedHistory(false);
  }, [selectedMessage?.id, selectedConversation?.conversation_id]);
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
  const mailboxPrimaryDomain = useMemo(() => {
    const primary = Array.from(mailboxEmails)[0] || '';
    return String(primary.split('@')[1] || '').trim().toLowerCase();
  }, [mailboxEmails]);
  const closeMobileNavigationIfNeeded = useCallback(() => {
    if (isMobile) setMobileNavigationOpen(false);
  }, [isMobile]);
  const folderRailUtilityItems = useMemo(() => {
    const items = [
      {
        id: 'it-request',
        label: 'IT-заявка',
        onClick: () => {
          closeMobileNavigationIfNeeded();
          setItOpen(true);
        },
      },
    ];
    if (canManageUsers) {
      items.push({
        id: 'templates',
        label: 'Шаблоны',
        onClick: () => {
          closeMobileNavigationIfNeeded();
          setTemplatesOpen(true);
        },
      });
    }
    return items;
  }, [canManageUsers, closeMobileNavigationIfNeeded]);
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
    const nextFolder = String(value || 'inbox');
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
          onClear={() => {
            setSelectedItems([]);
            setMoveTarget('');
            dragMessageIdsRef.current = [];
          }}
          isMobile={isMobile}
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
        bottomInset={isMobile && selectedMessageIds.length > 0 ? 'calc(78px + env(safe-area-inset-bottom, 0px))' : 0}
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
        handleMailCredentialsRequired={handleMailCredentialsRequired}
        getMailErrorDetail={getMailErrorDetail}
      />
    </Suspense>
  ) : detailLoading && selectedMessage ? (
    <>
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
        showBackButton={isMobile}
        onBackToList={handleBackToList}
        compactMobile={isMobile}
      />
      <Box sx={{ p: 2 }}>
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="rectangular" height={280} sx={{ mt: 1, borderRadius: '8px' }} />
      </Box>
    </>
  ) : detailLoading ? (
    <Box sx={{ p: 2 }}><Skeleton variant="text" width="60%" /><Skeleton variant="rectangular" height={280} sx={{ mt: 1, borderRadius: '8px' }} /></Box>
  ) : !selectedMessage ? (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
      <MailOutlineIcon sx={{ fontSize: 58, color: 'text.disabled', mb: 1.2 }} />
      <Typography variant="body2" color="text.secondary">{viewMode === 'conversations' ? 'Выберите диалог' : 'Выберите письмо'}</Typography>
    </Box>
  ) : (
    <>
      <MailPreviewHeader
        selectedMessage={selectedMessage}
        selectedConversation={selectedConversation}
        viewMode={viewMode}
        folder={folder}
        messageActionLoading={messageActionLoading}
        onOpenComposeFromDraft={openComposeFromDraft}
        onOpenComposeFromMessage={openComposeFromMessage}
        onToggleReadState={async () => {
          setMessageActionLoading(true);
          try {
            if (viewMode === 'conversations') {
              await performMailReadMutation({
                mode: 'conversations',
                targetId: String(selectedConversation?.conversation_id || ''),
                nextIsRead: Number(selectedConversation?.unread_count || 0) > 0,
                currentUnreadCount: Number(selectedConversation?.unread_count || 0),
                currentMessageCount: Number(selectedConversation?.messages_count || selectedConversation?.items?.length || 1),
                errorMessage: 'Не удалось изменить статус диалога.',
              });
            } else {
              await performMailReadMutation({
                mode: 'messages',
                targetId: String(selectedMessage?.id || ''),
                nextIsRead: !Boolean(selectedMessage?.is_read),
                currentUnreadCount: selectedMessage?.is_read ? 0 : 1,
                currentMessageCount: 1,
                errorMessage: 'Не удалось изменить статус письма.',
              });
            }
          } finally {
            setMessageActionLoading(false);
          }
        }}
        onRestoreSelectedMessage={async () => {
          setMessageActionLoading(true);
          try {
            await mailAPI.restoreMessage(
              selectedMessage.id,
              withActiveMailboxPayload({ target_folder: String(selectedMessage?.restore_hint_folder || 'inbox') }),
            );
            clearSelection({ mode: viewMode });
            await afterListMutation();
          } catch (requestError) {
            if (!(await handleMailCredentialsRequired(requestError, 'Не удалось восстановить письмо.'))) {
              setError(getMailErrorDetail(requestError, 'Не удалось восстановить письмо.'));
            }
          } finally {
            setMessageActionLoading(false);
          }
        }}
        onDeleteSelectedMessage={async (permanent) => {
          setMessageActionLoading(true);
          try {
            await mailAPI.deleteMessage(selectedMessage.id, withActiveMailboxPayload({ permanent: Boolean(permanent) }));
            clearSelection({ mode: viewMode });
            await afterListMutation();
          } catch (requestError) {
            if (!(await handleMailCredentialsRequired(requestError, 'Не удалось удалить письмо.'))) {
              setError(getMailErrorDetail(requestError, 'Не удалось удалить письмо.'));
            }
          } finally {
            setMessageActionLoading(false);
          }
        }}
        onArchiveSelectedMessage={handleArchiveSelectedMessage}
        moveTarget={moveTarget}
        onMoveTargetChange={setMoveTarget}
        onMoveSelectedMessage={async (targetOverride = '') => {
          const resolvedTarget = String(targetOverride || moveTarget || '');
          if (!resolvedTarget) return;
          setMessageActionLoading(true);
          try {
            await mailAPI.moveMessage(selectedMessage.id, withActiveMailboxPayload({ target_folder: resolvedTarget }));
            clearSelection({ mode: viewMode });
            await afterListMutation();
          } catch (requestError) {
            if (!(await handleMailCredentialsRequired(requestError, 'Не удалось переместить письмо.'))) {
              setError(getMailErrorDetail(requestError, 'Не удалось переместить письмо.'));
            }
          } finally {
            setMessageActionLoading(false);
          }
        }}
        moveTargets={moveTargets}
        onOpenHeaders={handleOpenHeaders}
        onDownloadSource={handleDownloadMessageSource}
        onPrintSelectedMessage={handlePrintSelectedMessage}
        getAvatarColor={getAvatarColor}
        getInitials={getInitials}
        formatFullDate={formatFullDate}
        showBackButton={isMobile || readingPaneMode === 'off'}
        compactMobile={isMobile}
        onBackToList={handleBackToList}
      />
      {viewMode === 'conversations' ? (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box
            ref={conversationScrollRef}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              WebkitOverflowScrolling: 'touch',
              px: 1.2,
              py: 1,
              pb: isMobile ? 1 : { xs: 9, sm: 1.4 },
              bgcolor: ui.panelBg,
            }}
          >
            <Stack spacing={1}>
              {(selectedConversation?.items || []).map((item, index, arr) => {
                const itemDateValue = item?.received_at || item?.created_at || Date.now();
                const currentDay = formatConversationDay(itemDateValue);
                const previous = arr[index - 1];
                const previousDay = previous ? formatConversationDay(previous?.received_at || previous?.created_at || Date.now()) : '';
                const showDaySeparator = currentDay !== previousDay;
                const mine = isOwnConversationMessage(item);
                const senderLine = getSenderDisplay(item, item?.sender || '-');
                const itemAllowsExternalImages = Boolean(
                  item?.id && revealedRemoteImagesByMessageId?.[String(item.id)]
                );
                const itemAttachments = Array.isArray(item?.attachments) ? item.attachments : [];
                const conversationBodyHtmlSource = getMessageBodyHtmlSource(item);
                const renderedConversationBody = buildRenderedMailHtml(
                  conversationBodyHtmlSource,
                  itemAttachments,
                  { allowExternalImages: itemAllowsExternalImages, colorScheme: mailRenderColorScheme }
                );
                const visibleConversationAttachments = filterVisibleMailAttachments(
                  itemAttachments,
                  renderedConversationBody.usedInlineAttachmentIds
                );
                return (
                  <Box key={item?.id || index}>
                    {showDaySeparator ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.2 }}>
                        <Chip
                          size="small"
                          label={currentDay}
                          sx={{
                            height: 22,
                            fontSize: ui.fontSizeFine,
                            borderRadius: ui.chipRadius,
                            bgcolor: ui.actionBg,
                            color: ui.mutedText,
                            border: '1px solid',
                            borderColor: ui.borderSoft,
                            fontWeight: 600,
                          }}
                        />
                      </Box>
                    ) : null}
                    <Stack direction="row" justifyContent={mine ? 'flex-end' : 'flex-start'} alignItems="flex-end" spacing={0.7}>
                      {!mine ? (
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: getAvatarColor(senderLine),
                            color: 'common.white',
                            fontSize: ui.fontSizeFine,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {getInitials(senderLine)}
                        </Box>
                      ) : null}
                      <Paper
                        variant="outlined"
                        sx={{
                          px: 1.1,
                          py: 0.9,
                          maxWidth: { xs: '92%', md: '78%' },
                          borderRadius: mine ? `${ui.radiusLg} ${ui.radiusLg} ${ui.radiusXs} ${ui.radiusLg}` : `${ui.radiusLg} ${ui.radiusLg} ${ui.radiusLg} ${ui.radiusXs}`,
                          borderColor: mine
                            ? alpha(theme.palette.primary.main, ui.isDark ? 0.46 : 0.28)
                            : (String(selectedMessage?.id) === String(item?.id) ? ui.selectedBorder : ui.borderSoft),
                          bgcolor: mine
                            ? alpha(theme.palette.primary.main, ui.isDark ? 0.22 : 0.10)
                            : ui.panelSolid,
                          color: mine
                            ? (ui.isDark ? alpha(theme.palette.common.white, 0.96) : theme.palette.text.primary)
                            : 'text.primary',
                          cursor: 'pointer',
                          boxShadow: 'none',
                        }}
                        onClick={() => setSelectedMessage(item)}
                      >
                        <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                          <Typography variant="caption" sx={{ fontWeight: 700, color: mine ? 'inherit' : 'text.secondary' }}>
                            {mine ? 'Вы' : senderLine}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: mine ? 0.85 : 0.7 }}>
                            {formatTime(itemDateValue)}
                          </Typography>
                        </Stack>
                        {renderedConversationBody.hasBlockedExternalImages ? (
                          <Box sx={{ mt: 0.55 }}>
                            <Button
                              size="small"
                              variant="text"
                              onClick={(event) => {
                                event.stopPropagation();
                                revealRemoteImagesForMessage(item?.id);
                              }}
                              sx={{
                                minWidth: 0,
                                px: 0,
                                textTransform: 'none',
                                color: mine ? 'inherit' : 'primary.main',
                              }}
                            >
                              Показать изображения
                            </Button>
                          </Box>
                        ) : null}
                        <Box
                          sx={getMailRenderedContentSx({ ui, theme, variant: 'conversation', mine })}
                          dangerouslySetInnerHTML={{ __html: renderedConversationBody.html || '<p style="color:#999">Нет содержимого</p>' }}
                        />
                        {visibleConversationAttachments.length > 0 ? (
                          <Stack spacing={0.8} sx={{ mt: 0.9 }}>
                            {visibleConversationAttachments.map((attachment, attachmentIndex) => (
                              <MailAttachmentCard
                                key={`${attachment?.id || attachment?.name || attachmentIndex}`}
                                attachment={attachment}
                                mine={mine}
                                formatFileSize={formatFileSize}
                                onOpen={(event) => {
                                  event?.stopPropagation?.();
                                  openAttachmentPreview(item, attachment);
                                }}
                                onDownload={(event) => {
                                  event?.stopPropagation?.();
                                  downloadAttachmentFile(item, attachment);
                                }}
                              />
                            ))}
                          </Stack>
                        ) : null}
                      </Paper>
                      {mine ? (
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: 'primary.main',
                            color: 'primary.contrastText',
                            fontSize: ui.fontSizeFine,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          Я
                        </Box>
                      ) : null}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>
          {!isMobile ? (
            <Box
              sx={{
                p: 1,
                pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
                borderTop: '1px solid',
                borderColor: ui.borderSoft,
                bgcolor: ui.panelSolid,
                position: 'sticky',
                bottom: 0,
                zIndex: 1,
              }}
            >
              <Stack spacing={0.7}>
                <TextField
                  multiline
                  minRows={2}
                  maxRows={6}
                  size="small"
                  label="Быстрый ответ"
                  placeholder="Напишите сообщение..."
                  value={quickReplyBody}
                  onChange={(event) => setQuickReplyBody(event.target.value)}
                  InputProps={{ sx: { borderRadius: ui.inputRadius } }}
                />
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  justifyContent="space-between"
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                  flexWrap="wrap"
                  useFlexGap
                  gap={0.6}
                >
                  <Stack direction="row" spacing={0.4} flexWrap="wrap" useFlexGap>
                    <Button size="small" variant="text" onClick={() => openComposeFromMessage('reply')} sx={{ textTransform: 'none', minWidth: 0, px: 0.7 }}>
                      Ответить
                    </Button>
                    <Button size="small" variant="text" onClick={() => openComposeFromMessage('reply_all')} sx={{ textTransform: 'none', minWidth: 0, px: 0.7 }}>
                      Всем
                    </Button>
                    <Button size="small" variant="text" onClick={() => openComposeFromMessage('forward')} sx={{ textTransform: 'none', minWidth: 0, px: 0.7 }}>
                      Переслать
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ maxWidth: { xs: '100%', sm: 280 } }}>
                    Ответ отправляется отправителю выбранного сообщения.
                  </Typography>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={quickReplySending || !String(quickReplyBody || '').trim()}
                    sx={{ alignSelf: { xs: 'stretch', sm: 'center' } }}
                    onClick={async () => {
                      if (!selectedMessage?.id) return;
                      setQuickReplySending(true);
                      try {
                        const context = selectedMessage?.compose_context?.reply || {};
                        const to = toRecipientEmails(context?.to);
                        await mailAPI.sendMessage({
                          from_mailbox_id: resolveComposeMailboxId(context?.mailbox_id || selectedMessage?.mailbox_id),
                          to: to.length > 0 ? to : toRecipientEmails([getSenderEmail(selectedMessage)]),
                          cc: toRecipientEmails(context?.cc),
                          bcc: [],
                          subject: normalizeComposeSubject('reply', context?.subject || selectedMessage.subject || ''),
                          body: `<p>${String(quickReplyBody || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`,
                          is_html: true,
                          reply_to_message_id: selectedMessage.id,
                        });
                        setQuickReplyBody('');
                        invalidateMailClientCache();
                        await refreshList({ silent: true, force: true });
                        await refreshFolderSummary();
                      } catch (requestError) {
                        if (!(await handleMailCredentialsRequired(requestError, 'Не удалось отправить быстрый ответ.'))) {
                          setError(getMailErrorDetail(requestError, 'Не удалось отправить быстрый ответ.'));
                        }
                      } finally {
                        setQuickReplySending(false);
                      }
                    }}
                  >
                    {quickReplySending ? 'Отправка...' : 'Отправить'}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box className="mail-scroll-hidden mail-safe-bottom" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', p: { xs: 1.35, md: 2 } }}>
          {selectedMessageRenderResult.hasBlockedExternalImages ? (
            <Alert
              severity="info"
              sx={{ mb: 1.2, borderRadius: ui.radiusMd }}
              action={(
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => revealRemoteImagesForMessage(selectedMessage?.id)}
                >
                  Показать изображения
                </Button>
              )}
            >
              В письме есть внешние изображения. Они скрыты до вашего разрешения.
            </Alert>
          ) : null}
          {selectedMessageAttachments.length > 0 ? (
            <Stack spacing={0.6} sx={{ mb: 1.2 }}>
              <Typography variant="caption" color="text.secondary">{`${selectedMessageAttachments.length} вложений • ${selectedMessageAttachmentTotalSize}`}</Typography>
              <Stack spacing={0.85}>
                {selectedMessageAttachments.map((attachment, index) => {
                  return (
                    <MailAttachmentCard
                      key={`${attachment?.id || attachment?.name || index}`}
                      attachment={attachment}
                      formatFileSize={formatFileSize}
                      onOpen={() => openAttachmentPreview(selectedMessage, attachment)}
                      onDownload={(event) => {
                        event?.stopPropagation?.();
                        downloadAttachmentFile(selectedMessage, attachment);
                      }}
                    />
                  );
                })}
              </Stack>
            </Stack>
          ) : null}
          {selectedMessageHasQuotedHistory ? (
            <Button
              onClick={() => setShowQuotedHistory((prev) => !prev)}
              sx={{
                mb: 1.1,
                px: 0.2,
                minWidth: 0,
                textTransform: 'none',
                color: ui.mutedText,
                fontWeight: 700,
              }}
            >
              {showQuotedHistory ? 'Скрыть историю переписки' : 'Показать историю переписки'}
            </Button>
          ) : null}
          <Box
            className={!selectedMessageQuotedHtml && selectedMessageUsesQuoteFallback && !showQuotedHistory ? 'mail-quote-collapsed' : ''}
            sx={getMailRenderedContentSx({ ui, theme })}
            dangerouslySetInnerHTML={{ __html: selectedMessageHtml || '<p style="color:#999">Нет содержимого</p>' }}
          />
          {selectedMessageQuotedHtml && showQuotedHistory ? (
            <Box
              sx={getMailRenderedContentSx({ ui, theme, quoted: true })}
              dangerouslySetInnerHTML={{ __html: selectedMessageQuotedHtml }}
            />
          ) : null}
        </Box>
      )}
    </>
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
      sx={{
        display: 'grid',
        gap: 0,
        gridTemplateColumns: { xs: '1fr', md: '220px minmax(300px, 360px) 1fr' },
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: ui.panelBg,
      }}
    >
      {renderFolderRail}
      {listPanel}
      {previewPanel}
    </Box>
  ) : (
    <Box
      sx={{
        display: 'grid',
        gap: 0,
        gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr)' },
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        bgcolor: ui.panelBg,
      }}
    >
      {renderFolderRail}
      {readingPaneMode === 'bottom' ? (
        <Box
          sx={{
            minHeight: 0,
            height: '100%',
            display: 'grid',
            gap: 0,
            gridTemplateRows: 'minmax(260px, 42%) minmax(0, 1fr)',
          }}
        >
          {listPanel}
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
      onTouchStartCapture={handlePreviewEdgeTouchStart}
      onTouchMoveCapture={handlePreviewEdgeTouchMove}
      onTouchEndCapture={handlePreviewEdgeTouchEnd}
      onTouchCancelCapture={handlePreviewEdgeTouchEnd}
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
          ? `transform ${MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS}ms ease-out, box-shadow ${MAIL_MOBILE_EDGE_SWIPE_ANIMATION_MS}ms ease-out`
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
              ? 'Пароль корпоративной почты изменился или устарел. Логин сохранён, введите только новый пароль и почта снова откроется на всех ваших устройствах.'
              : 'При первом входе в раздел Почта нужно один раз подтвердить корпоративный логин и пароль для Exchange, чтобы он сохранился в вашем профиле.'}
        </Typography>
        {!mailRequiresRelogin || canSaveMailForAllDevices ? (
          <>
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
  const showSearchToolbar = (!isMobile || !hasMobileSelection) && !showInitialMailLoading;
  const showPageChrome = !isMobileFullscreenPreview;

  return (
    <MainLayout
      headerMode={isMobileFullscreenPreview ? 'hidden' : 'notifications-only'}
      contentMode={isMobile ? 'edge-to-edge-mobile' : 'default'}
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
        {showPageChrome && message ? <Alert severity="success" onClose={() => setMessage('')} sx={{ borderRadius: ui.radiusMd, mb: 1 }}>{message}</Alert> : null}
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

        {showInitialMailLoading ? (
          <MailInitialLoadingState ui={ui} />
        ) : (
          canRenderMailArea ? mainMailArea : mailCredentialsPanel
        )}

        {canRenderMailArea && !isMobileFullscreenPreview ? (
          <IconButton
            data-testid="mail-compose-fab"
            data-mobile-bulk-offset={isMobile && selectedMessageIds.length > 0 ? 'true' : 'false'}
            aria-label="Написать письмо"
            onClick={openCompose}
            sx={{
              position: 'fixed',
              right: { xs: 16, md: 24 },
              bottom: {
                xs: selectedMessageIds.length > 0
                  ? 'calc(92px + env(safe-area-inset-bottom, 0px))'
                  : 'calc(20px + env(safe-area-inset-bottom, 0px))',
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
              onClose={() => setHeadersOpen(false)}
              headers={headersLoading ? { items: [{ name: 'Статус', value: 'Загрузка заголовков...' }] } : messageHeaders}
            />
          </Suspense>
        ) : null}

        <Dialog open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: getMailDialogPaperSx(ui) }}>
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
            <Button onClick={() => setFolderDialogOpen(false)}>Отмена</Button>
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
                  ? 'Exchange больше не принимает сохранённый пароль. Введите новый пароль от корпоративной учётной записи.'
                  : mailCredentialsReason === 'shared'
                    ? 'После успешной проверки логин и пароль сохранятся в вашем профиле, и этот ящик будет работать на всех ваших устройствах.'
                    : 'После успешной проверки логин и пароль будут сохранены и почта откроется без повторного ввода.'}
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
                label="Корпоративный пароль"
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
              onClose={() => setAttachmentPreview(createEmptyAttachmentPreview())}
              onDownload={() => { if (attachmentPreview?.blob) downloadBlobFile(attachmentPreview.blob, attachmentPreview.filename || 'attachment.bin', { preferOpenFallback: true }); }}
              formatFileSize={formatFileSize}
              maxPreviewFileBytes={MAX_PREVIEW_FILE_BYTES}
            />
          </Suspense>
        ) : null}

        {signatureOpen ? (
          <Suspense fallback={null}>
            <MailSignatureDialog
              open={signatureOpen}
              onClose={() => setSignatureOpen(false)}
              signatureHtml={signatureHtml}
              onSignatureChange={setSignatureHtml}
              signatureSaving={signatureSaving}
              onClear={() => setSignatureHtml('')}
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
              handleMailCredentialsRequired={handleMailCredentialsRequired}
              getMailErrorDetail={getMailErrorDetail}
            />
          </Suspense>
        ) : null}

        <Dialog open={itOpen} onClose={() => setItOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: getMailDialogPaperSx(ui) }}>
          <DialogTitle sx={getMailDialogTitleSx(ui, { fontWeight: 700 })}>Заявка в IT</DialogTitle>
          <DialogContent dividers sx={getMailDialogContentSx(ui)}>
            <Stack spacing={1.1} sx={{ mt: 0.5 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Шаблон</InputLabel>
                <Select
                  label="Шаблон"
                  value={itTemplateId}
                  onChange={(event) => {
                    const value = String(event.target.value || '');
                    setItTemplateId(value);
                    const found = templates.find((item) => String(item.id) === value);
                    const defaults = {};
                    (Array.isArray(found?.fields) ? found.fields : []).forEach((field) => { defaults[String(field?.key || '')] = String(field?.default_value || ''); });
                    setItFieldValues(defaults);
                  }}
                >
                  <MenuItem value="">Выберите шаблон</MenuItem>
                  {templates.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.title || item.code}</MenuItem>)}
                </Select>
              </FormControl>
              {Array.isArray(activeTemplate?.fields) ? activeTemplate.fields.map((field) => (
                <TextField
                  key={String(field?.key || '')}
                  size="small"
                  label={String(field?.label || field?.key || 'Поле')}
                  value={String(itFieldValues[String(field?.key || '')] || '')}
                  onChange={(event) => setItFieldValues((prev) => ({ ...prev, [String(field?.key || '')]: event.target.value }))}
                  fullWidth
                />
              )) : null}
            </Stack>
          </DialogContent>
          <DialogActions sx={getMailDialogActionsSx(ui)}>
            <Button onClick={() => { setItTemplateId(''); setItFieldValues({}); }} sx={{ textTransform: 'none' }}>Очистить</Button>
            <Button onClick={() => setItOpen(false)} sx={{ textTransform: 'none' }}>Отмена</Button>
            <Button
              variant="contained"
              onClick={async () => {
                if (!itTemplateId) { setError('Выберите шаблон IT-заявки.'); return; }
                try {
                  await mailAPI.sendItRequest({ template_id: itTemplateId, fields: itFieldValues || {} });
                  setItOpen(false);
                  setMessage('IT-заявка отправлена.');
                } catch (requestError) {
                  if (!(await handleMailCredentialsRequired(requestError, 'Не удалось отправить IT-заявку.'))) {
                    setError(getMailErrorDetail(requestError, 'Не удалось отправить IT-заявку.'));
                  }
                }
              }}
              sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
            >
              Отправить
            </Button>
          </DialogActions>
        </Dialog>

        {templatesOpen ? (
          <Suspense fallback={null}>
            <MailTemplatesDialog
              open={templatesOpen}
              onClose={() => setTemplatesOpen(false)}
              templates={templates}
              startCreateTemplate={startCreateTemplate}
              templateEditId={templateEditId}
              startEditTemplate={startEditTemplate}
              templateCode={templateCode}
              setTemplateCode={setTemplateCode}
              templateTitle={templateTitle}
              setTemplateTitle={setTemplateTitle}
              templateCategory={templateCategory}
              setTemplateCategory={setTemplateCategory}
              templateSubject={templateSubject}
              setTemplateSubject={setTemplateSubject}
              templateBody={templateBody}
              setTemplateBody={setTemplateBody}
              addTemplateField={addTemplateField}
              templateFields={templateFields}
              moveTemplateField={moveTemplateField}
              removeTemplateField={removeTemplateField}
              updateTemplateField={updateTemplateField}
              normalizeFieldKey={normalizeTemplateFieldKey}
              normalizeFieldOptions={normalizeTemplateFieldOptions}
              fieldTypes={TEMPLATE_FIELD_TYPES}
              templateVariableHints={templateVariableHints}
              templateEditorPreview={templateEditorPreview}
              saveTemplate={saveTemplate}
              templateSaving={templateSaving}
              deleteTemplate={deleteTemplate}
              templateDeleting={templateDeleting}
            />
          </Suspense>
        ) : null}
      </PageShell>
    </MainLayout>
  );
}

export default Mail;
