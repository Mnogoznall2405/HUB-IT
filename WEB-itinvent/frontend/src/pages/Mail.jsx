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
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import InboxIcon from '@mui/icons-material/Inbox';
import SendIcon from '@mui/icons-material/Send';
import FolderIcon from '@mui/icons-material/Folder';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import DOMPurify from 'dompurify';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { mailAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import useDebounce from '../hooks/useDebounce';
import MailAttachmentPreviewDialog from '../components/mail/MailAttachmentPreviewDialog';
import MailAdvancedSearchDialog from '../components/mail/MailAdvancedSearchDialog';
import MailBulkActionBar from '../components/mail/MailBulkActionBar';
import MailComposeDialog from '../components/mail/MailComposeDialog';
import MailFolderRail from '../components/mail/MailFolderRail';
import MailHeadersDialog from '../components/mail/MailHeadersDialog';
import MailMessageList from '../components/mail/MailMessageList';
import MailPreviewHeader from '../components/mail/MailPreviewHeader';
import MailSignatureDialog from '../components/mail/MailSignatureDialog';
import MailShortcutHelpDialog from '../components/mail/MailShortcutHelpDialog';
import MailTemplatesDialog from '../components/mail/MailTemplatesDialog';
import MailToolbar from '../components/mail/MailToolbar';
import MailToolsMenu from '../components/mail/MailToolsMenu';
import MailViewSettingsDialog from '../components/mail/MailViewSettingsDialog';
import { buildOfficeUiTokens } from '../theme/officeUiTokens';

const POLL_INTERVAL_MS = 15000;
const MAX_PREVIEW_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const COMPOSE_DRAFT_STORAGE_KEY = 'mail_compose_draft_v2';
const MAIL_RECENT_SEARCHES_KEY = 'mail_recent_searches_v1';

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
  mark_read_on_select: false,
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

const sanitizeIncomingMailHtml = (html) => {
  const source = String(html || '').trim();
  if (!source) return '';
  return DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
  });
};

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

const downloadBlobFile = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = String(filename || 'attachment.bin');
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
};

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

function Mail() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { hasPermission } = useAuth();
  const canManageUsers = hasPermission('settings.users.manage');

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [messageActionLoading, setMessageActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [folder, setFolder] = useState('inbox');
  const [viewMode, setViewMode] = useState('messages');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 500);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [hasAttachmentsOnly, setHasAttachmentsOnly] = useState(false);
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  const [mailboxInfo, setMailboxInfo] = useState(null);
  const [folderSummary, setFolderSummary] = useState({});
  const [folderTree, setFolderTree] = useState([]);
  const [mailPreferences, setMailPreferences] = useState(DEFAULT_MAIL_PREFERENCES);
  const [mailPreferencesDraft, setMailPreferencesDraft] = useState(DEFAULT_MAIL_PREFERENCES);
  const [mailPreferencesOpen, setMailPreferencesOpen] = useState(false);
  const [mailPreferencesSaving, setMailPreferencesSaving] = useState(false);
  const [listData, setListData] = useState({ items: [], total: 0, offset: 0, limit: 50, has_more: false, next_offset: null, search_limited: false, searched_window: 0 });
  const [selectedId, setSelectedId] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [selectedByMode, setSelectedByMode] = useState({ messages: '', conversations: '' });
  const [moveTarget, setMoveTarget] = useState('');
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedFiltersDraft, setAdvancedFiltersDraft] = useState(DEFAULT_ADVANCED_FILTERS);
  const [advancedFiltersApplied, setAdvancedFiltersApplied] = useState(DEFAULT_ADVANCED_FILTERS);
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

  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState('new');
  const [composeSending, setComposeSending] = useState(false);
  const [composeError, setComposeError] = useState('');
  const [composeToOptions, setComposeToOptions] = useState([]);
  const [composeToLoading, setComposeToLoading] = useState(false);
  const [composeToSearch, setComposeToSearch] = useState('');
  const debouncedComposeToSearch = useDebounce(composeToSearch, 400);
  const [composeToValues, setComposeToValues] = useState([]);
  const [composeCcValues, setComposeCcValues] = useState([]);
  const [composeBccValues, setComposeBccValues] = useState([]);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFiles, setComposeFiles] = useState([]);
  const [composeDraftAttachments, setComposeDraftAttachments] = useState([]);
  const [composeFieldErrors, setComposeFieldErrors] = useState({});
  const [composeDraftId, setComposeDraftId] = useState('');
  const [composeReplyToMessageId, setComposeReplyToMessageId] = useState('');
  const [composeForwardMessageId, setComposeForwardMessageId] = useState('');
  const [composeUploadProgress, setComposeUploadProgress] = useState(0);
  const [composeDragActive, setComposeDragActive] = useState(false);
  const [draftSyncState, setDraftSyncState] = useState('idle');
  const [draftSavedAt, setDraftSavedAt] = useState('');
  const [dismissedComposeWarnings, setDismissedComposeWarnings] = useState([]);

  const [quickReplyBody, setQuickReplyBody] = useState('');
  const [quickReplySending, setQuickReplySending] = useState(false);

  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState('');

  const [templates, setTemplates] = useState([]);
  const [itOpen, setItOpen] = useState(false);
  const [itTemplateId, setItTemplateId] = useState('');
  const [itFieldValues, setItFieldValues] = useState({});

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

  const messageListRef = useRef(null);
  const loadMoreSentinelRef = useRef(null);
  const conversationScrollRef = useRef(null);
  const searchInputRef = useRef(null);
  const composeUploadAbortRef = useRef(null);
  const dragMessageIdsRef = useRef([]);
  const detailRequestAbortRef = useRef(null);
  const templatesInitRef = useRef(false);
  const listDataRef = useRef(listData);
  const selectedIdRef = useRef(selectedId);
  const detailContextRef = useRef('');

  const composeDraftKey = useMemo(() => `${COMPOSE_DRAFT_STORAGE_KEY}:${String(mailboxInfo?.mailbox_email || 'default').toLowerCase()}`, [mailboxInfo?.mailbox_email]);
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
  const selectedMessageAttachments = useMemo(() => (Array.isArray(selectedMessage?.attachments) ? selectedMessage.attachments : []), [selectedMessage?.attachments]);
  const selectedMessageAttachmentTotalSize = useMemo(() => formatFileSize(sumAttachmentSize(selectedMessageAttachments)), [selectedMessageAttachments]);
  const mailboxEmails = useMemo(() => {
    const values = [mailboxInfo?.mailbox_email, mailboxInfo?.mailbox_login];
    const set = new Set();
    values.forEach((value) => {
      const normalized = String(value || '').trim().toLowerCase();
      if (normalized) set.add(normalized);
    });
    return set;
  }, [mailboxInfo?.mailbox_email, mailboxInfo?.mailbox_login]);

  useEffect(() => { listDataRef.current = listData; }, [listData]);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const clearSelection = useCallback(({ mode = viewMode, allModes = false } = {}) => {
    if (detailRequestAbortRef.current) {
      detailRequestAbortRef.current.abort();
      detailRequestAbortRef.current = null;
    }
    const targetMode = mode === 'conversations' ? 'conversations' : 'messages';
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
  }, [viewMode]);

  const refreshConfig = useCallback(async () => {
    try {
      setMailboxInfo(await mailAPI.getMyConfig());
    } catch (requestError) {
      setMailboxInfo(null);
      setError(requestError?.response?.data?.detail || 'Не удалось загрузить почтовую конфигурацию.');
    }
  }, []);

  const refreshTemplates = useCallback(async () => {
    try {
      const data = await mailAPI.getTemplates({ include_inactive: canManageUsers ? true : undefined });
      setTemplates(Array.isArray(data?.items) ? data.items : []);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось загрузить шаблоны IT-заявок.');
    }
  }, [canManageUsers]);

  const refreshFolderSummary = useCallback(async () => {
    try {
      const data = await mailAPI.getFolderSummary();
      setFolderSummary(data?.items && typeof data.items === 'object' ? data.items : {});
    } catch {
      setFolderSummary({});
    }
  }, []);

  const refreshFolderTree = useCallback(async () => {
    try {
      const data = await mailAPI.getFolderTree();
      setFolderTree(Array.isArray(data?.items) ? data.items : []);
    } catch {
      setFolderTree([]);
    }
  }, []);

  const refreshMailPreferences = useCallback(async () => {
    try {
      const data = await mailAPI.getPreferences();
      const nextValue = { ...DEFAULT_MAIL_PREFERENCES, ...(data || {}) };
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

  const fetchList = useCallback(async ({ reset = true, silent = false } = {}) => {
    const currentListData = listDataRef.current || {};
    const currentOffset = reset ? 0 : Number(currentListData.next_offset ?? currentListData.offset ?? 0);
    if (reset) {
      if (!silent) setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const params = {
        folder,
        q: debouncedSearch || undefined,
        unread_only: unreadOnly || undefined,
        has_attachments: hasAttachmentsOnly || undefined,
        date_from: filterDateFrom || undefined,
        date_to: filterDateTo || undefined,
        folder_scope: advancedFiltersApplied?.folder_scope || undefined,
        from_filter: advancedFiltersApplied?.from_filter || undefined,
        to_filter: advancedFiltersApplied?.to_filter || undefined,
        subject_filter: advancedFiltersApplied?.subject_filter || undefined,
        body_filter: advancedFiltersApplied?.body_filter || undefined,
        importance: advancedFiltersApplied?.importance || undefined,
        limit: 50,
        offset: currentOffset,
      };
      const data = viewMode === 'conversations' ? await mailAPI.getConversations(params) : await mailAPI.getMessages(params);
      const incomingItems = Array.isArray(data?.items) ? data.items : [];
      const mergedItems = reset ? incomingItems : [...(currentListData.items || []), ...incomingItems];
      const nextListData = {
        items: mergedItems,
        total: Number(data?.total || mergedItems.length || 0),
        offset: Number(data?.offset || 0),
        limit: Number(data?.limit || 50),
        has_more: Boolean(data?.has_more),
        next_offset: data?.next_offset ?? null,
        search_limited: Boolean(data?.search_limited),
        searched_window: Number(data?.searched_window || 0),
      };
      setListData((prev) => {
        const prevItems = Array.isArray(prev?.items) ? prev.items : [];
        const nextItems = Array.isArray(nextListData.items) ? nextListData.items : [];
        const sameItems = prevItems.length === nextItems.length
          && prevItems.every((item, index) => isListItemSame(item, nextItems[index], viewMode));
        const sameMeta = Number(prev?.total || 0) === Number(nextListData.total || 0)
          && Number(prev?.offset || 0) === Number(nextListData.offset || 0)
          && Number(prev?.limit || 0) === Number(nextListData.limit || 0)
          && Boolean(prev?.has_more) === Boolean(nextListData.has_more)
          && String(prev?.next_offset ?? '') === String(nextListData.next_offset ?? '')
          && Boolean(prev?.search_limited) === Boolean(nextListData.search_limited)
          && Number(prev?.searched_window || 0) === Number(nextListData.searched_window || 0);
        if (sameItems && sameMeta) return prev;
        return nextListData;
      });
      if (reset) {
        const currentSelectedId = String(selectedIdRef.current || '');
        const exists = incomingItems.some((item) => String(viewMode === 'conversations' ? item.conversation_id : item.id) === currentSelectedId);
        if (currentSelectedId && !exists) {
          clearSelection({ mode: viewMode });
        }
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось загрузить список писем.');
      if (reset) setListData((prev) => ({ ...prev, items: [] }));
    } finally {
      if (reset) setLoading(false); else setLoadingMore(false);
    }
  }, [
    folder,
    debouncedSearch,
    unreadOnly,
    hasAttachmentsOnly,
    filterDateFrom,
    filterDateTo,
    viewMode,
    clearSelection,
    advancedFiltersApplied,
  ]);

  const refreshList = useCallback(async ({ silent = false } = {}) => {
    await fetchList({ reset: true, silent });
  }, [fetchList]);

  const loadMoreMessages = useCallback(async () => {
    if (loadingMore || !listData.has_more) return;
    await fetchList({ reset: false, silent: true });
  }, [loadingMore, listData.has_more, fetchList]);

  useEffect(() => {
    refreshConfig();
    refreshTemplates();
    refreshFolderSummary();
    refreshFolderTree();
    refreshMailPreferences();
  }, [refreshConfig, refreshTemplates, refreshFolderSummary, refreshFolderTree, refreshMailPreferences]);

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
    if (templatesInitRef.current) return;
    templatesInitRef.current = true;
    if (!templateEditId) {
      if (templates.length > 0) startEditTemplate(templates[0]);
      else startCreateTemplate();
    }
  }, [templatesOpen, templateEditId, templates, startEditTemplate, startCreateTemplate]);

  useEffect(() => { refreshList(); }, [refreshList]);

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
    const handler = () => { refreshList({ silent: true }); refreshFolderSummary(); };
    window.addEventListener('mail-needs-refresh', handler);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        refreshList({ silent: true });
        refreshFolderSummary();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener('mail-needs-refresh', handler);
      clearInterval(timer);
    };
  }, [refreshList, refreshFolderSummary]);


  useEffect(() => {
    const query = String(debouncedComposeToSearch || '').trim();
    if (query.length < 2) { setComposeToOptions([]); return; }
    let active = true;
    setComposeToLoading(true);
    mailAPI.searchContacts(query)
      .then((items) => {
        if (active) setComposeToOptions(Array.isArray(items) ? items : []);
      })
      .finally(() => {
        if (active) setComposeToLoading(false);
      });
    return () => { active = false; };
  }, [debouncedComposeToSearch]);

  useEffect(() => {
    if (!composeFieldErrors?.to && !composeFieldErrors?.cc && !composeFieldErrors?.bcc) return;
    const to = toRecipientEmails(composeToValues);
    const cc = toRecipientEmails(composeCcValues);
    const bcc = toRecipientEmails(composeBccValues);
    const nextErrors = { ...(composeFieldErrors || {}) };
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
    if (changed) setComposeFieldErrors(nextErrors);
  }, [composeFieldErrors, composeToValues, composeCcValues, composeBccValues]);

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
    if (!selectedId) {
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
    const loadDetails = async () => {
      if (shouldShowSkeleton) setDetailLoading(true);
      try {
        if (viewMode === 'conversations') {
          const data = await mailAPI.getConversation(
            selectedId,
            { folder, folder_scope: advancedFiltersApplied?.folder_scope || 'current' },
            { signal: controller.signal }
          );
          if (cancelled) return;
          const items = Array.isArray(data?.items) ? data.items : [];
          setSelectedConversation(data || null);
          setSelectedMessage(items.length > 0 ? items[items.length - 1] : null);
        } else {
          const data = await mailAPI.getMessage(selectedId, { signal: controller.signal });
          if (cancelled) return;
          setSelectedConversation(null);
          setSelectedMessage(data || null);
        }
      } catch (requestError) {
        if (cancelled || controller.signal.aborted || requestError?.code === 'ERR_CANCELED') return;
        const statusCode = Number(requestError?.response?.status || 0);
        if (viewMode === 'conversations' && statusCode === 404) {
          clearSelection({ mode: 'conversations' });
          return;
        }
        setError(requestError?.response?.data?.detail || 'Не удалось загрузить письмо.');
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
  }, [selectedId, viewMode, folder, clearSelection, advancedFiltersApplied]);

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

  const hasComposeContent = useMemo(() => Boolean(
    toRecipientEmails(composeToValues).length
    || toRecipientEmails(composeCcValues).length
    || toRecipientEmails(composeBccValues).length
    || String(composeSubject || '').trim()
    || String(composeBody || '').replace(/<[^>]*>/g, '').trim()
    || composeFiles.length
    || composeDraftAttachments.length
  ), [composeToValues, composeCcValues, composeBccValues, composeSubject, composeBody, composeFiles.length, composeDraftAttachments.length]);

  const persistLocalComposeDraft = useCallback(() => {
    const payload = {
      compose_mode: composeMode || 'draft',
      to: toRecipientEmails(composeToValues),
      cc: toRecipientEmails(composeCcValues),
      bcc: toRecipientEmails(composeBccValues),
      subject: String(composeSubject || ''),
      body: String(composeBody || ''),
      draft_id: String(composeDraftId || ''),
      reply_to_message_id: String(composeReplyToMessageId || ''),
      forward_message_id: String(composeForwardMessageId || ''),
      draft_attachments: Array.isArray(composeDraftAttachments) ? composeDraftAttachments : [],
      local_attachment_names: composeFiles.map((file) => String(file?.name || '')).filter(Boolean),
      saved_at: new Date().toISOString(),
    };
    try {
      window.localStorage.setItem(composeDraftKey, JSON.stringify(payload));
    } catch {
      // ignore local storage errors
    }
  }, [
    composeMode,
    composeToValues,
    composeCcValues,
    composeBccValues,
    composeSubject,
    composeBody,
    composeDraftId,
    composeReplyToMessageId,
    composeForwardMessageId,
    composeDraftAttachments,
    composeFiles,
    composeDraftKey,
  ]);

  const restoreLocalComposeDraft = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(composeDraftKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      setComposeMode(String(parsed.compose_mode || 'draft'));
      setComposeToValues(toRecipientEmails(parsed.to));
      setComposeCcValues(toRecipientEmails(parsed.cc));
      setComposeBccValues(toRecipientEmails(parsed.bcc));
      setComposeSubject(String(parsed.subject || ''));
      setComposeBody(String(parsed.body || ''));
      setComposeFiles([]);
      setComposeDraftAttachments(Array.isArray(parsed.draft_attachments) ? parsed.draft_attachments : []);
      setComposeDraftId(String(parsed.draft_id || ''));
      setComposeReplyToMessageId(String(parsed.reply_to_message_id || ''));
      setComposeForwardMessageId(String(parsed.forward_message_id || ''));
      setDraftSyncState('local_only');
      setDraftSavedAt(String(parsed.saved_at || ''));
      return true;
    } catch {
      return false;
    }
  }, [composeDraftKey]);

  const flushComposeDraft = useCallback(async ({ includeFiles = false, silent = true } = {}) => {
    if (!hasComposeContent && !composeDraftId) return null;
    setDraftSyncState('saving');
    try {
      const data = await mailAPI.saveDraftMultipart({
        draftId: composeDraftId,
        composeMode,
        to: toRecipientEmails(composeToValues),
        cc: toRecipientEmails(composeCcValues),
        bcc: toRecipientEmails(composeBccValues),
        subject: String(composeSubject || ''),
        body: String(composeBody || ''),
        isHtml: true,
        replyToMessageId: composeReplyToMessageId,
        forwardMessageId: composeForwardMessageId,
        retainExistingAttachments: composeDraftAttachments.map((item) => item?.download_token || item?.id).filter(Boolean),
        files: includeFiles ? composeFiles : [],
      });
      setComposeDraftId(String(data?.draft_id || composeDraftId || ''));
      setComposeDraftAttachments(Array.isArray(data?.attachments) ? data.attachments : composeDraftAttachments);
      if (includeFiles && composeFiles.length > 0) setComposeFiles([]);
      setDraftSavedAt(String(data?.saved_at || new Date().toISOString()));
      setDraftSyncState('synced');
      try { window.localStorage.removeItem(composeDraftKey); } catch { /* ignore */ }
      return data;
    } catch (requestError) {
      persistLocalComposeDraft();
      setDraftSyncState('local_only');
      if (!silent) {
        setError(requestError?.response?.data?.detail || 'Не удалось сохранить черновик на сервере.');
      }
      throw requestError;
    }
  }, [
    hasComposeContent,
    composeDraftId,
    composeMode,
    composeToValues,
    composeCcValues,
    composeBccValues,
    composeSubject,
    composeBody,
    composeReplyToMessageId,
    composeForwardMessageId,
    composeDraftAttachments,
    composeFiles,
    composeDraftKey,
    persistLocalComposeDraft,
  ]);

  useEffect(() => {
    if (!composeOpen || composeSending || (!hasComposeContent && !composeDraftId)) return undefined;
    const timer = setTimeout(() => {
      flushComposeDraft({ includeFiles: false, silent: true }).catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [composeOpen, composeSending, hasComposeContent, composeDraftId, flushComposeDraft]);

  const clearComposeDraft = useCallback(() => {
    setComposeToValues([]);
    setComposeCcValues([]);
    setComposeBccValues([]);
    setComposeSubject('');
    setComposeBody('');
    setComposeFiles([]);
    setComposeDraftAttachments([]);
    setComposeDraftId('');
    setComposeReplyToMessageId('');
    setComposeForwardMessageId('');
    setComposeUploadProgress(0);
    setDraftSyncState('idle');
    setDraftSavedAt('');
    setComposeFieldErrors({});
    setComposeError('');
    setDismissedComposeWarnings([]);
    try { window.localStorage.removeItem(composeDraftKey); } catch { /* ignore */ }
  }, [composeDraftKey]);

  const handleCloseCompose = useCallback(async () => {
    if (composeSending) return;
    if (!hasComposeContent && composeDraftId) {
      try {
        await mailAPI.deleteDraft(composeDraftId);
      } catch {
        // ignore
      }
      clearComposeDraft();
      setComposeOpen(false);
      return;
    }
    if (hasComposeContent || composeDraftId) {
      try {
        await flushComposeDraft({ includeFiles: true, silent: true });
      } catch {
        // fallback is saved to local storage
      }
    }
    setComposeOpen(false);
  }, [composeSending, hasComposeContent, composeDraftId, clearComposeDraft, flushComposeDraft]);

  const openCompose = useCallback(() => {
    const restored = restoreLocalComposeDraft();
    if (!restored) {
      setComposeMode('new');
      clearComposeDraft();
    }
    setComposeFieldErrors({});
    setComposeOpen(true);
    setDismissedComposeWarnings([]);
  }, [clearComposeDraft, restoreLocalComposeDraft]);

  const openComposeFromMessage = useCallback((mode) => {
    if (!selectedMessage) return;
    const key = mode === 'reply_all' ? 'reply_all' : mode;
    const context = selectedMessage?.compose_context?.[key] || {};
    setComposeFieldErrors({});
    setComposeError('');
    setComposeMode(mode || 'reply');
    setComposeToValues(toRecipientEmails(context?.to));
    setComposeCcValues(toRecipientEmails(context?.cc));
    setComposeBccValues([]);
    setComposeSubject(String(context?.subject || selectedMessage.subject || ''));
    setComposeBody(`<p><br></p>${String(context?.quote_html || '')}`);
    setComposeFiles([]);
    setComposeDraftAttachments([]);
    setComposeDraftId('');
    setComposeReplyToMessageId(mode === 'forward' ? '' : String(selectedMessage.id || ''));
    setComposeForwardMessageId(mode === 'forward' ? String(selectedMessage.id || '') : '');
    setDraftSyncState('idle');
    setDraftSavedAt('');
    setDismissedComposeWarnings([]);
    try { window.localStorage.removeItem(composeDraftKey); } catch { /* ignore */ }
    setComposeOpen(true);
  }, [selectedMessage, composeDraftKey]);

  const openComposeFromDraft = useCallback(() => {
    if (!selectedMessage || String(selectedMessage.folder || '').toLowerCase() !== 'drafts') return;
    const draftContext = selectedMessage?.draft_context || {};
    setComposeFieldErrors({});
    setComposeError('');
    setComposeMode(String(draftContext.compose_mode || 'draft'));
    setComposeToValues(toRecipientEmails(selectedMessage.to));
    setComposeCcValues(toRecipientEmails(selectedMessage.cc));
    setComposeBccValues(toRecipientEmails(selectedMessage.bcc));
    setComposeSubject(String(selectedMessage.subject || ''));
    setComposeBody(String(selectedMessage.body_html || ''));
    setComposeFiles([]);
    setComposeDraftAttachments(Array.isArray(selectedMessage.attachments) ? selectedMessage.attachments : []);
    setComposeDraftId(String(selectedMessage.id || ''));
    setComposeReplyToMessageId(String(draftContext.reply_to_message_id || ''));
    setComposeForwardMessageId(String(draftContext.forward_message_id || ''));
    setDraftSyncState('synced');
    setDismissedComposeWarnings([]);
    try { window.localStorage.removeItem(composeDraftKey); } catch { /* ignore */ }
    setComposeOpen(true);
  }, [selectedMessage, composeDraftKey]);

  const handleSendCompose = useCallback(async () => {
    const to = toRecipientEmails(composeToValues);
    const cc = toRecipientEmails(composeCcValues);
    const bcc = toRecipientEmails(composeBccValues);
    const validationErrors = {};
    if (to.length === 0) validationErrors.to = 'Укажите хотя бы одного получателя.';
    const invalidTo = to.filter((value) => !isValidEmail(value));
    const invalidCc = cc.filter((value) => !isValidEmail(value));
    const invalidBcc = bcc.filter((value) => !isValidEmail(value));
    if (invalidTo.length > 0) validationErrors.to = 'Проверьте адреса в поле "Кому".';
    if (invalidCc.length > 0) validationErrors.cc = 'Проверьте адреса в поле "Копия".';
    if (invalidBcc.length > 0) validationErrors.bcc = 'Проверьте адреса в поле "Скрытая копия".';
    if (Object.keys(validationErrors).length > 0) {
      setComposeFieldErrors(validationErrors);
      return;
    }
    setComposeFieldErrors({});
    setComposeError('');
    setComposeSending(true);
    setComposeUploadProgress(0);
    try {
      if (composeFiles.length > 0) {
        const controller = new AbortController();
        composeUploadAbortRef.current = controller;
        await mailAPI.sendMessageMultipart({
          to,
          cc,
          bcc,
          subject: String(composeSubject || ''),
          body: String(composeBody || ''),
          isHtml: true,
          replyToMessageId: composeReplyToMessageId,
          forwardMessageId: composeForwardMessageId,
          draftId: composeDraftId,
          files: composeFiles,
          signal: controller.signal,
          onUploadProgress: (event) => {
            const total = Number(event?.total || 0);
            const loaded = Number(event?.loaded || 0);
            if (total > 0) setComposeUploadProgress(Math.max(0, Math.min(100, Math.round((loaded / total) * 100))));
          },
        });
      } else {
        await mailAPI.sendMessage({
          to,
          cc,
          bcc,
          subject: String(composeSubject || ''),
          body: String(composeBody || ''),
          is_html: true,
          reply_to_message_id: composeReplyToMessageId,
          forward_message_id: composeForwardMessageId,
          draft_id: composeDraftId,
        });
      }
      clearComposeDraft();
      setComposeOpen(false);
      setMessage('Письмо отправлено.');
      await refreshList({ silent: true });
      await refreshFolderSummary();
    } catch (requestError) {
      setComposeError(requestError?.response?.data?.detail || 'Не удалось отправить письмо.');
    } finally {
      composeUploadAbortRef.current = null;
      setComposeUploadProgress(0);
      setComposeSending(false);
    }
  }, [composeToValues, composeCcValues, composeBccValues, composeSubject, composeBody, composeReplyToMessageId, composeForwardMessageId, composeDraftId, composeFiles, clearComposeDraft, refreshList, refreshFolderSummary]);

  const openSignatureEditor = useCallback(() => {
    setSignatureHtml(String(mailboxInfo?.mail_signature_html || ''));
    setSignatureOpen(true);
  }, [mailboxInfo?.mail_signature_html]);

  const handleSaveSignature = useCallback(async () => {
    setSignatureSaving(true);
    try {
      const data = await mailAPI.updateMyConfig({ mail_signature_html: String(signatureHtml || '') });
      setMailboxInfo(data || null);
      setSignatureOpen(false);
      setMessage('Подпись сохранена.');
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось сохранить подпись.');
    } finally {
      setSignatureSaving(false);
    }
  }, [signatureHtml]);

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

  const handleOpenHeaders = useCallback(async () => {
    if (!selectedMessage?.id) return;
    setHeadersOpen(true);
    setHeadersLoading(true);
    setMessageHeaders({ items: [] });
    try {
      const data = await mailAPI.getMessageHeaders(selectedMessage.id);
      setMessageHeaders(data?.items ? data : { items: [] });
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось загрузить заголовки письма.');
      setMessageHeaders({ items: [] });
    } finally {
      setHeadersLoading(false);
    }
  }, [selectedMessage?.id]);

  const handleDownloadMessageSource = useCallback(async () => {
    if (!selectedMessage?.id) return;
    try {
      const response = await mailAPI.downloadMessageSource(selectedMessage.id);
      const contentDisposition = response.headers['content-disposition'];
      const filename = parseDownloadFilename(contentDisposition, `${selectedMessage.subject || 'message'}.eml`);
      const blob = new Blob([response.data], { type: response.headers['content-type'] || 'message/rfc822' });
      downloadBlobFile(blob, filename);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось скачать исходник письма.');
    }
  }, [selectedMessage?.id, selectedMessage?.subject]);

  const handlePrintSelectedMessage = useCallback(() => {
    if (!selectedMessage) return;
    const html = sanitizeIncomingMailHtml(selectedMessage?.body_html) || '<p>Нет содержимого</p>';
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=920,height=720');
    if (!printWindow) {
      setError('Не удалось открыть окно печати.');
      return;
    }
    printWindow.document.write(`
      <html>
        <head>
          <title>${String(selectedMessage.subject || 'Письмо')}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; line-height: 1.5; color: #111827; }
            h1 { font-size: 20px; margin-bottom: 8px; }
            .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
            img { max-width: 100%; }
            blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #cbd5e1; color: #475569; }
          </style>
        </head>
        <body>
          <h1>${String(selectedMessage.subject || '(без темы)')}</h1>
          <div class="meta">От: ${String(selectedMessage.sender || '-')}<br/>Дата: ${formatFullDate(selectedMessage.received_at)}</div>
          <div>${html}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }, [selectedMessage, formatFullDate]);

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
        await mailAPI.renameFolder(folderDialogTarget.id, { name });
        setMessage('Папка переименована.');
      } else {
        await mailAPI.createFolder({
          name,
          parent_folder_id: folderDialogParentId || '',
          scope: folderDialogScope || 'mailbox',
        });
        setMessage('Папка создана.');
      }
      setFolderDialogOpen(false);
      await refreshFolderTree();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось сохранить папку.');
    } finally {
      setFolderDialogSaving(false);
    }
  }, [
    folderDialogMode,
    folderDialogName,
    folderDialogTarget?.id,
    folderDialogParentId,
    folderDialogScope,
    refreshFolderTree,
  ]);

  const handleDeleteFolder = useCallback(async (item) => {
    if (!item?.id) return;
    if (!window.confirm(`Удалить папку "${item.label || item.name || 'без названия'}"?`)) return;
    try {
      await mailAPI.deleteFolder(item.id);
      if (String(folder) === String(item.id)) {
        clearSelection({ allModes: true });
        setFolder('inbox');
      }
      await refreshFolderTree();
      setMessage('Папка удалена.');
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось удалить папку.');
    }
  }, [folder, clearSelection, refreshFolderTree]);

  const handleToggleFavoriteFolder = useCallback(async (item) => {
    if (!item?.id) return;
    try {
      await mailAPI.setFolderFavorite(item.id, !Boolean(item?.is_favorite));
      await refreshFolderTree();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось обновить избранные папки.');
    }
  }, [refreshFolderTree]);

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
    await refreshList({ silent: true });
    await refreshFolderSummary();
    await refreshFolderTree();
  }, [refreshList, refreshFolderSummary, refreshFolderTree]);

  const runBulkAction = useCallback(async ({ action, targetFolder = '', permanent = false, successMessage = '' }) => {
    if (selectedMessageIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      await mailAPI.bulkMessageAction({
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
      setError(requestError?.response?.data?.detail || 'Не удалось выполнить массовое действие.');
    } finally {
      setBulkActionLoading(false);
    }
  }, [afterListMutation, clearSelection, selectedMessage?.id, selectedMessageIds, viewMode]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      const data = await mailAPI.markAllRead({
        folder,
        folder_scope: advancedFiltersApplied?.folder_scope || 'current',
      });
      await afterListMutation({ clearBulkSelection: false });
      setMessage(`Отмечено как прочитанное: ${Number(data?.changed || 0)}.`);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось отметить письма как прочитанные.');
    }
  }, [folder, advancedFiltersApplied, afterListMutation]);

  const handleArchiveSelectedMessage = useCallback(async () => {
    if (!selectedMessage?.id) return;
    setMessageActionLoading(true);
    try {
      await mailAPI.moveMessage(selectedMessage.id, { target_folder: 'archive' });
      clearSelection({ mode: viewMode });
      await afterListMutation();
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось отправить письмо в архив.');
    } finally {
      setMessageActionLoading(false);
    }
  }, [afterListMutation, clearSelection, selectedMessage?.id, viewMode]);

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
        await mailAPI.moveMessage(ids[0], { target_folder: targetFolder });
      } else {
        await mailAPI.bulkMessageAction({
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
      setError(requestError?.response?.data?.detail || 'Не удалось переместить письма.');
    }
  }, [afterListMutation, clearSelection, folder, selectedMessage?.id, selectedMessageIds, viewMode]);

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
        refreshList();
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
          mailAPI.deleteMessage(selectedMessage.id, { permanent: folder === 'trash' })
            .then(async () => {
              clearSelection({ mode: viewMode });
              await afterListMutation();
            })
            .catch((requestError) => {
              setError(requestError?.response?.data?.detail || 'Не удалось удалить письмо.');
            });
        }
        return;
      }
      if (event.key === 'Escape') {
        if (composeOpen) {
          event.preventDefault();
          handleCloseCompose();
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
    folder,
    handleCloseCompose,
    headersOpen,
    mailPreferencesOpen,
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
    const sender = String(item?.sender || '').trim().toLowerCase();
    if (sender && mailboxEmails.has(sender)) return true;
    if (folder === 'sent' || folder === 'drafts') return true;
    return false;
  }, [mailboxEmails, folder]);

  const openAttachmentPreview = useCallback(async (messageId, attachment) => {
    try {
      const response = await mailAPI.downloadAttachment(messageId, attachment?.download_token || attachment?.id);
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
      setError(requestError?.response?.data?.detail || 'Не удалось открыть вложение.');
    }
  }, []);

  const downloadAttachmentFile = useCallback(async (messageId, attachment) => {
    try {
      const response = await mailAPI.downloadAttachment(messageId, attachment?.download_token || attachment?.id);
      const contentDisposition = response.headers['content-disposition'];
      const filename = parseDownloadFilename(contentDisposition, attachment?.name || 'attachment.bin');
      const blob = new Blob([response.data], { type: response.headers['content-type'] });
      downloadBlobFile(blob, filename);
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || 'Не удалось скачать вложение.');
    }
  }, []);

  const selectedMessageHtml = useMemo(() => sanitizeIncomingMailHtml(selectedMessage?.body_html), [selectedMessage?.body_html]);
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
      const key = String(item?.well_known_key || item?.id || '');
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
  const composeWarnings = useMemo(() => {
    if (!composeOpen) return [];
    const recipientValues = [
      ...toRecipientEmails(composeToValues),
      ...toRecipientEmails(composeCcValues),
      ...toRecipientEmails(composeBccValues),
    ];
    const warnings = [];
    if (!String(composeSubject || '').trim()) {
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
    const plainBody = String(composeBody || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const attachmentMentioned = /(влож|прикреп|attach|attachment|файл)/i.test(plainBody);
    if (attachmentMentioned && composeFiles.length === 0 && composeDraftAttachments.length === 0) {
      warnings.push({
        id: 'missing_attachment',
        severity: 'warning',
        message: 'В тексте упомянуто вложение, но файлы не прикреплены.',
      });
    }
    return warnings.filter((item) => !dismissedComposeWarnings.includes(item.id));
  }, [
    composeOpen,
    composeToValues,
    composeCcValues,
    composeBccValues,
    composeSubject,
    composeBody,
    composeFiles.length,
    composeDraftAttachments.length,
    dismissedComposeWarnings,
    mailboxPrimaryDomain,
  ]);

  const listPanel = (
    <Paper
      variant="outlined"
      sx={{
        minHeight: 0,
        height: '100%',
        display: isMobile && selectedMessage ? 'none' : 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        overflow: 'hidden',
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
        />
      ) : null}
      <Box sx={{ px: 1.5, py: 1.1, borderBottom: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelBg }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Stack direction="row" spacing={0.8} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {viewMode === 'conversations' ? 'Диалоги' : currentFolderLabel}
            </Typography>
            {advancedFiltersApplied?.folder_scope === 'all' ? (
              <Chip size="small" variant="outlined" label="Все папки" />
            ) : null}
            {advancedFiltersActive ? (
              <Chip size="small" variant="outlined" label="Расширенный поиск" />
            ) : null}
          </Stack>
          <Chip size="small" label={Number(listData.total || 0)} sx={{ fontWeight: 700 }} />
        </Stack>
      </Box>
      <MailMessageList
        listSx={{ flex: 1, minHeight: 0 }}
        viewMode={viewMode}
        listData={listData}
        loading={loading}
        loadingMore={loadingMore}
        selectedItems={selectedItems}
        selectedId={selectedId}
        density={mailPreferences?.density || 'comfortable'}
        showPreviewSnippets={Boolean(mailPreferences?.show_preview_snippets)}
        onSelectId={async (value, item) => {
          const nextId = String(value || '');
          selectedIdRef.current = nextId;
          setSelectedId(nextId);
          setSelectedByMode((prev) => ({ ...(prev || {}), [viewMode]: nextId }));
          setMoveTarget('');
          if (viewMode === 'messages' && mailPreferences?.mark_read_on_select && item?.id && !item?.is_read) {
            setListData((prev) => ({
              ...(prev || {}),
              items: (Array.isArray(prev?.items) ? prev.items : []).map((listItem) => (
                String(listItem?.id || '') === String(item.id) ? { ...listItem, is_read: true } : listItem
              )),
            }));
            try {
              await mailAPI.markAsRead(item.id);
              refreshFolderSummary();
            } catch {
              // polling will reconcile state if needed
            }
          }
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
      />
    </Paper>
  );
  const previewContent = detailLoading ? (
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
            if (selectedMessage.is_read) await mailAPI.markAsUnread(selectedMessage.id); else await mailAPI.markAsRead(selectedMessage.id);
            await refreshList({ silent: true });
            await refreshFolderSummary();
          } catch (requestError) {
            setError(requestError?.response?.data?.detail || 'Не удалось изменить статус письма.');
          } finally {
            setMessageActionLoading(false);
          }
        }}
        onRestoreSelectedMessage={async () => {
          setMessageActionLoading(true);
          try {
            await mailAPI.restoreMessage(selectedMessage.id, { target_folder: String(selectedMessage?.restore_hint_folder || 'inbox') });
            clearSelection({ mode: viewMode });
            await afterListMutation();
          } catch (requestError) {
            setError(requestError?.response?.data?.detail || 'Не удалось восстановить письмо.');
          } finally {
            setMessageActionLoading(false);
          }
        }}
        onDeleteSelectedMessage={async (permanent) => {
          setMessageActionLoading(true);
          try {
            await mailAPI.deleteMessage(selectedMessage.id, { permanent: Boolean(permanent) });
            clearSelection({ mode: viewMode });
            await afterListMutation();
          } catch (requestError) {
            setError(requestError?.response?.data?.detail || 'Не удалось удалить письмо.');
          } finally {
            setMessageActionLoading(false);
          }
        }}
        onArchiveSelectedMessage={handleArchiveSelectedMessage}
        moveTarget={moveTarget}
        onMoveTargetChange={setMoveTarget}
        onMoveSelectedMessage={async () => {
          if (!moveTarget) return;
          setMessageActionLoading(true);
          try {
            await mailAPI.moveMessage(selectedMessage.id, { target_folder: moveTarget });
            clearSelection({ mode: viewMode });
            await afterListMutation();
          } catch (requestError) {
            setError(requestError?.response?.data?.detail || 'Не удалось переместить письмо.');
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
        onBackToList={() => { clearSelection({ mode: viewMode }); }}
      />
      {viewMode === 'conversations' ? (
        <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Box
            ref={conversationScrollRef}
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              px: 1.2,
              py: 1,
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
                const itemAttachments = Array.isArray(item?.attachments) ? item.attachments : [];
                return (
                  <Box key={item?.id || index}>
                    {showDaySeparator ? (
                      <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.2 }}>
                        <Chip
                          size="small"
                          label={currentDay}
                          sx={{
                            height: 22,
                            fontSize: '0.68rem',
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
                            bgcolor: getAvatarColor(item?.sender),
                            color: 'common.white',
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {getInitials(item?.sender)}
                        </Box>
                      ) : null}
                      <Paper
                        variant="outlined"
                        sx={{
                          px: 1.1,
                          py: 0.9,
                          maxWidth: { xs: '92%', md: '78%' },
                          borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
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
                            {mine ? 'Вы' : (item?.sender || '-')}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: mine ? 0.85 : 0.7 }}>
                            {formatTime(itemDateValue)}
                          </Typography>
                        </Stack>
                        <Box
                          sx={{
                            mt: 0.55,
                            fontSize: '0.88rem',
                            lineHeight: 1.45,
                            '& p': { m: 0 },
                            '& p + p': { mt: '0.45em' },
                            '& a': { color: mine ? 'inherit' : 'primary.main' },
                            '& img': { maxWidth: '100%' },
                            '& blockquote': {
                              m: '0.65em 0 0 0',
                              pl: 1,
                              borderLeft: '3px solid',
                              borderColor: mine ? alpha(theme.palette.common.white, 0.35) : ui.borderSoft,
                              color: mine ? 'rgba(255,255,255,0.88)' : 'text.secondary',
                            },
                          }}
                          dangerouslySetInnerHTML={{ __html: sanitizeIncomingMailHtml(item?.body_html) || '<p style="color:#999">Нет содержимого</p>' }}
                        />
                        {itemAttachments.length > 0 ? (
                          <Stack direction="row" spacing={0.45} flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                            {itemAttachments.map((attachment, attachmentIndex) => (
                              <Chip
                                key={`${attachment?.id || attachment?.name || attachmentIndex}`}
                                icon={<AttachFileIcon sx={{ fontSize: '14px !important' }} />}
                                size="small"
                                variant={mine ? 'filled' : 'outlined'}
                                label={attachment?.name || 'attachment'}
                                onClick={(event) => {
                                  event?.stopPropagation?.();
                                  openAttachmentPreview(item?.id, attachment);
                                }}
                                onDelete={(event) => {
                                  event?.stopPropagation?.();
                                  downloadAttachmentFile(item?.id, attachment);
                                }}
                                deleteIcon={<DownloadIcon sx={{ fontSize: '15px !important' }} />}
                                sx={{
                                  maxWidth: '100%',
                                  bgcolor: mine ? 'rgba(255,255,255,0.16)' : 'transparent',
                                  color: mine ? 'inherit' : 'text.primary',
                                  borderColor: mine ? alpha(theme.palette.common.white, 0.28) : ui.actionBorder,
                                  '& .MuiChip-label': {
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  },
                                  '& .MuiChip-deleteIcon': {
                                    color: mine ? 'rgba(255,255,255,0.85)' : 'text.secondary',
                                  },
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
                            fontSize: '0.64rem',
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
          <Box
            sx={{
              p: 1,
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
                InputProps={{ sx: { borderRadius: '10px' } }}
              />
              <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap gap={0.6}>
                <Stack direction="row" spacing={0.4}>
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
                <Typography variant="caption" color="text.secondary">Ответ отправляется отправителю выбранного сообщения.</Typography>
                <Button
                  size="small"
                  variant="contained"
                  disabled={quickReplySending || !String(quickReplyBody || '').trim()}
                  onClick={async () => {
                    if (!selectedMessage?.id) return;
                    setQuickReplySending(true);
                    try {
                      const context = selectedMessage?.compose_context?.reply || {};
                      const to = toRecipientEmails(context?.to);
                      await mailAPI.sendMessage({
                        to: to.length > 0 ? to : toRecipientEmails([selectedMessage.sender]),
                        cc: toRecipientEmails(context?.cc),
                        bcc: [],
                        subject: context?.subject || `Re: ${selectedMessage.subject || ''}`,
                        body: `<p>${String(quickReplyBody || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`,
                        is_html: true,
                        reply_to_message_id: selectedMessage.id,
                      });
                      setQuickReplyBody('');
                      await refreshList({ silent: true });
                      await refreshFolderSummary();
                    } catch (requestError) {
                      setError(requestError?.response?.data?.detail || 'Не удалось отправить быстрый ответ.');
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
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 2 }}>
          {selectedMessageAttachments.length > 0 ? (
            <Stack spacing={0.6} sx={{ mb: 1.2 }}>
              <Typography variant="caption" color="text.secondary">{`${selectedMessageAttachments.length} вложений • ${selectedMessageAttachmentTotalSize}`}</Typography>
              <Stack direction="row" spacing={0.45} flexWrap="wrap" useFlexGap>
                {selectedMessageAttachments.map((attachment, index) => (
                  <Chip
                    key={`${attachment?.id || attachment?.name || index}`}
                    icon={<AttachFileIcon sx={{ fontSize: '14px !important' }} />}
                    size="small"
                    variant="outlined"
                    label={attachment?.name || 'attachment'}
                    onClick={async () => {
                      const response = await mailAPI.downloadAttachment(selectedMessage.id, attachment?.download_token || attachment?.id);
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
                      setAttachmentPreview({ open: true, loading: false, error: '', filename, contentType, kind, objectUrl, textContent, textTruncated, tooLargeForPreview: blob.size > MAX_PREVIEW_FILE_BYTES, blob });
                    }}
                    onDelete={async () => {
                      const response = await mailAPI.downloadAttachment(selectedMessage.id, attachment?.download_token || attachment?.id);
                      const contentDisposition = response.headers['content-disposition'];
                      const filename = parseDownloadFilename(contentDisposition, attachment?.name || 'attachment.bin');
                      const blob = new Blob([response.data], { type: response.headers['content-type'] });
                      downloadBlobFile(blob, filename);
                    }}
                    deleteIcon={<DownloadIcon sx={{ fontSize: '16px !important' }} />}
                  />
                ))}
              </Stack>
            </Stack>
          ) : null}
          <Box sx={{ fontSize: '0.92rem', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: selectedMessageHtml || '<p style="color:#999">Нет содержимого</p>' }} />
        </Box>
      )}
    </>
  );
  const previewPanel = (
    <Paper
      variant="outlined"
      sx={{
        minHeight: 0,
        height: '100%',
        display: isMobile && !selectedMessage ? 'none' : 'flex',
        flexDirection: 'column',
        borderRadius: '14px',
        overflow: 'hidden',
      }}
    >
      {previewContent}
    </Paper>
  );
  const renderFolderRail = (
    <MailFolderRail
      folder={folder}
      folderTreeItems={effectiveFolderTreeItems}
      onFolderChange={(value) => {
        clearSelection({ allModes: true });
        setSelectedItems([]);
        setFolder(String(value || 'inbox'));
      }}
      viewMode={viewMode}
      onViewModeChange={(value) => {
        const nextMode = value === 'conversations' ? 'conversations' : 'messages';
        detailContextRef.current = '';
        setSelectedItems([]);
        setViewMode(nextMode);
        setSelectedId(String(selectedByMode?.[nextMode] || ''));
        setSelectedMessage(null);
        setSelectedConversation(null);
      }}
      unreadOnly={unreadOnly}
      onUnreadToggle={setUnreadOnly}
      hasAttachmentsOnly={hasAttachmentsOnly}
      onToggleHasAttachmentsOnly={() => setHasAttachmentsOnly((prev) => !prev)}
      filterDateFrom={filterDateFrom}
      filterDateTo={filterDateTo}
      onToggleToday={() => {
        const today = new Date().toISOString().slice(0, 10);
        const active = filterDateFrom === today && filterDateTo === today;
        setFilterDateFrom(active ? '' : today);
        setFilterDateTo(active ? '' : today);
      }}
      onToggleLast7Days={() => {
        const date = new Date();
        date.setDate(date.getDate() - 7);
        const from = date.toISOString().slice(0, 10);
        const active = filterDateFrom === from && !filterDateTo;
        setFilterDateFrom(active ? '' : from);
        setFilterDateTo('');
      }}
      onCreateFolderRequest={handleOpenCreateFolderDialog}
      onRenameFolderRequest={handleOpenRenameFolderDialog}
      onDeleteFolderRequest={handleDeleteFolder}
      onToggleFavorite={handleToggleFavoriteFolder}
      onDropMessagesToFolder={handleDropMessagesToFolder}
      showFavoritesFirst={Boolean(mailPreferences?.show_favorites_first)}
    />
  );
  const mainMailArea = readingPaneMode === 'right' || readingPaneMode === 'stacked' ? (
    <Box
      sx={{
        display: 'grid',
        gap: 1.2,
        gridTemplateColumns: { xs: '1fr', md: '220px minmax(300px, 360px) 1fr' },
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
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
        gap: 1.2,
        gridTemplateColumns: { xs: '1fr', md: '220px minmax(0, 1fr)' },
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {renderFolderRail}
      {readingPaneMode === 'bottom' ? (
        <Box sx={{ minHeight: 0, height: '100%', display: 'grid', gap: 1.2, gridTemplateRows: 'minmax(260px, 42%) minmax(0, 1fr)' }}>
          {listPanel}
          {previewPanel}
        </Box>
      ) : (
        listPanel
      )}
    </Box>
  );

  return (
    <MainLayout>
      <PageShell fullHeight>
        {error ? <Alert severity="error" onClose={() => setError('')} sx={{ borderRadius: '10px' }}>{error}</Alert> : null}
        {message ? <Alert severity="success" onClose={() => setMessage('')} sx={{ borderRadius: '10px' }}>{message}</Alert> : null}

        <MailToolbar
          mailboxEmail={mailboxInfo?.mailbox_email}
          search={search}
          onSearchChange={setSearch}
          onRefresh={() => { refreshList(); refreshFolderSummary(); refreshFolderTree(); }}
          onCompose={openCompose}
          onOpenAdvancedSearch={() => {
            setAdvancedFiltersDraft({ ...advancedFiltersApplied, q: search });
            setAdvancedSearchOpen(true);
          }}
          onOpenToolsMenu={(event) => setToolsAnchorEl(event.currentTarget)}
          loading={loading}
          searchInputRef={searchInputRef}
        />

        <MailToolsMenu
          anchorEl={toolsAnchorEl}
          open={Boolean(toolsAnchorEl)}
          onClose={() => setToolsAnchorEl(null)}
          onOpenItRequest={() => setItOpen(true)}
          onOpenSignatureEditor={openSignatureEditor}
          canManageUsers={canManageUsers}
          onOpenTemplates={() => setTemplatesOpen(true)}
          canToggleMailProfileMode={false}
          mailProfileModeLabel=""
          mailProfileToggleLabel=""
          onToggleMailProfileMode={undefined}
          onOpenShortcuts={() => setShortcutsOpen(true)}
          onOpenViewSettings={() => {
            setMailPreferencesDraft(mailPreferences);
            setMailPreferencesOpen(true);
          }}
          onMarkAllRead={handleMarkAllRead}
        />

        {mainMailArea}

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

        <MailShortcutHelpDialog
          open={shortcutsOpen}
          onClose={() => setShortcutsOpen(false)}
        />

        <MailViewSettingsDialog
          open={mailPreferencesOpen}
          value={mailPreferencesDraft}
          saving={mailPreferencesSaving}
          onClose={() => setMailPreferencesOpen(false)}
          onChange={(key, value) => setMailPreferencesDraft((prev) => ({ ...(prev || {}), [key]: value }))}
          onSave={handleSaveMailPreferences}
        />

        <MailHeadersDialog
          open={headersOpen}
          onClose={() => setHeadersOpen(false)}
          headers={headersLoading ? { items: [{ name: 'Статус', value: 'Загрузка заголовков...' }] } : messageHeaders}
        />

        <Dialog open={folderDialogOpen} onClose={() => setFolderDialogOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>{folderDialogMode === 'rename' ? 'Переименовать папку' : 'Новая папка'}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={1.2} sx={{ mt: 0.5 }}>
              {folderDialogMode === 'create' && folderDialogTarget ? (
                <Alert severity="info" sx={{ borderRadius: '10px' }}>
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
          <DialogActions>
            <Button onClick={() => setFolderDialogOpen(false)}>Отмена</Button>
            <Button variant="contained" onClick={handleSubmitFolderDialog} disabled={folderDialogSaving}>
              {folderDialogSaving ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </DialogActions>
        </Dialog>

        <MailAttachmentPreviewDialog
          attachmentPreview={attachmentPreview}
          onClose={() => setAttachmentPreview(createEmptyAttachmentPreview())}
          onDownload={() => { if (attachmentPreview?.blob) downloadBlobFile(attachmentPreview.blob, attachmentPreview.filename || 'attachment.bin'); }}
          formatFileSize={formatFileSize}
          maxPreviewFileBytes={MAX_PREVIEW_FILE_BYTES}
        />

        <MailSignatureDialog
          open={signatureOpen}
          onClose={() => setSignatureOpen(false)}
          signatureHtml={signatureHtml}
          onSignatureChange={setSignatureHtml}
          signatureSaving={signatureSaving}
          onClear={() => setSignatureHtml('')}
          onSave={handleSaveSignature}
        />

        <MailComposeDialog
          open={composeOpen}
          onClose={handleCloseCompose}
          dialogTitle={composeMode === 'reply' ? 'Ответ' : composeMode === 'reply_all' ? 'Ответ всем' : composeMode === 'forward' ? 'Пересылка' : composeMode === 'draft' ? 'Черновик' : 'Новое письмо'}
          composeMode={composeMode}
          draftSyncState={draftSyncState}
          draftSavedAt={draftSavedAt}
          composeError={composeError}
          onClearComposeError={() => setComposeError('')}
          formatFullDate={formatFullDate}
          composeDragActive={composeDragActive}
          onDragEnter={(event) => { event.preventDefault(); setComposeDragActive(true); }}
          onDragOver={(event) => { event.preventDefault(); setComposeDragActive(true); }}
          onDragLeave={(event) => { event.preventDefault(); setComposeDragActive(false); }}
          onDrop={(event) => { event.preventDefault(); setComposeDragActive(false); const files = Array.from(event.dataTransfer?.files || []); if (files.length > 0) setComposeFiles((prev) => [...prev, ...files]); }}
          onFileChange={(event) => { if (event.target.files && event.target.files.length > 0) setComposeFiles((prev) => [...prev, ...Array.from(event.target.files)]); event.target.value = ''; }}
          composeToOptions={composeToOptions}
          composeToLoading={composeToLoading}
          composeToValues={composeToValues}
          onComposeToValuesChange={setComposeToValues}
          onComposeToSearchChange={setComposeToSearch}
          composeFieldErrors={composeFieldErrors}
          composeCcValues={composeCcValues}
          onComposeCcValuesChange={setComposeCcValues}
          composeBccValues={composeBccValues}
          onComposeBccValuesChange={setComposeBccValues}
          composeSubject={composeSubject}
          onComposeSubjectChange={setComposeSubject}
          composeBody={composeBody}
          onComposeBodyChange={setComposeBody}
          composeDraftAttachments={composeDraftAttachments}
          composeFiles={composeFiles}
          composeWarnings={composeWarnings}
          onDismissComposeWarning={(warningId) => setDismissedComposeWarnings((prev) => [...new Set([...(prev || []), String(warningId || '')])])}
          onComposePasteFiles={(files) => {
            const incoming = Array.isArray(files) ? files : Array.from(files || []);
            if (incoming.length > 0) setComposeFiles((prev) => [...prev, ...incoming]);
          }}
          onSendComposeShortcut={handleSendCompose}
          formatFileSize={formatFileSize}
          sumFilesSize={sumFilesSize}
          sumAttachmentSize={sumAttachmentSize}
          onRemoveDraftAttachment={(id) => setComposeDraftAttachments((prev) => prev.filter((item) => String(item.id) !== String(id)))}
          onRemoveComposeFile={(indexToRemove) => setComposeFiles((prev) => prev.filter((_, index) => index !== indexToRemove))}
          composeSending={composeSending}
          composeUploadProgress={composeUploadProgress}
          onCancelComposeUpload={() => { if (composeUploadAbortRef.current) composeUploadAbortRef.current.abort(); }}
          onClearComposeDraft={clearComposeDraft}
          onSendCompose={handleSendCompose}
          layoutMode={isMobile ? 'mobile' : 'desktop'}
        />

        <Dialog open={itOpen} onClose={() => setItOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: '12px' } }}>
          <DialogTitle sx={{ fontWeight: 700 }}>Заявка в IT</DialogTitle>
          <DialogContent dividers>
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
          <DialogActions sx={{ px: 3, pb: 2 }}>
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
                  setError(requestError?.response?.data?.detail || 'Не удалось отправить IT-заявку.');
                }
              }}
              sx={{ textTransform: 'none', borderRadius: '8px', fontWeight: 600 }}
            >
              Отправить
            </Button>
          </DialogActions>
        </Dialog>

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
      </PageShell>
    </MainLayout>
  );
}

export default Mail;
