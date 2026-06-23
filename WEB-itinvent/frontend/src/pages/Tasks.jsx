import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  Drawer,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AssignmentIcon from '@mui/icons-material/Assignment';
import EditIcon from '@mui/icons-material/Edit';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DownloadIcon from '@mui/icons-material/Download';
import FlagIcon from '@mui/icons-material/Flag';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import SupervisorAccountOutlinedIcon from '@mui/icons-material/SupervisorAccountOutlined';
import TuneOutlinedIcon from '@mui/icons-material/TuneOutlined';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import MainLayout from '../components/layout/MainLayout';
import ShellNotificationsButton from '../components/layout/ShellNotificationsButton';
import PageShell from '../components/layout/PageShell';
import { hubAPI } from '../api/client';
import { departmentsAPI } from '../api/departments';
import OverflowMenu from '../components/common/OverflowMenu';
import { useAuth } from '../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import MarkdownRenderer from '../components/hub/MarkdownRenderer';
import MarkdownEditor from '../components/hub/MarkdownEditor';
import TaskChecklist from '../components/hub/TaskChecklist';
import {
  TaskActivityTabs,
  TaskContextSidebar,
  TaskDetailHeader,
  TaskMobileChecklistScreen,
  TaskMobileDetailScreen,
  TaskPrimaryActions,
  normalizeTaskDetailTab,
} from '../components/hub/TaskUi';
import TaskRoleScopeSwitch from '../components/hub/TaskRoleScopeSwitch';
import {
  canOpenTransferActUpload,
  getTransferActReminderLabel,
  getTransferActUploadUrl,
  isTransferActUploadTask,
} from '../lib/hubTaskIntegrations';
import { CHAT_FEATURE_ENABLED, TASK_DISCUSSION_CHAT_ENABLED } from '../lib/chatFeature';
import { invalidateSWRCacheByPrefix } from '../lib/swrCache';
import {
  TASK_MODE_OPTIONS,
  buildCalendarDays,
  buildCreateDuePresets,
  buildDeadlineBuckets,
  buildGanttRows,
  buildMobileTaskActionState,
  buildMobileTaskFeed,
  formatCreateDueLabel,
  normalizeTaskMode,
} from './tasksViewModel';
import { buildOfficeUiTokens, getAppShellMobileFabBottomOffset, getOfficeDialogPaperSx, getOfficeEmptyStateSx, getOfficeHeaderBandSx, getOfficeMetricBlockSx, getOfficePanelSx, getOfficeSubtlePanelSx } from '../theme/officeUiTokens';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';

const KANBAN_COLUMNS = [
  { key: 'new', label: 'Новое', color: '#2563eb' },
  { key: 'in_progress', label: 'В работе', color: '#d97706' },
  { key: 'review', label: 'На проверке', color: '#7c3aed' },
  { key: 'done', label: 'Готово', color: '#059669' },
];

const priorityOptions = [
  { value: 'low', label: 'Низкий', dotColor: '#64748b' },
  { value: 'normal', label: 'Обычный', dotColor: '#2563eb' },
  { value: 'high', label: 'Высокий', dotColor: '#d97706' },
  { value: 'urgent', label: 'Срочный', dotColor: '#dc2626' },
];

const taskVisibilityOptions = [
  { value: 'private', label: 'Приватная' },
  { value: 'department', label: 'Отдел' },
  { value: 'department_managers', label: 'Начальники отдела' },
];

const dueStateOptions = [
  { value: '', label: 'Любой срок' },
  { value: 'overdue', label: 'Просрочено' },
  { value: 'today', label: 'На сегодня' },
  { value: 'upcoming', label: 'Предстоящие' },
  { value: 'none', label: 'Без срока' },
];

const statusOptions = [
  { value: '', label: 'Все статусы' },
  { value: 'new', label: 'Новое' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
  { value: 'done', label: 'Готово' },
];

const focusOptions = [
  { value: 'all', label: 'Все' },
  { value: 'review', label: 'К проверке' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'comments', label: 'С новыми комментариями' },
];

const mobileStatusOptions = [
  { value: '', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'in_progress', label: 'В работе' },
  { value: 'review', label: 'На проверке' },
  { value: 'done', label: 'Готово' },
];

const statusMeta = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'new') return { label: 'Новое', color: '#2563eb', bg: 'rgba(37,99,235,0.14)' };
  if (value === 'in_progress') return { label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.14)' };
  if (value === 'review') return { label: 'На проверке', color: '#7c3aed', bg: 'rgba(124,58,237,0.14)' };
  if (value === 'done') return { label: 'Готово', color: '#059669', bg: 'rgba(5,150,105,0.14)' };
  return { label: value || '-', color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
};

const priorityMeta = (priority) => {
  const found = priorityOptions.find((item) => item.value === String(priority || '').toLowerCase());
  return found || priorityOptions[1];
};

const formatDateTime = (value) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatShortDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

const formatFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (size <= 0) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getInitials = (name) => {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
};

const getTaskCommentPreview = (task) => {
  const preview = String(task?.latest_comment_preview || '').trim();
  if (!preview) return '';
  const author = String(task?.latest_comment_full_name || task?.latest_comment_username || '').trim();
  return author ? `${author}: ${preview}` : preview;
};

const getTaskUserLabel = (user) => {
  const fullName = String(user?.full_name || '').trim();
  const username = String(user?.username || '').trim();
  return fullName || username || 'Пользователь';
};

const getDepartmentLabel = (department) => String(department?.name || department?.department_name || department?.id || '').trim();

const findDepartmentById = (options, value) => (
  (Array.isArray(options) ? options : []).find((item) => String(item?.id || '') === String(value || '')) || null
);

const getTaskUserSearchText = (user) => (
  [
    String(user?.full_name || '').trim(),
    String(user?.username || '').trim(),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
);

const filterTaskUserOptions = (options, state) => {
  const query = String(state?.inputValue || '').trim().toLowerCase();
  if (!query) return options;
  return options.filter((option) => getTaskUserSearchText(option).includes(query));
};

const findTaskUserById = (options, value) => (
  (Array.isArray(options) ? options : []).find((item) => String(item?.id || '') === String(value || '')) || null
);

const formatHubTaskError = (error, fallback = 'Ошибка создания задачи') => {
  const detail = String(error?.response?.data?.detail || error?.message || '').trim();
  if (!detail) return fallback;
  const normalized = detail.toLowerCase();
  if (normalized.includes('task cannot be assigned in the selected department')) {
    return 'Нельзя назначить задачу в выбранном отделе. Выберите исполнителя из своего отдела или укажите его отдел.';
  }
  if (normalized.includes('task cannot be moved to the selected department')) {
    return 'Нельзя перенести задачу в выбранный отдел.';
  }
  return detail;
};

const areSameTaskUsers = (option, value) => String(option?.id || '') === String(value?.id || '');

const TASK_MODE_STORAGE_KEY = 'hub.tasks.taskMode';
const TASK_PERSONAL_ROLE_STORAGE_KEY = 'hub.tasks.personalRole';

const safeReadStoredPersonalRole = () => {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    const value = String(window.localStorage.getItem(TASK_PERSONAL_ROLE_STORAGE_KEY) || '').trim().toLowerCase();
    if (value === 'creator') return 'creator';
    if (value === 'assignee') return 'assignee';
    return '';
  } catch {
    return '';
  }
};

const safeWriteStoredPersonalRole = (value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = value === 'creator' ? 'creator' : 'assignee';
  try {
    window.localStorage.setItem(TASK_PERSONAL_ROLE_STORAGE_KEY, normalized);
  } catch {
    // localStorage can be unavailable in private or locked-down browsers.
  }
};

const resolveInitialViewMode = (search = '', canManageAll = false) => {
  const fromUrl = readTaskFilters(search).viewMode;
  if (fromUrl && ['all', 'assignee', 'creator', 'controller', 'department'].includes(fromUrl)) {
    return fromUrl;
  }
  if (canManageAll) return 'all';
  return safeReadStoredPersonalRole() || 'assignee';
};

const safeReadStoredTaskMode = () => {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  try {
    return normalizeTaskMode(window.localStorage.getItem(TASK_MODE_STORAGE_KEY) || '', '');
  } catch {
    return '';
  }
};

const safeWriteStoredTaskMode = (value) => {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const normalized = normalizeTaskMode(value || '', 'list') || 'list';
  try {
    window.localStorage.setItem(TASK_MODE_STORAGE_KEY, normalized);
  } catch {
    // localStorage can be unavailable in private or locked-down browsers.
  }
};

const hasTaskModeQueryParam = (search = '') => {
  const params = new URLSearchParams(search || '');
  return params.has('task_mode');
};

const readTaskFilters = (search = '') => {
  const params = new URLSearchParams(search || '');
  return {
    taskMode: normalizeTaskMode(params.get('task_mode') || '', ''),
    viewMode: String(params.get('task_view') || ''),
    q: String(params.get('task_q') || ''),
    status: String(params.get('task_status') || ''),
    dueState: String(params.get('task_due') || ''),
    assigneeFilter: String(params.get('task_assignee') || ''),
    controllerFilter: String(params.get('task_controller') || ''),
    departmentFilter: String(params.get('task_department') || ''),
    hasAttachments: params.get('task_files') === '1',
    unreadCommentsOnly: params.get('task_unread_comments') === '1',
    focusMode: String(params.get('task_focus') || 'all') || 'all',
  };
};

const toDateTimeInput = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
};

const toDateInput = (value) => {
  if (!value) return '';
  const parsed = new Date(String(value).length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 10);
};

const hideMobileScrollbarSx = {
  scrollbarWidth: 'none',
  msOverflowStyle: 'none',
  '&::-webkit-scrollbar': {
    display: 'none',
  },
};

const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;

const parseFilename = (contentDisposition) => {
  if (!contentDisposition) return null;
  const matched = /filename="?([^"]+)"?/i.exec(String(contentDisposition));
  return matched?.[1] || null;
};

const analyticsPresetOptions = [
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
  { value: 'custom', label: 'Свои даты' },
];

const analyticsDateBasisOptions = [
  { value: 'protocol_date', label: 'По дате постановки' },
  { value: 'completed_at', label: 'По завершению' },
  { value: 'due_at', label: 'По сроку' },
];

const EMPTY_ANALYTICS_PAYLOAD = {
  summary: {},
  by_participant: [],
  by_project: [],
  by_object: [],
  status_breakdown: [],
  trend: { granularity: 'day', items: [] },
};

const analyticsStatusColors = {
  new: '#2563eb',
  in_progress: '#d97706',
  review: '#7c3aed',
  done: '#059669',
  overdue: '#dc2626',
  open: '#2563eb',
};

const buildAnalyticsRangeFromPreset = (preset) => {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  switch (preset) {
    case '7d':
      start.setDate(start.getDate() - 6);
      break;
    case '30d':
      start.setDate(start.getDate() - 29);
      break;
    case 'week': {
      const day = start.getDay() || 7;
      start.setDate(start.getDate() - day + 1);
      break;
    }
    case 'month':
      start.setDate(1);
      break;
    case 'quarter': {
      const quarterMonth = Math.floor(start.getMonth() / 3) * 3;
      start.setMonth(quarterMonth, 1);
      break;
    }
    case 'year':
      start.setMonth(0, 1);
      break;
    default:
      return { start_date: '', end_date: '' };
  }
  return {
    start_date: toDateInput(start.toISOString()),
    end_date: toDateInput(end.toISOString()),
  };
};

const createEmptyProjectDraft = () => ({
  name: '',
  code: '',
  description: '',
  is_active: true,
});

const createEmptyObjectDraft = (projectId = '') => ({
  project_id: String(projectId || ''),
  name: '',
  code: '',
  description: '',
  is_active: true,
});

const createOptionalSectionOptions = [
  { key: 'priority', label: 'В приоритете', icon: FlagIcon },
  { key: 'files', label: 'Файлы', icon: AttachFileIcon },
  { key: 'checklist', label: 'Чек-листы', icon: ChecklistOutlinedIcon },
  { key: 'project', label: 'Проект', icon: FolderOpenOutlinedIcon },
  { key: 'controller', label: 'Контролёр', icon: SupervisorAccountOutlinedIcon },
  { key: 'advanced', label: 'Полная форма', icon: TuneOutlinedIcon },
];

const createEmptyOptionalSections = () => ({
  priority: false,
  files: false,
  checklist: false,
  schedule: false,
  project: false,
  controller: false,
  access: false,
  advanced: false,
});

const createInitialTaskDraft = (projectId = '') => ({
  title: '',
  description: '',
  assignee_user_ids: [],
  controller_user_id: '',
  project_id: String(projectId || ''),
  object_id: '',
  protocol_date: toDateInput(new Date().toISOString()),
  due_at: '',
  priority: 'normal',
  department_id: '',
  visibility_scope: 'private',
});

const getFileIdentity = (file) => (
  `${String(file?.name || '')}:${Number(file?.size || 0)}:${Number(file?.lastModified || 0)}`
);

const getCreatedTaskItems = (response) => {
  if (Array.isArray(response?.items)) return response.items;
  if (response?.id) return [response];
  return [];
};

const createChecklistItemId = () => (
  globalThis.crypto?.randomUUID?.() || `checklist-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

const createEmptyChecklistItem = () => ({
  id: createChecklistItemId(),
  text: '',
  done: false,
});

const normalizeChecklistItems = (items) => (
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: String(item?.id || createChecklistItemId()),
      text: String(item?.text || '').trim(),
      done: Boolean(item?.done),
    }))
    .filter((item) => item.text.length > 0)
);

const clampPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, numeric));
};

const formatMetricCountPercent = (count, percent) => `${Number(count || 0)} / ${formatPercent(percent)}`;

const buildAnalyticsTableColumns = () => ([
  { key: 'total', label: 'Всего' },
  { key: 'open', label: 'Открыто' },
  { key: 'in_progress', label: 'В работе' },
  { key: 'review', label: 'На проверке' },
  { key: 'done', label: 'Выполнено' },
  { key: 'done_on_time', label: 'В срок' },
  { key: 'done_without_due', label: 'Без срока' },
  { key: 'overdue', label: 'Просрочено' },
]);

const LocalTaskDescriptionField = memo(function LocalTaskDescriptionField({
  initialValue = '',
  onDraftChange,
  resetKey = '',
  ...props
}) {
  const [value, setValue] = useState(() => String(initialValue || ''));

  useEffect(() => {
    const nextValue = String(initialValue || '');
    setValue(nextValue);
    onDraftChange?.(nextValue);
  }, [initialValue, onDraftChange, resetKey]);

  const handleChange = useCallback((event) => {
    const nextValue = event.target.value;
    setValue(nextValue);
    onDraftChange?.(nextValue);
  }, [onDraftChange]);

  return (
    <TextField
      {...props}
      value={value}
      onChange={handleChange}
    />
  );
});

const escapeEditorHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const applyInlineMarkdownToHtml = (value) => {
  let nextValue = escapeEditorHtml(value);
  nextValue = nextValue.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  nextValue = nextValue.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  nextValue = nextValue.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return nextValue;
};

const markdownToEditorHtml = (value) => {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const lines = text.split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    const numberMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bulletMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*]\s+(.*)$/);
        if (!match) break;
        items.push(`<li>${applyInlineMarkdownToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (numberMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+\.\s+(.*)$/);
        if (!match) break;
        items.push(`<li>${applyInlineMarkdownToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    blocks.push(line.trim() ? `<div>${applyInlineMarkdownToHtml(line)}</div>` : '<div><br></div>');
    index += 1;
  }

  return blocks.join('');
};

const editorNodeToMarkdown = (node) => {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tagName = String(node.tagName || '').toLowerCase();
  if (tagName === 'br') return '\n';

  const childText = () => Array.from(node.childNodes || []).map(editorNodeToMarkdown).join('');
  if (tagName === 'strong' || tagName === 'b') return `**${childText()}**`;
  if (tagName === 'em' || tagName === 'i') return `*${childText()}*`;
  if (tagName === 's' || tagName === 'strike' || tagName === 'del') return `~~${childText()}~~`;
  if (tagName === 'li') return childText().trim();
  if (tagName === 'ul') {
    return Array.from(node.children || [])
      .filter((child) => String(child.tagName || '').toLowerCase() === 'li')
      .map((child) => `- ${editorNodeToMarkdown(child).trim()}`)
      .join('\n');
  }
  if (tagName === 'ol') {
    return Array.from(node.children || [])
      .filter((child) => String(child.tagName || '').toLowerCase() === 'li')
      .map((child, index) => `${index + 1}. ${editorNodeToMarkdown(child).trim()}`)
      .join('\n');
  }
  if (['div', 'p'].includes(tagName)) return childText();
  return childText();
};

const editorHtmlToMarkdown = (html) => {
  if (typeof document === 'undefined') return '';
  const container = document.createElement('div');
  container.innerHTML = String(html || '');
  const parts = [];
  let inlineBuffer = '';
  Array.from(container.childNodes || []).forEach((node) => {
    const tagName = node.nodeType === Node.ELEMENT_NODE ? String(node.tagName || '').toLowerCase() : '';
    const isBlock = ['div', 'p', 'ul', 'ol'].includes(tagName);
    const markdown = editorNodeToMarkdown(node);
    if (isBlock) {
      if (inlineBuffer.trim()) {
        parts.push(inlineBuffer.trim());
        inlineBuffer = '';
      }
      if (markdown.trim()) parts.push(markdown.trim());
      return;
    }
    inlineBuffer += markdown;
  });
  if (inlineBuffer.trim()) parts.push(inlineBuffer.trim());
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const stripMarkdownForPreview = (value) => String(value || '')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/~~([^~]+)~~/g, '$1')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
  .replace(/^\s*[-*]\s+/gm, '')
  .replace(/^\s*\d+\.\s+/gm, '')
  .trim();

const focusRichEditor = (editor) => {
  if (!editor) return;
  editor.focus();
};

const MobileCreateDescriptionEditor = memo(function MobileCreateDescriptionEditor({
  initialValue = '',
  onDraftChange,
  onDone,
  onAddFiles,
  resetKey = '',
  ui,
  theme,
}) {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = markdownToEditorHtml(initialValue);
    onDraftChange?.(editorHtmlToMarkdown(editor.innerHTML));
    window.requestAnimationFrame(() => focusRichEditor(editor));
  }, [initialValue, onDraftChange, resetKey]);

  const syncDraft = useCallback(() => {
    const editor = editorRef.current;
    onDraftChange?.(editorHtmlToMarkdown(editor?.innerHTML || ''));
  }, [onDraftChange]);

  const handleFormat = useCallback((type) => {
    const commandByType = {
      bold: 'bold',
      italic: 'italic',
      strike: 'strikeThrough',
      bullet: 'insertUnorderedList',
      numbered: 'insertOrderedList',
      mention: 'insertText',
    };
    const command = commandByType[type];
    if (!command || typeof document === 'undefined' || typeof document.execCommand !== 'function') return;
    focusRichEditor(editorRef.current);
    document.execCommand(command, false, type === 'mention' ? '@' : null);
    syncDraft();
  }, [syncDraft]);

  const handleOpenFiles = useCallback(() => {
    syncDraft();
    fileInputRef.current?.click();
  }, [syncDraft]);

  const handleFileChange = useCallback((event) => {
    syncDraft();
    onAddFiles?.(event.target.files);
    event.target.value = '';
    window.requestAnimationFrame(() => {
      focusRichEditor(editorRef.current);
    });
  }, [onAddFiles, syncDraft]);

  const toolbarItems = [
    { key: 'bold', label: 'Жирный', icon: <FormatBoldIcon /> },
    { key: 'italic', label: 'Курсив', icon: <FormatItalicIcon /> },
    { key: 'strike', label: 'Зачеркнуть', icon: <StrikethroughSIcon /> },
    { key: 'bullet', label: 'Список', icon: <FormatListBulletedIcon /> },
    { key: 'numbered', label: 'Нумерация', icon: <FormatListNumberedIcon /> },
    { key: 'mention', label: 'Упоминание', icon: <AlternateEmailIcon /> },
  ];

  return (
    <Stack spacing={0} sx={{ height: '100%', minHeight: 0 }}>
      <Box
        ref={editorRef}
        component="div"
        contentEditable
        suppressContentEditableWarning
        data-testid="create-description-mobile-input"
        aria-label="Описание задачи"
        role="textbox"
        tabIndex={0}
        data-placeholder="Опишите задачу, детали и ожидаемый результат"
        onInput={syncDraft}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          outline: 'none',
          color: ui.text,
          fontSize: '1.02rem',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          ...hideMobileScrollbarSx,
          '&:empty::before': {
            content: 'attr(data-placeholder)',
            color: ui.mutedText,
            opacity: 0.75,
            pointerEvents: 'none',
          },
          '& ul, & ol': { pl: 2.2, my: 0.65 },
          '& li': { my: 0.25 },
          '& b, & strong': { fontWeight: 900 },
          '& i, & em': { fontStyle: 'italic' },
        }}
      />

      <Box
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 0.55,
          pt: 0.9,
          pb: 'calc(0.35rem + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid',
          borderColor: alpha(ui.borderSoft, 0.75),
        }}
      >
        <Box
          data-testid="create-description-toolbar-scroll"
          sx={{
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            ...hideMobileScrollbarSx,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minWidth: 'max-content' }}>
            {toolbarItems.map((item) => (
              <IconButton
                key={item.key}
                size="small"
                data-testid={`create-description-format-${item.key}`}
                aria-label={item.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleFormat(item.key)}
                sx={{ width: 32, height: 32, color: ui.mutedText, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: 19 } }}
              >
                {item.icon}
              </IconButton>
            ))}
            <IconButton
              size="small"
              data-testid="create-description-open-files"
              aria-label="Прикрепить файл"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleOpenFiles}
              sx={{ width: 32, height: 32, color: ui.mutedText, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: 19 } }}
            >
              <AttachFileIcon />
            </IconButton>
            <input
              ref={fileInputRef}
              data-testid="create-description-file-input"
              type="file"
              hidden
              multiple
              onChange={handleFileChange}
            />
          </Stack>
        </Box>
        <Button
          variant="contained"
          data-testid="create-description-mobile-done"
          onClick={onDone}
          aria-label="Готово"
          sx={{
            minWidth: 44,
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: '14px',
            px: 0,
            boxShadow: 'none',
            bgcolor: theme.palette.primary.main,
            '&:hover': { bgcolor: theme.palette.primary.dark || theme.palette.primary.main },
          }}
        >
          <CheckIcon />
        </Button>
      </Box>
    </Stack>
  );
});

const MobileCreateAssigneePicker = memo(function MobileCreateAssigneePicker({
  options = [],
  selectedIds = [],
  onChange,
  onClear,
  onDone,
  ui,
  theme,
}) {
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set((Array.isArray(selectedIds) ? selectedIds : []).map((item) => String(item || ''))), [selectedIds]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const source = Array.isArray(options) ? options : [];
    if (!normalizedQuery) return source;
    return source.filter((item) => getTaskUserSearchText(item).includes(normalizedQuery));
  }, [options, query]);

  const handleToggle = useCallback((userItem) => {
    const id = String(userItem?.id || '');
    if (!id) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange?.([...next]);
  }, [onChange, selectedSet]);

  return (
    <Stack spacing={1} sx={{ height: '100%', minHeight: 0 }}>
      <TextField
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
        fullWidth
        size="small"
        placeholder="Фамилия или логин"
        inputProps={{ 'data-testid': 'create-assignees-mobile-search', 'aria-label': 'Поиск исполнителей' }}
        InputProps={{
          startAdornment: <SearchIcon sx={{ fontSize: 18, color: ui.subtleText, mr: 0.75 }} />,
        }}
        sx={{
          flexShrink: 0,
          '& .MuiOutlinedInput-root': {
            borderRadius: '14px',
            bgcolor: ui.actionBg,
            '& fieldset': { borderColor: 'transparent' },
            '&:hover fieldset': { borderColor: 'transparent' },
            '&.Mui-focused fieldset': { borderColor: 'transparent' },
          },
        }}
      />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', ...hideMobileScrollbarSx }}>
        <Stack spacing={0.25}>
          {filteredOptions.map((item) => {
            const id = String(item?.id || '');
            const selected = selectedSet.has(id);
            const label = getTaskUserLabel(item);
            return (
              <Button
                key={id || label}
                type="button"
                data-testid={`create-assignee-mobile-option-${id}`}
                onClick={() => handleToggle(item)}
                sx={{
                  minHeight: 58,
                  justifyContent: 'stretch',
                  textTransform: 'none',
                  borderRadius: '14px',
                  px: 0.8,
                  color: ui.text,
                  bgcolor: selected ? alpha(theme.palette.primary.main, 0.13) : 'transparent',
                  '&:hover': { bgcolor: selected ? alpha(theme.palette.primary.main, 0.17) : ui.actionHover },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%', minWidth: 0 }}>
                  <Avatar sx={{ width: 34, height: 34, bgcolor: selected ? theme.palette.primary.main : ui.actionBg, color: selected ? theme.palette.primary.contrastText : ui.text, fontSize: '0.78rem', fontWeight: 900 }}>
                    {getInitials(label)}
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1, textAlign: 'left' }}>
                    <Typography sx={{ fontWeight: 900, fontSize: '0.94rem', lineHeight: 1.2 }} noWrap>
                      {label}
                    </Typography>
                    {item?.username ? (
                      <Typography variant="caption" sx={{ color: ui.subtleText }} noWrap>
                        @{item.username}
                      </Typography>
                    ) : null}
                  </Box>
                  <Checkbox checked={selected} tabIndex={-1} sx={{ p: 0.3 }} />
                </Stack>
              </Button>
            );
          })}
          {filteredOptions.length === 0 ? (
            <Typography variant="body2" sx={{ color: ui.mutedText, py: 2, textAlign: 'center' }}>
              Ничего не найдено
            </Typography>
          ) : null}
        </Stack>
      </Box>

      <Stack direction="row" spacing={1} sx={{ flexShrink: 0, pt: 0.8, pb: 'calc(0.35rem + env(safe-area-inset-bottom, 0px))' }}>
        <Button
          fullWidth
          variant="outlined"
          data-testid="create-assignees-mobile-clear"
          onClick={onClear}
          disabled={selectedSet.size === 0}
          sx={{ textTransform: 'none', fontWeight: 850, borderRadius: '12px' }}
        >
          Очистить
        </Button>
        <Button
          fullWidth
          variant="contained"
          data-testid="create-assignees-mobile-done"
          onClick={onDone}
          sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}
        >
          Готово
        </Button>
      </Stack>
    </Stack>
  );
});

const LocalTaskMarkdownEditor = memo(function LocalTaskMarkdownEditor({
  initialValue = '',
  onDraftChange,
  resetKey = '',
  ...props
}) {
  const [value, setValue] = useState(() => String(initialValue || ''));

  useEffect(() => {
    const nextValue = String(initialValue || '');
    setValue(nextValue);
    onDraftChange?.(nextValue);
  }, [initialValue, onDraftChange, resetKey]);

  const handleChange = useCallback((nextValue) => {
    const normalizedValue = String(nextValue || '');
    setValue(normalizedValue);
    onDraftChange?.(normalizedValue);
  }, [onDraftChange]);

  return (
    <MarkdownEditor
      {...props}
      value={value}
      onChange={handleChange}
    />
  );
});

function Tasks() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isAnalyticsMobile = isMobile;
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const analyticsAccentColor = theme?.palette?.primary?.main || '#2563eb';
  const analyticsGridStroke = ui?.borderSoft || 'rgba(148,163,184,0.22)';
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission, hasAnyPermission } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const canManageAllTasks = isAdmin || hasPermission('tasks.manage_all');
  const canCreateTasks = hasAnyPermission(['tasks.create', 'tasks.write']);
  const canWriteTasks = hasPermission('tasks.write');
  const canReviewTasks = hasPermission('tasks.review');
  const taskDiscussionChatEnabled = CHAT_FEATURE_ENABLED && TASK_DISCUSSION_CHAT_ENABLED;
  const canUseCreatorTab = true;
  const canUseControllerTab = canReviewTasks;
  const initialFilters = readTaskFilters(location.search);
  const initialPageMode = initialFilters.taskMode || (
    hasTaskModeQueryParam(location.search) ? '' : safeReadStoredTaskMode()
  ) || 'list';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tasksPayload, setTasksPayload] = useState({ items: [], total: 0 });
  const [pageMode, setPageMode] = useState(initialPageMode);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [taskProjects, setTaskProjects] = useState([]);
  const [taskObjects, setTaskObjects] = useState([]);
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [taxonomySaving, setTaxonomySaving] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState('');
  const [editingObjectId, setEditingObjectId] = useState('');
  const [projectDraft, setProjectDraft] = useState(createEmptyProjectDraft);
  const [objectDraft, setObjectDraft] = useState(createEmptyObjectDraft);
  const [analyticsDesktopFiltersVisible, setAnalyticsDesktopFiltersVisible] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsExporting, setAnalyticsExporting] = useState(false);
  const [analyticsPayload, setAnalyticsPayload] = useState(EMPTY_ANALYTICS_PAYLOAD);
  const [analyticsFilters, setAnalyticsFilters] = useState(() => ({
    preset: '30d',
    ...buildAnalyticsRangeFromPreset('30d'),
    date_basis: 'protocol_date',
    project_ids: [],
    object_ids: [],
    participant_user_id: '',
  }));

  const [viewMode, setViewMode] = useState(() => resolveInitialViewMode(location.search, canManageAllTasks));
  const [q, setQ] = useState(initialFilters.q);
  const [debouncedQ, setDebouncedQ] = useState(initialFilters.q);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [dueState, setDueState] = useState(initialFilters.dueState);
  const [assigneeFilter, setAssigneeFilter] = useState(initialFilters.assigneeFilter);
  const [controllerFilter, setControllerFilter] = useState(initialFilters.controllerFilter);
  const [departmentFilter, setDepartmentFilter] = useState(initialFilters.departmentFilter);
  const [hasAttachments, setHasAttachments] = useState(initialFilters.hasAttachments);
  const [unreadCommentsOnly, setUnreadCommentsOnly] = useState(initialFilters.unreadCommentsOnly);
  const [focusMode, setFocusMode] = useState(initialFilters.focusMode || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [mobileBoardFiltersOpen, setMobileBoardFiltersOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(() => Boolean(initialFilters.q));

  const [assignees, setAssignees] = useState([]);
  const [controllers, setControllers] = useState([]);
  const [departments, setDepartments] = useState([]);

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsTask, setDetailsTask] = useState(null);
  const [detailsComments, setDetailsComments] = useState([]);
  const [detailsStatusLog, setDetailsStatusLog] = useState([]);
  const [detailsCommentBody, setDetailsCommentBody] = useState('');
  const [detailsCommentSaving, setDetailsCommentSaving] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createDueSheetOpen, setCreateDueSheetOpen] = useState(false);
  const [createDueCustomOpen, setCreateDueCustomOpen] = useState(false);
  const [createMobileSheet, setCreateMobileSheet] = useState('');
  const [createDescriptionPreview, setCreateDescriptionPreview] = useState('');
  const [createOptionalSections, setCreateOptionalSections] = useState(createEmptyOptionalSections);
  const [createData, setCreateData] = useState(() => createInitialTaskDraft());
  const [createFiles, setCreateFiles] = useState([]);
  const [createChecklistItems, setCreateChecklistItems] = useState([]);
  const [createProjectName, setCreateProjectName] = useState('');
  const [createProjectSaving, setCreateProjectSaving] = useState(false);

  const [submitTask, setSubmitTask] = useState(null);
  const [submitComment, setSubmitComment] = useState('');
  const [submitFile, setSubmitFile] = useState(null);
  const [submitSaving, setSubmitSaving] = useState(false);

  const [reviewTask, setReviewTask] = useState(null);
  const [reviewComment, setReviewComment] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editData, setEditData] = useState({
    id: '',
    title: '',
    description: '',
    due_at: '',
    protocol_date: '',
    priority: 'normal',
    project_id: '',
    object_id: '',
    assignee_user_id: '',
    controller_user_id: '',
    department_id: '',
    visibility_scope: 'private',
  });

  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [discussionOpening, setDiscussionOpening] = useState(false);

  const searchInputRef = useRef(null);
  const createDescriptionRef = useRef('');
  const editDescriptionRef = useRef('');
  const taskDetailHistorySeededRef = useRef(false);
  const taskDetailHistoryPushedRef = useRef(false);

  const handleCreateDescriptionDraftChange = useCallback((value) => {
    createDescriptionRef.current = String(value || '');
  }, []);

  const handleEditDescriptionDraftChange = useCallback((value) => {
    editDescriptionRef.current = String(value || '');
  }, []);

  const updateSearch = useCallback((mutate, { replace = true } = {}) => {
    const params = new URLSearchParams(location.search || '');
    mutate(params);
    const nextSearch = params.toString();
    const currentSearch = String(location.search || '').replace(/^\?/, '');
    if (nextSearch === currentSearch) return;
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace },
    );
  }, [location.pathname, location.search, navigate]);

  const selectedTaskId = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task') || '').trim();
  }, [location.search]);

  const selectedTaskTab = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return normalizeTaskDetailTab(params.get('task_tab'));
  }, [location.search]);

  const selectedMobileTaskView = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task_mobile_view') || '').trim() === 'checklist' ? 'checklist' : 'details';
  }, [location.search]);

  const detailsOpen = Boolean(selectedTaskId);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(String(q || '').trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    if (!mobileSearchOpen || !isMobile) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus?.();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [isMobile, mobileSearchOpen]);

  useEffect(() => {
    const next = readTaskFilters(location.search);
    const fallbackView = canManageAllTasks ? 'all' : (safeReadStoredPersonalRole() || 'assignee');
    let nextView = next.viewMode || fallbackView;
    if (nextView === 'all' && !canManageAllTasks) nextView = fallbackView;
    if (nextView === 'controller' && !canUseControllerTab) nextView = fallbackView;
    if (!['all', 'assignee', 'creator', 'controller', 'department'].includes(nextView)) nextView = fallbackView;
    const nextPageMode = next.taskMode || (
      hasTaskModeQueryParam(location.search) ? '' : safeReadStoredTaskMode()
    ) || 'list';

    setPageMode((prev) => (prev === nextPageMode ? prev : nextPageMode));
    setViewMode((prev) => (prev === nextView ? prev : nextView));
    setQ((prev) => (prev === next.q ? prev : next.q));
    setStatusFilter((prev) => (prev === next.status ? prev : next.status));
    setDueState((prev) => (prev === next.dueState ? prev : next.dueState));
    setAssigneeFilter((prev) => (prev === next.assigneeFilter ? prev : next.assigneeFilter));
    setControllerFilter((prev) => (prev === next.controllerFilter ? prev : next.controllerFilter));
    setDepartmentFilter((prev) => (prev === next.departmentFilter ? prev : next.departmentFilter));
    setHasAttachments((prev) => (prev === next.hasAttachments ? prev : next.hasAttachments));
    setUnreadCommentsOnly((prev) => (prev === next.unreadCommentsOnly ? prev : next.unreadCommentsOnly));
    setFocusMode((prev) => (prev === (next.focusMode || 'all') ? prev : (next.focusMode || 'all')));
  }, [location.search, canManageAllTasks, canUseControllerTab]);

  useEffect(() => {
    safeWriteStoredTaskMode(pageMode);
    updateSearch((params) => {
      if (pageMode && pageMode !== 'list') params.set('task_mode', pageMode);
      else params.delete('task_mode');
      if (viewMode && !(viewMode === 'assignee' && !canManageAllTasks)) params.set('task_view', viewMode);
      else params.delete('task_view');
      if (q) params.set('task_q', q);
      else params.delete('task_q');
      if (statusFilter) params.set('task_status', statusFilter);
      else params.delete('task_status');
      if (dueState) params.set('task_due', dueState);
      else params.delete('task_due');
      if (assigneeFilter) params.set('task_assignee', assigneeFilter);
      else params.delete('task_assignee');
      if (controllerFilter) params.set('task_controller', controllerFilter);
      else params.delete('task_controller');
      if (departmentFilter) params.set('task_department', departmentFilter);
      else params.delete('task_department');
      if (hasAttachments) params.set('task_files', '1');
      else params.delete('task_files');
      if (unreadCommentsOnly) params.set('task_unread_comments', '1');
      else params.delete('task_unread_comments');
      if (focusMode && focusMode !== 'all') params.set('task_focus', focusMode);
      else params.delete('task_focus');
    });
  }, [
    assigneeFilter,
    canManageAllTasks,
    controllerFilter,
    departmentFilter,
    dueState,
    focusMode,
    hasAttachments,
    pageMode,
    q,
    statusFilter,
    unreadCommentsOnly,
    updateSearch,
    viewMode,
  ]);

  useEffect(() => {
    if (viewMode === 'assignee' || viewMode === 'creator') {
      safeWriteStoredPersonalRole(viewMode);
    }
  }, [viewMode]);

  const handlePersonalRoleChange = useCallback((role) => {
    if (role !== 'assignee' && role !== 'creator') return;
    safeWriteStoredPersonalRole(role);
    setViewMode(role);
  }, []);

  const secondaryViewMode = ['all', 'department', 'controller'].includes(viewMode) ? viewMode : false;

  const personalRoleCounts = useMemo(() => {
    if (viewMode !== 'assignee' && viewMode !== 'creator') {
      return {};
    }
    return {
      [viewMode]: Number(tasksPayload?.total ?? 0),
    };
  }, [tasksPayload?.total, viewMode]);

  const loadTaskUsers = useCallback(async () => {
    const [assigneesResult, controllersResult, departmentsResult, projectsResult, objectsResult] = await Promise.allSettled([
      hubAPI.getAssignees(),
      hubAPI.getControllers(),
      departmentsAPI.list(),
      hubAPI.getTaskProjects({ include_inactive: true }),
      hubAPI.getTaskObjects({ include_inactive: true }),
    ]);
    const assigneesPayload = assigneesResult.status === 'fulfilled' ? assigneesResult.value : null;
    const controllersPayload = controllersResult.status === 'fulfilled' ? controllersResult.value : null;
    const departmentsPayload = departmentsResult.status === 'fulfilled' ? departmentsResult.value : null;
    const projectsPayload = projectsResult.status === 'fulfilled' ? projectsResult.value : null;
    const objectsPayload = objectsResult.status === 'fulfilled' ? objectsResult.value : null;
    setAssignees(Array.isArray(assigneesPayload?.items) ? assigneesPayload.items : []);
    setControllers(Array.isArray(controllersPayload?.items) ? controllersPayload.items : []);
    setDepartments(Array.isArray(departmentsPayload?.items) ? departmentsPayload.items : []);
    setTaskProjects(Array.isArray(projectsPayload?.items) ? projectsPayload.items : []);
    setTaskObjects(Array.isArray(objectsPayload?.items) ? objectsPayload.items : []);
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const scope = viewMode === 'all' ? 'all' : (viewMode === 'department' ? 'department' : 'my');
      const roleScope = viewMode === 'all' || viewMode === 'department' ? 'both' : viewMode;
      const deadlineMode = ['deadlines', 'calendar', 'gantt'].includes(pageMode);
      const response = await hubAPI.getTasks({
        scope,
        role_scope: roleScope,
        status: statusFilter || undefined,
        q: debouncedQ || undefined,
        due_state: dueState || undefined,
        has_attachments: hasAttachments || undefined,
        assignee_user_id: canManageAllTasks && viewMode === 'all' && assigneeFilter ? Number(assigneeFilter) : undefined,
        department_id: departmentFilter || undefined,
        sort_by: pageMode === 'board' ? 'status' : (deadlineMode ? 'due_at' : 'updated_at'),
        sort_dir: deadlineMode || pageMode === 'board' ? 'asc' : 'desc',
        limit: 150,
      });
      setTasksPayload(response || { items: [], total: 0 });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки задач');
    } finally {
      setLoading(false);
    }
  }, [assigneeFilter, canManageAllTasks, debouncedQ, departmentFilter, dueState, hasAttachments, pageMode, statusFilter, viewMode]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    void loadTaskUsers();
  }, [loadTaskUsers]);

  const analyticsRequestParams = useMemo(() => ({
    start_date: analyticsFilters.start_date || undefined,
    end_date: analyticsFilters.end_date || undefined,
    date_basis: analyticsFilters.date_basis || 'protocol_date',
    project_id: Array.isArray(analyticsFilters.project_ids) && analyticsFilters.project_ids.length > 0
      ? analyticsFilters.project_ids
      : undefined,
    object_id: Array.isArray(analyticsFilters.object_ids) && analyticsFilters.object_ids.length > 0
      ? analyticsFilters.object_ids
      : undefined,
    participant_user_id: analyticsFilters.participant_user_id
      ? Number(analyticsFilters.participant_user_id)
      : undefined,
  }), [analyticsFilters]);

  const loadTaskAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const response = await hubAPI.getTaskAnalytics(analyticsRequestParams);
      setAnalyticsPayload(response || EMPTY_ANALYTICS_PAYLOAD);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки аналитики задач');
    } finally {
      setAnalyticsLoading(false);
    }
  }, [analyticsRequestParams]);

  useEffect(() => {
    if (pageMode !== 'analytics') return;
    void loadTaskAnalytics();
  }, [loadTaskAnalytics, pageMode]);

  const activeTaskProjects = useMemo(
    () => taskProjects.filter((item) => item?.is_active !== false),
    [taskProjects],
  );

  const defaultCreateProject = useMemo(() => {
    const generalProject = activeTaskProjects.find((item) => (
      String(item?.id || '') === 'general-tasks'
      || String(item?.code || '').trim().toUpperCase() === 'GENERAL'
      || String(item?.name || '').trim().toLowerCase() === 'общие задачи'
    ));
    return generalProject || activeTaskProjects[0] || null;
  }, [activeTaskProjects]);

  const defaultCreateProjectId = String(defaultCreateProject?.id || '');
  const effectiveCreateProjectId = String(createData.project_id || defaultCreateProjectId || '').trim();

  const effectiveCreateProject = useMemo(
    () => activeTaskProjects.find((item) => String(item?.id || '') === effectiveCreateProjectId) || null,
    [activeTaskProjects, effectiveCreateProjectId],
  );

  const editProjectObjects = useMemo(() => (
    taskObjects.filter((item) => item?.is_active !== false && String(item?.project_id || '') === String(editData.project_id || ''))
  ), [editData.project_id, taskObjects]);

  const activeTaskObjects = useMemo(
    () => taskObjects.filter((item) => item?.is_active !== false),
    [taskObjects],
  );

  useEffect(() => {
    if (!createOpen || createData.project_id || !defaultCreateProjectId) return;
    setCreateData((prev) => (
      prev.project_id
        ? prev
        : { ...prev, project_id: defaultCreateProjectId }
    ));
  }, [createData.project_id, createOpen, defaultCreateProjectId]);

  const selectedBoardAssignee = useMemo(
    () => findTaskUserById(assignees, assigneeFilter),
    [assigneeFilter, assignees],
  );

  const selectedBoardController = useMemo(
    () => findTaskUserById(controllers, controllerFilter),
    [controllerFilter, controllers],
  );

  const selectedBoardDepartment = useMemo(
    () => findDepartmentById(departments, departmentFilter),
    [departmentFilter, departments],
  );

  const selectedCreateDepartment = useMemo(
    () => findDepartmentById(departments, createData.department_id),
    [createData.department_id, departments],
  );

  const selectedEditDepartment = useMemo(
    () => findDepartmentById(departments, editData.department_id),
    [departments, editData.department_id],
  );

  const currentUserManagedDepartmentIds = useMemo(() => new Set(
    departments
      .filter((item) => item?.is_current_user_manager)
      .map((item) => String(item?.id || ''))
      .filter(Boolean),
  ), [departments]);

  const selectedCreateAssignees = useMemo(() => {
    const ids = Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : [];
    return ids
      .map((value) => findTaskUserById(assignees, value))
      .filter(Boolean);
  }, [assignees, createData.assignee_user_ids]);

  const selectedCreateController = useMemo(
    () => findTaskUserById(controllers, createData.controller_user_id),
    [controllers, createData.controller_user_id],
  );

  const createDuePresets = useMemo(() => buildCreateDuePresets(new Date()), [createOpen]);
  const createDueLabel = useMemo(
    () => formatCreateDueLabel(createData.due_at, new Date()),
    [createData.due_at],
  );
  const createDescriptionSummary = stripMarkdownForPreview(createDescriptionPreview || createData.description);
  const createAssigneeSummary = useMemo(() => {
    if (selectedCreateAssignees.length === 0) return '';
    const names = selectedCreateAssignees.map(getTaskUserLabel);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  }, [selectedCreateAssignees]);

  const selectedEditAssignee = useMemo(
    () => findTaskUserById(assignees, editData.assignee_user_id),
    [assignees, editData.assignee_user_id],
  );

  const selectedEditController = useMemo(
    () => findTaskUserById(controllers, editData.controller_user_id),
    [controllers, editData.controller_user_id],
  );

  const analyticsObjectOptions = useMemo(() => {
    const selectedProjects = Array.isArray(analyticsFilters.project_ids) ? analyticsFilters.project_ids : [];
    if (selectedProjects.length === 0) return activeTaskObjects;
    return activeTaskObjects.filter((item) => selectedProjects.includes(String(item?.project_id || '')));
  }, [activeTaskObjects, analyticsFilters.project_ids]);

  useEffect(() => {
    const allowedIds = new Set(analyticsObjectOptions.map((item) => String(item?.id || '')));
    setAnalyticsFilters((prev) => {
      const currentIds = Array.isArray(prev.object_ids) ? prev.object_ids : [];
      const nextIds = currentIds.filter((item) => allowedIds.has(String(item)));
      if (nextIds.length === currentIds.length) return prev;
      return { ...prev, object_ids: nextIds };
    });
  }, [analyticsObjectOptions]);

  const analyticsTableColumns = useMemo(() => buildAnalyticsTableColumns(), []);

  const analyticsSummary = useMemo(
    () => analyticsPayload?.summary || {},
    [analyticsPayload],
  );

  const selectedAnalyticsParticipantId = useMemo(
    () => String(analyticsFilters.participant_user_id || '').trim(),
    [analyticsFilters.participant_user_id],
  );

  const selectedAnalyticsParticipantOption = useMemo(
    () => findTaskUserById(assignees, selectedAnalyticsParticipantId),
    [assignees, selectedAnalyticsParticipantId],
  );

  const selectedAnalyticsParticipant = useMemo(() => {
    if (!selectedAnalyticsParticipantId) return null;
    const byId = (analyticsPayload?.by_participant || []).find(
      (item) => String(item?.participant_user_id || '') === selectedAnalyticsParticipantId,
    );
    if (byId) return byId;
    const fallbackUser = selectedAnalyticsParticipantOption;
    if (!fallbackUser) return null;
    return {
      participant_user_id: Number(selectedAnalyticsParticipantId),
      participant_name: fallbackUser.full_name || fallbackUser.username || 'Участник',
      total: 0,
      new: 0,
      in_progress: 0,
      review: 0,
      open: 0,
      done: 0,
      done_on_time: 0,
      done_without_due: 0,
      overdue: 0,
      completion_percent: 0,
      completion_on_time_percent: 0,
    };
  }, [analyticsPayload?.by_participant, selectedAnalyticsParticipantId, selectedAnalyticsParticipantOption]);

  const selectedAnalyticsObjects = useMemo(() => {
    const selectedIds = Array.isArray(analyticsFilters.object_ids) ? analyticsFilters.object_ids : [];
    if (selectedIds.length === 0) return [];
    return selectedIds
      .map((id) => analyticsObjectOptions.find((item) => String(item?.id || '') === String(id)))
      .filter(Boolean);
  }, [analyticsFilters.object_ids, analyticsObjectOptions]);

  const selectedAnalyticsProjects = useMemo(() => {
    const selectedIds = Array.isArray(analyticsFilters.project_ids) ? analyticsFilters.project_ids : [];
    if (selectedIds.length === 0) return [];
    return selectedIds
      .map((id) => activeTaskProjects.find((item) => String(item?.id || '') === String(id)))
      .filter(Boolean);
  }, [activeTaskProjects, analyticsFilters.project_ids]);

  const analyticsParticipantSectionMeta = useMemo(() => {
    if (selectedAnalyticsObjects.length === 1) {
      return {
        title: 'По участникам выбранного объекта',
        subtitle: selectedAnalyticsObjects[0]?.name || '',
      };
    }
    if (selectedAnalyticsObjects.length > 1) {
      return {
        title: 'По участникам выбранных объектов',
        subtitle: selectedAnalyticsObjects.map((item) => item?.name).filter(Boolean).join(', '),
      };
    }
    if (selectedAnalyticsProjects.length === 1) {
      return {
        title: 'По участникам выбранного проекта',
        subtitle: selectedAnalyticsProjects[0]?.name || '',
      };
    }
    if (selectedAnalyticsProjects.length > 1) {
      return {
        title: 'По участникам выбранных проектов',
        subtitle: selectedAnalyticsProjects.map((item) => item?.name).filter(Boolean).join(', '),
      };
    }
    return {
      title: 'По участникам',
      subtitle: '',
    };
  }, [selectedAnalyticsObjects, selectedAnalyticsProjects]);

  const analyticsProjectSectionMeta = useMemo(() => {
    if (selectedAnalyticsProjects.length === 1) {
      return {
        title: 'Срез по проекту',
        subtitle: selectedAnalyticsProjects[0]?.name || '',
      };
    }
    if (selectedAnalyticsProjects.length > 1) {
      return {
        title: 'Срез по проектам',
        subtitle: selectedAnalyticsProjects.map((item) => item?.name).filter(Boolean).join(', '),
      };
    }
    return null;
  }, [selectedAnalyticsProjects]);

  const analyticsFocusMeta = useMemo(() => {
    if (selectedAnalyticsObjects.length === 1) {
      return {
        title: 'Сейчас считаем по объекту',
        description: 'Ниже вся аналитика уже отфильтрована по выбранному объекту.',
        chips: selectedAnalyticsObjects.map((item) => ({ key: `object-${item.id}`, label: item.name, color: '#2563eb', bg: alpha('#2563eb', 0.12) })),
      };
    }
    if (selectedAnalyticsObjects.length > 1) {
      return {
        title: 'Сейчас считаем по выбранным объектам',
        description: 'Ниже вся аналитика уже отфильтрована по выбранным объектам.',
        chips: selectedAnalyticsObjects.map((item) => ({ key: `object-${item.id}`, label: item.name, color: '#2563eb', bg: alpha('#2563eb', 0.12) })),
      };
    }
    if (selectedAnalyticsProjects.length === 1) {
      return {
        title: 'Сейчас считаем по проекту',
        description: 'Ниже вся аналитика уже отфильтрована по выбранному проекту.',
        chips: selectedAnalyticsProjects.map((item) => ({ key: `project-${item.id}`, label: item.name, color: '#059669', bg: alpha('#059669', 0.12) })),
      };
    }
    if (selectedAnalyticsProjects.length > 1) {
      return {
        title: 'Сейчас считаем по выбранным проектам',
        description: 'Ниже вся аналитика уже отфильтрована по выбранным проектам.',
        chips: selectedAnalyticsProjects.map((item) => ({ key: `project-${item.id}`, label: item.name, color: '#059669', bg: alpha('#059669', 0.12) })),
      };
    }
    return {
      title: 'Сейчас считаем по всем задачам',
      description: 'Чтобы увидеть срез по проекту, выберите проект. Чтобы сузить отчёт до объекта, после этого выберите объект.',
      chips: [],
    };
  }, [selectedAnalyticsObjects, selectedAnalyticsProjects, alpha]);

  const analyticsFiltersVisible = isAnalyticsMobile ? mobileBoardFiltersOpen : analyticsDesktopFiltersVisible;
  const analyticsFilterFieldSx = useMemo(() => ({
    '& .MuiInputLabel-root': {
      fontWeight: 700,
    },
    '& .MuiInputLabel-shrink': {
      fontWeight: 800,
    },
    '& .MuiOutlinedInput-root': {
      minHeight: 40,
      borderRadius: '11px',
      bgcolor: ui.panelSolid,
    },
    '& .MuiInputBase-input': {
      py: 1,
    },
    '& .MuiAutocomplete-tag': {
      height: 24,
      fontWeight: 700,
    },
  }), [ui.panelSolid]);

  const toggleAnalyticsFilters = useCallback(() => {
    if (isAnalyticsMobile) {
      setMobileBoardFiltersOpen((prev) => !prev);
      return;
    }
    setAnalyticsDesktopFiltersVisible((prev) => !prev);
  }, [isAnalyticsMobile]);

  const selectAnalyticsParticipant = useCallback((participantId) => {
    const nextId = String(participantId || '').trim();
    setAnalyticsFilters((prev) => ({
      ...prev,
      participant_user_id: nextId,
    }));
  }, []);

  const analyticsStatusChartData = useMemo(() => {
    const rawItems = Array.isArray(analyticsPayload?.status_breakdown) ? analyticsPayload.status_breakdown : [];
    const base = rawItems.length > 0 ? rawItems : [
      { status: 'new', label: 'Новые', value: Number(analyticsSummary?.new || 0) },
      { status: 'in_progress', label: 'В работе', value: Number(analyticsSummary?.in_progress || 0) },
      { status: 'review', label: 'На проверке', value: Number(analyticsSummary?.review || 0) },
      { status: 'done', label: 'Выполнено', value: Number(analyticsSummary?.done || 0) },
    ];
    return base.map((item) => ({
      ...item,
      value: Number(item?.value || 0),
      color: analyticsStatusColors[item?.status] || '#64748b',
    }));
  }, [analyticsPayload?.status_breakdown, analyticsSummary]);

  const analyticsParticipantChartData = useMemo(() => (
    Array.isArray(analyticsPayload?.by_participant)
      ? analyticsPayload.by_participant
        .slice(0, 8)
        .map((item) => ({
          name: item?.participant_name || 'Не назначен',
          open: Number(item?.open || 0),
          done: Number(item?.done || 0),
          overdue: Number(item?.overdue || 0),
        }))
      : []
  ), [analyticsPayload?.by_participant]);

  const analyticsScopeChart = useMemo(() => {
    const hasObjectFocus = Array.isArray(analyticsFilters.object_ids) && analyticsFilters.object_ids.length > 0;
    const singleProjectFocus = Array.isArray(analyticsFilters.project_ids) && analyticsFilters.project_ids.length === 1;
    const useObjects = hasObjectFocus || singleProjectFocus;
    const sourceRows = useObjects ? analyticsPayload?.by_object : analyticsPayload?.by_project;
    return {
      title: useObjects ? 'По объектам' : 'По проектам',
      rows: Array.isArray(sourceRows)
        ? sourceRows.slice(0, 8).map((item) => ({
          name: useObjects ? (item?.object_name || 'Без объекта') : (item?.project_name || 'Без проекта'),
          open: Number(item?.open || 0),
          done: Number(item?.done || 0),
          overdue: Number(item?.overdue || 0),
        }))
        : [],
    };
  }, [analyticsFilters.object_ids, analyticsFilters.project_ids, analyticsPayload?.by_object, analyticsPayload?.by_project]);

  const analyticsTrendItems = useMemo(() => (
    Array.isArray(analyticsPayload?.trend?.items)
      ? analyticsPayload.trend.items.map((item) => ({
        name: item?.bucket_label || '',
        created: Number(item?.created || 0),
        completed: Number(item?.completed || 0),
        completed_on_time: Number(item?.completed_on_time || 0),
      }))
      : []
  ), [analyticsPayload?.trend]);

  const analyticsKpis = useMemo(() => ([
    { title: 'Всего задач', value: Number(analyticsSummary?.total || 0), color: '#2563eb', helper: 'Все задачи по фильтрам' },
    { title: 'Открыто', value: Number(analyticsSummary?.open || 0), color: '#d97706', helper: `Новые ${Number(analyticsSummary?.new || 0)} · В работе ${Number(analyticsSummary?.in_progress || 0)} · На проверке ${Number(analyticsSummary?.review || 0)}` },
    { title: 'Выполнено', value: formatMetricCountPercent(analyticsSummary?.done, analyticsSummary?.completion_percent), color: '#059669', helper: 'Общий процент выполнения' },
    { title: 'В срок', value: formatMetricCountPercent(analyticsSummary?.done_on_time, analyticsSummary?.completion_on_time_percent), color: '#7c3aed', helper: `Со сроком: ${Number(analyticsSummary?.with_due_total || 0)}` },
    { title: 'Просрочено', value: Number(analyticsSummary?.overdue || 0), color: '#dc2626', helper: 'Открытые задачи с истекшим сроком' },
    { title: 'Выполнено без срока', value: Number(analyticsSummary?.done_without_due || 0), color: '#0f766e', helper: 'Не попадают в KPI "В срок"' },
  ]), [analyticsSummary]);

  const projectObjectCounts = useMemo(() => {
    const counts = {};
    taskObjects.forEach((item) => {
      const key = String(item?.project_id || '').trim();
      if (!key) return;
      counts[key] = Number(counts[key] || 0) + 1;
    });
    return counts;
  }, [taskObjects]);

  const patchTaskItem = useCallback((taskId, patch) => {
    const targetId = String(taskId || '').trim();
    if (!targetId) return;
    setTasksPayload((prev) => ({
      ...(prev || {}),
      items: Array.isArray(prev?.items)
        ? prev.items.map((item) => (String(item?.id || '') === targetId ? { ...item, ...(patch || {}) } : item))
        : [],
    }));
  }, []);

  const chooseRoleViewForTask = useCallback((task) => {
    if (!task) return canManageAllTasks ? 'all' : 'assignee';
    if (canManageAllTasks) return 'all';
    if (canUseControllerTab && Number(task?.controller_user_id) === Number(user?.id)) return 'controller';
    if (canUseCreatorTab && Number(task?.created_by_user_id) === Number(user?.id)) return 'creator';
    return 'assignee';
  }, [canManageAllTasks, canUseControllerTab, canUseCreatorTab, user?.id]);

  const loadTaskDetails = useCallback(async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId) return;
    setDetailsLoading(true);
    try {
      const task = await hubAPI.getTask(normalizedId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
      const [commentsResult, statusResult] = await Promise.allSettled([
        hubAPI.getTaskComments(normalizedId),
        hubAPI.getTaskStatusLog(normalizedId),
      ]);

      let nextTask = task || null;
      setDetailsComments(
        commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value?.items)
          ? commentsResult.value.items
          : [],
      );
      setDetailsStatusLog(
        statusResult.status === 'fulfilled' && Array.isArray(statusResult.value?.items)
          ? statusResult.value.items
          : [],
      );

      if (task?.has_unread_comments) {
        try {
          await hubAPI.markTaskCommentsSeen(normalizedId);
          nextTask = { ...task, has_unread_comments: false };
          patchTaskItem(normalizedId, { has_unread_comments: false });
          window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
        } catch {
          // ignore
        }
      }

      patchTaskItem(normalizedId, nextTask || task || {});
      setDetailsTask(nextTask);
      setViewMode((prev) => {
        const suggested = chooseRoleViewForTask(nextTask);
        return prev === suggested ? prev : suggested;
      });
    } catch (err) {
      setDetailsTask(null);
      setDetailsComments([]);
      setDetailsStatusLog([]);
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки карточки задачи');
    } finally {
      setDetailsLoading(false);
    }
  }, [chooseRoleViewForTask, patchTaskItem]);

  useEffect(() => {
    if (!selectedTaskId) {
      taskDetailHistorySeededRef.current = false;
      taskDetailHistoryPushedRef.current = false;
      setDetailsTask(null);
      setDetailsComments([]);
      setDetailsStatusLog([]);
      setDetailsCommentBody('');
      return;
    }
    void loadTaskDetails(selectedTaskId);
  }, [loadTaskDetails, selectedTaskId]);

  useLayoutEffect(() => {
    if (!isMobile || !selectedTaskId || taskDetailHistorySeededRef.current || typeof window === 'undefined') {
      return;
    }

    const historyIdx = window.history.state?.idx;
    if (typeof historyIdx === 'number' && historyIdx > 0) {
      taskDetailHistorySeededRef.current = true;
      return;
    }

    const listParams = new URLSearchParams(location.search || '');
    listParams.delete('task');
    listParams.delete('task_tab');
    const listHref = `${location.pathname}${listParams.toString() ? `?${listParams.toString()}` : ''}`;
    const taskHref = `${location.pathname}${location.search || ''}`;
    if (listHref === taskHref) {
      taskDetailHistorySeededRef.current = true;
      return;
    }

    taskDetailHistorySeededRef.current = true;
    taskDetailHistoryPushedRef.current = true;
    const currentState = window.history.state;
    window.history.replaceState(currentState, '', listHref);
    window.history.pushState(currentState, '', taskHref);
  }, [isMobile, location.pathname, location.search, selectedTaskId]);

  const transformTaskMarkdown = useCallback(async (text, context) => {
    try {
      return await hubAPI.transformMarkdown({ text, context });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка');
      throw err;
    }
  }, []);

  const taskItems = useMemo(() => (
    Array.isArray(tasksPayload?.items) ? tasksPayload.items : []
  ), [tasksPayload]);

  const visibleTaskItems = useMemo(() => taskItems.filter((task) => {
    if (assigneeFilter && String(task?.assignee_user_id || '') !== String(assigneeFilter)) return false;
    if (controllerFilter && String(task?.controller_user_id || '') !== String(controllerFilter)) return false;
    if (unreadCommentsOnly && !task?.has_unread_comments) return false;
    if (focusMode === 'review' && String(task?.status || '').toLowerCase() !== 'review') return false;
    if (focusMode === 'overdue' && !task?.is_overdue) return false;
    if (focusMode === 'comments' && !task?.has_unread_comments) return false;
    return true;
  }), [assigneeFilter, controllerFilter, focusMode, taskItems, unreadCommentsOnly]);

  const columnData = useMemo(() => {
    const map = {};
    KANBAN_COLUMNS.forEach((column) => {
      map[column.key] = [];
    });
    visibleTaskItems.forEach((task) => {
      const status = String(task?.status || '').toLowerCase();
      if (map[status]) map[status].push(task);
      else map.new.push(task);
    });
    return map;
  }, [visibleTaskItems]);

  const mobileBoardItems = useMemo(
    () => KANBAN_COLUMNS.flatMap((column) => columnData[column.key] || []),
    [columnData],
  );

  const isTaskDataMode = pageMode !== 'analytics';
  const activeTaskModeMeta = useMemo(
    () => TASK_MODE_OPTIONS.find((item) => item.value === pageMode) || TASK_MODE_OPTIONS[0],
    [pageMode],
  );
  const taskGroupingNow = useMemo(() => new Date(), [tasksPayload]);
  const mobileFeedItems = useMemo(
    () => buildMobileTaskFeed(visibleTaskItems, taskGroupingNow),
    [taskGroupingNow, visibleTaskItems],
  );
  const deadlineBuckets = useMemo(
    () => buildDeadlineBuckets(visibleTaskItems, taskGroupingNow),
    [taskGroupingNow, visibleTaskItems],
  );
  const calendarPayload = useMemo(
    () => buildCalendarDays(visibleTaskItems, calendarMonth),
    [calendarMonth, visibleTaskItems],
  );
  const ganttPayload = useMemo(
    () => buildGanttRows(visibleTaskItems),
    [visibleTaskItems],
  );

  const openTasksCount = useMemo(
    () => visibleTaskItems.filter((item) => String(item?.status || '').toLowerCase() !== 'done').length,
    [visibleTaskItems],
  );

  const focusCounts = useMemo(() => ({
    all: taskItems.length,
    review: taskItems.filter((item) => String(item?.status || '').toLowerCase() === 'review').length,
    overdue: taskItems.filter((item) => item?.is_overdue).length,
    comments: taskItems.filter((item) => item?.has_unread_comments).length,
  }), [taskItems]);

  const activeFilterCount = useMemo(() => [
    q,
    statusFilter,
    dueState,
    assigneeFilter,
    controllerFilter,
    departmentFilter,
    hasAttachments,
    unreadCommentsOnly,
    focusMode !== 'all',
  ].filter(Boolean).length, [
    assigneeFilter,
    controllerFilter,
    departmentFilter,
    dueState,
    focusMode,
    hasAttachments,
    q,
    statusFilter,
    unreadCommentsOnly,
  ]);

  const resetFilters = useCallback(() => {
    setQ('');
    setStatusFilter('');
    setDueState('');
    setAssigneeFilter('');
    setControllerFilter('');
    setDepartmentFilter('');
    setHasAttachments(false);
    setUnreadCommentsOnly(false);
    setFocusMode('all');
  }, []);

  const shiftCalendarMonth = useCallback((delta) => {
    setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }, []);

  const openCreateTaskWithPreset = useCallback((preset = {}) => {
    const hasDuePreset = Object.prototype.hasOwnProperty.call(preset, 'due_at');
    if (hasDuePreset) {
      setCreateData((prev) => ({
        ...prev,
        due_at: preset.due_at ? toDateTimeInput(preset.due_at) : '',
      }));
    }
    setCreateOpen(true);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search || '');
    if (params.get('create') !== '1' || !canCreateTasks) return;
    openCreateTaskWithPreset();
    params.delete('create');
    const nextSearch = params.toString();
    navigate(
      { pathname: location.pathname, search: nextSearch ? `?${nextSearch}` : '' },
      { replace: true },
    );
  }, [canCreateTasks, location.pathname, location.search, navigate, openCreateTaskWithPreset]);

  const closeTaskDetails = useCallback(() => {
    setDetailsTask(null);
    setDetailsComments([]);
    setDetailsStatusLog([]);
    setDetailsCommentBody('');

    const params = new URLSearchParams(location.search || '');
    const hasTaskInUrl = Boolean(String(params.get('task') || '').trim());

    if (isMobile && hasTaskInUrl && taskDetailHistoryPushedRef.current) {
      taskDetailHistoryPushedRef.current = false;
      navigate(-1);
      return;
    }

    updateSearch((nextParams) => {
      nextParams.delete('task');
      nextParams.delete('task_tab');
      nextParams.delete('task_mobile_view');
    }, { replace: true });
  }, [isMobile, location.search, navigate, updateSearch]);

  const openTaskDetails = useCallback((task) => {
    const id = String(task?.id || '').trim();
    if (!id) return;
    setDetailsLoading(true);
    setDetailsTask(null);
    setDetailsComments([]);
    setDetailsStatusLog([]);
    if (isMobile) {
      taskDetailHistoryPushedRef.current = true;
    }
    updateSearch((params) => {
      params.set('task', id);
      params.set('task_tab', 'comments');
      params.delete('task_mobile_view');
    }, { replace: false });
  }, [isMobile, updateSearch]);

  const openMobileTaskChecklist = useCallback(() => {
    if (!selectedTaskId) return;
    updateSearch((params) => {
      params.set('task', selectedTaskId);
      params.set('task_mobile_view', 'checklist');
    }, { replace: false });
  }, [selectedTaskId, updateSearch]);

  const closeMobileTaskChecklist = useCallback(() => {
    updateSearch((params) => {
      params.delete('task_mobile_view');
    }, { replace: false });
  }, [updateSearch]);

  const setTaskDetailTab = useCallback((tab) => {
    const nextTab = normalizeTaskDetailTab(tab);
    updateSearch((params) => {
      if (selectedTaskId) {
        params.set('task_tab', nextTab);
      }
    }, { replace: false });
  }, [selectedTaskId, updateSearch]);

  const downloadBlob = useCallback((response, fileName) => {
    const blob = response?.data instanceof Blob
      ? response.data
      : new Blob([response?.data || response], { type: response?.headers?.['content-type'] || 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'file';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  }, []);

  const handleExportTaskAnalytics = useCallback(async () => {
    setAnalyticsExporting(true);
    try {
      const response = await hubAPI.exportTaskAnalyticsExcel(analyticsRequestParams);
      const filename = parseFilename(response?.headers?.['content-disposition']) || 'task_analytics.xlsx';
      downloadBlob(response, filename);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка экспорта аналитики задач');
    } finally {
      setAnalyticsExporting(false);
    }
  }, [analyticsRequestParams, downloadBlob]);

  const handleDownloadAttachment = useCallback(async (task, attachment) => {
    try {
      const response = await hubAPI.downloadTaskAttachment({ taskId: task.id, attachmentId: attachment.id });
      downloadBlob(response, attachment?.file_name || 'attachment');
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка скачивания вложения');
    }
  }, [downloadBlob]);

  const handleDownloadReport = useCallback(async (report) => {
    if (!report?.id || !report?.file_name) return;
    try {
      const response = await hubAPI.downloadTaskReport(report.id);
      downloadBlob(response, report.file_name);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка скачивания отчёта');
    }
  }, [downloadBlob]);

  const handleToggleCreateOptionalSection = useCallback((key) => {
    if (key === 'priority') {
      setCreateData((prev) => ({
        ...prev,
        priority: prev.priority === 'high' ? 'normal' : 'high',
      }));
      setCreateOptionalSections((prev) => ({ ...prev, priority: !prev.priority }));
      return;
    }
    if (key === 'checklist') {
      setCreateChecklistItems((prev) => (prev.length > 0 ? prev : [createEmptyChecklistItem()]));
    }
    setCreateOptionalSections((prev) => {
      if (key === 'advanced') {
        const nextAdvanced = !prev.advanced;
        return {
          ...prev,
          advanced: nextAdvanced,
          schedule: nextAdvanced,
          access: nextAdvanced,
          project: nextAdvanced ? true : prev.project,
          controller: nextAdvanced ? true : prev.controller,
        };
      }
      return { ...prev, [key]: !prev[key] };
    });
  }, []);

  const handleOpenCreateMobileSheet = useCallback((key) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;

    if (!isMobile) {
      handleToggleCreateOptionalSection(normalizedKey);
      return;
    }

    if (normalizedKey === 'checklist') {
      setCreateChecklistItems((prev) => (prev.length > 0 ? prev : [createEmptyChecklistItem()]));
      setCreateOptionalSections((prev) => ({ ...prev, checklist: true }));
    } else if (['files', 'project', 'controller'].includes(normalizedKey)) {
      setCreateOptionalSections((prev) => ({ ...prev, [normalizedKey]: true }));
    } else if (normalizedKey === 'advanced') {
      setCreateOptionalSections((prev) => ({
        ...prev,
        advanced: true,
        schedule: true,
        access: true,
        project: true,
        controller: true,
      }));
    }

    setCreateMobileSheet(normalizedKey);
  }, [handleToggleCreateOptionalSection, isMobile]);

  const handleCloseCreateMobileSheet = useCallback(() => {
    setCreateDescriptionPreview(String(createDescriptionRef.current || '').trim());
    setCreateMobileSheet('');
  }, []);

  const handleChangeCreateAssigneeIds = useCallback((nextIds) => {
    setCreateData((prev) => ({
      ...prev,
      assignee_user_ids: (Array.isArray(nextIds) ? nextIds : [])
        .map((item) => String(item || ''))
        .filter(Boolean),
    }));
  }, []);

  const handleClearCreateAssignees = useCallback(() => {
    setCreateData((prev) => ({ ...prev, assignee_user_ids: [] }));
  }, []);

  const handleAddChecklistItem = useCallback(() => {
    setCreateChecklistItems((prev) => [...prev, createEmptyChecklistItem()]);
    setCreateOptionalSections((prev) => ({ ...prev, checklist: true }));
  }, []);

  const handleUpdateChecklistItem = useCallback((itemId, patch) => {
    setCreateChecklistItems((prev) => prev.map((item) => (
      item.id === itemId ? { ...item, ...patch } : item
    )));
  }, []);

  const handleRemoveChecklistItem = useCallback((itemId) => {
    setCreateChecklistItems((prev) => {
      const next = prev.filter((item) => item.id !== itemId);
      return next.length > 0 ? next : [createEmptyChecklistItem()];
    });
  }, []);

  const handleCreateProjectFromTaskDialog = useCallback(async () => {
    const name = String(createProjectName || '').trim();
    if (name.length < 2 || createProjectSaving) return;
    setCreateProjectSaving(true);
    try {
      const created = await hubAPI.createTaskProject({
        name,
        code: '',
        description: '',
        is_active: true,
      });
      setCreateProjectName('');
      await loadTaskUsers();
      setCreateData((prev) => ({
        ...prev,
        project_id: String(created?.id || prev.project_id || ''),
        object_id: '',
      }));
      setCreateOptionalSections((prev) => ({ ...prev, project: true }));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка создания проекта');
    } finally {
      setCreateProjectSaving(false);
    }
  }, [createProjectName, createProjectSaving, loadTaskUsers]);

  const refreshTasksAndDetails = useCallback(async (taskId = '') => {
    await loadTasks();
    if (taskId) {
      await loadTaskDetails(taskId);
    }
  }, [loadTaskDetails, loadTasks]);

  const handleAddCreateFiles = useCallback((fileList) => {
    const nextFiles = Array.from(fileList || []).filter(Boolean);
    if (nextFiles.length === 0) return;
    setCreateFiles((prev) => {
      const seen = new Set(prev.map(getFileIdentity));
      const merged = [...prev];
      nextFiles.forEach((file) => {
        const identity = getFileIdentity(file);
        if (!seen.has(identity)) {
          seen.add(identity);
          merged.push(file);
        }
      });
      return merged;
    });
    setCreateOptionalSections((prev) => ({ ...prev, files: true }));
  }, []);

  const handleRemoveCreateFile = useCallback((index) => {
    setCreateFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    if (createSaving) return;
    setCreateOpen(false);
    setCreateDueSheetOpen(false);
    setCreateDueCustomOpen(false);
    setCreateMobileSheet('');
    setCreateDescriptionPreview('');
    setCreateFiles([]);
    setCreateChecklistItems([]);
    setCreateProjectName('');
    setCreateOptionalSections((prev) => {
      if (!Object.values(prev).some(Boolean)) return prev;
      return createEmptyOptionalSections();
    });
  }, [createSaving]);

  const handleSelectCreateDuePreset = useCallback((value) => {
    setCreateData((prev) => ({ ...prev, due_at: String(value || '') }));
    setCreateDueCustomOpen(false);
    setCreateDueSheetOpen(false);
  }, []);

  const handleOpenCreateCustomDue = useCallback(() => {
    setCreateDueCustomOpen(true);
  }, []);

  const handleCreateTask = async () => {
    const assigneeIds = Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : [];
    const controllerUserId = Number(createData.controller_user_id || 0);
    const projectId = effectiveCreateProjectId;
    const filesToUpload = createFiles.filter(Boolean);
    if (
      String(createData.title || '').trim().length < 3
      || assigneeIds.length === 0
      || !projectId
      || !String(createData.protocol_date || '').trim()
    ) return;
    setCreateSaving(true);
    try {
      const createResponse = await hubAPI.createTask({
        title: String(createData.title || '').trim(),
        description: String(createDescriptionRef.current || createData.description || '').trim(),
        checklist_items: normalizeChecklistItems(createChecklistItems),
        assignee_user_ids: assigneeIds.map(Number).filter(Number.isInteger),
        controller_user_id: controllerUserId > 0 ? controllerUserId : null,
        project_id: projectId,
        object_id: String(createData.object_id || '').trim() || null,
        protocol_date: String(createData.protocol_date || '').trim() || null,
        due_at: String(createData.due_at || '').trim() || null,
        priority: createData.priority || 'normal',
        department_id: String(createData.department_id || '').trim() || null,
        visibility_scope: String(createData.department_id || '').trim()
          ? (String(createData.visibility_scope || 'department').trim() || 'department')
          : 'private',
      });
      const createdTasks = getCreatedTaskItems(createResponse);
      const uploadFailures = [];
      if (filesToUpload.length > 0 && createdTasks.length === 0) {
        uploadFailures.push('API не вернул id задачи');
      }
      if (filesToUpload.length > 0 && createdTasks.length > 0) {
        for (const task of createdTasks) {
          const taskId = String(task?.id || '').trim();
          if (!taskId) {
            uploadFailures.push('API не вернул id задачи');
            continue;
          }
          for (const file of filesToUpload) {
            try {
              await hubAPI.uploadTaskAttachment({ taskId, file });
            } catch {
              uploadFailures.push(file?.name || 'file');
            }
          }
        }
      }
      setCreateOpen(false);
      setCreateDueSheetOpen(false);
      setCreateDueCustomOpen(false);
      setCreateMobileSheet('');
      setCreateDescriptionPreview('');
      setCreateOptionalSections(createEmptyOptionalSections());
      setCreateData(createInitialTaskDraft(defaultCreateProjectId));
      createDescriptionRef.current = '';
      setCreateFiles([]);
      setCreateChecklistItems([]);
      setCreateProjectName('');
      await loadTasks();
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
      if (uploadFailures.length > 0) {
        const visibleFailures = uploadFailures.slice(0, 3).join(', ');
        const suffix = uploadFailures.length > 3 ? ` и ещё ${uploadFailures.length - 3}` : '';
        setError(`Задача создана, но часть файлов не загрузилась: ${visibleFailures}${suffix}`);
      }
    } catch (err) {
      setError(formatHubTaskError(err));
    } finally {
      setCreateSaving(false);
    }
  };

  const handleReviewTask = async (decision) => {
    if (!reviewTask?.id) return;
    try {
      await hubAPI.reviewTask(reviewTask.id, { decision, comment: reviewComment });
      setReviewTask(null);
      setReviewComment('');
      await refreshTasksAndDetails(reviewTask.id);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка проверки задачи');
    }
  };

  const handleStartTask = async (taskId) => {
    try {
      await hubAPI.startTask(taskId);
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка перевода задачи в работу');
    }
  };

  const handleSubmitTask = async () => {
    if (!submitTask?.id) return;
    setSubmitSaving(true);
    try {
      await hubAPI.submitTask({
        taskId: submitTask.id,
        comment: submitComment,
        file: submitFile || null,
      });
      const taskId = submitTask.id;
      setSubmitTask(null);
      setSubmitComment('');
      setSubmitFile(null);
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка сдачи задачи');
    } finally {
      setSubmitSaving(false);
    }
  };

  const handleDeleteTask = async (task) => {
    if (!task?.id || !window.confirm(`Удалить "${task?.title || 'задачу'}"?`)) return;
    try {
      await hubAPI.deleteTask(task.id);
      if (String(selectedTaskId || '') === String(task.id)) {
        closeTaskDetails();
      }
      await loadTasks();
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка удаления задачи');
    }
  };

  const openEditTask = useCallback((task) => {
    editDescriptionRef.current = String(task?.description || '');
    setEditData({
      id: String(task?.id || ''),
      title: task?.title || '',
      description: task?.description || '',
      due_at: toDateTimeInput(task?.due_at),
      protocol_date: toDateInput(task?.protocol_date),
      priority: task?.priority || 'normal',
      project_id: String(task?.project_id || ''),
      object_id: String(task?.object_id || ''),
      assignee_user_id: String(task?.assignee_user_id || ''),
      controller_user_id: String(task?.controller_user_id || ''),
      department_id: String(task?.department_id || ''),
      visibility_scope: String(task?.visibility_scope || 'private'),
    });
    setEditOpen(true);
  }, []);

  const handleSaveEdit = async () => {
    const taskId = String(editData.id || '').trim();
    if (!taskId) return;
    setEditSaving(true);
    try {
      await hubAPI.updateTask(taskId, {
        title: String(editData.title || '').trim(),
        description: String(editDescriptionRef.current || editData.description || '').trim(),
        due_at: String(editData.due_at || '').trim() || null,
        protocol_date: String(editData.protocol_date || '').trim() || null,
        priority: editData.priority || 'normal',
        project_id: String(editData.project_id || '').trim() || null,
        object_id: String(editData.object_id || '').trim() || null,
        assignee_user_id: Number(editData.assignee_user_id || 0) || null,
        controller_user_id: Number(editData.controller_user_id || 0) || null,
        department_id: String(editData.department_id || '').trim() || null,
        visibility_scope: String(editData.visibility_scope || 'private').trim() || 'private',
      });
      setEditOpen(false);
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка сохранения задачи');
    } finally {
      setEditSaving(false);
    }
  };

  const handleUploadAttachment = async (taskId, file) => {
    if (!taskId || !file) return;
    setUploadingAttachment(true);
    try {
      await hubAPI.uploadTaskAttachment({ taskId, file });
      await refreshTasksAndDetails(taskId);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки файла');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const handleCreateProject = useCallback(async () => {
    if (String(projectDraft.name || '').trim().length < 2) return;
    setTaxonomySaving(true);
    try {
      const payload = {
        name: String(projectDraft.name || '').trim(),
        code: String(projectDraft.code || '').trim(),
        description: String(projectDraft.description || '').trim(),
        is_active: projectDraft.is_active !== false,
      };
      if (editingProjectId) {
        await hubAPI.updateTaskProject(editingProjectId, payload);
      } else {
        await hubAPI.createTaskProject(payload);
      }
      setEditingProjectId('');
      setProjectDraft(createEmptyProjectDraft());
      await loadTaskUsers();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка создания проекта');
    } finally {
      setTaxonomySaving(false);
    }
  }, [editingProjectId, loadTaskUsers, projectDraft]);

  const handleCreateObject = useCallback(async () => {
    if (!String(objectDraft.project_id || '').trim() || String(objectDraft.name || '').trim().length < 2) return;
    setTaxonomySaving(true);
    try {
      const payload = {
        project_id: String(objectDraft.project_id || '').trim(),
        name: String(objectDraft.name || '').trim(),
        code: String(objectDraft.code || '').trim(),
        description: String(objectDraft.description || '').trim(),
        is_active: objectDraft.is_active !== false,
      };
      if (editingObjectId) {
        await hubAPI.updateTaskObject(editingObjectId, payload);
      } else {
        await hubAPI.createTaskObject(payload);
      }
      const retainedProjectId = editingObjectId ? '' : String(objectDraft.project_id || '');
      setEditingObjectId('');
      setObjectDraft(createEmptyObjectDraft(retainedProjectId));
      await loadTaskUsers();
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка создания объекта');
    } finally {
      setTaxonomySaving(false);
    }
  }, [editingObjectId, loadTaskUsers, objectDraft]);

  const handleEditProject = useCallback((project) => {
    setEditingProjectId(String(project?.id || ''));
    setProjectDraft({
      name: String(project?.name || ''),
      code: String(project?.code || ''),
      description: String(project?.description || ''),
      is_active: project?.is_active !== false,
    });
  }, []);

  const handleEditObject = useCallback((taskObject) => {
    setEditingObjectId(String(taskObject?.id || ''));
    setObjectDraft({
      project_id: String(taskObject?.project_id || ''),
      name: String(taskObject?.name || ''),
      code: String(taskObject?.code || ''),
      description: String(taskObject?.description || ''),
      is_active: taskObject?.is_active !== false,
    });
  }, []);

  const resetProjectDraft = useCallback(() => {
    setEditingProjectId('');
    setProjectDraft(createEmptyProjectDraft());
  }, []);

  const resetObjectDraft = useCallback(() => {
    setEditingObjectId('');
    setObjectDraft(createEmptyObjectDraft());
  }, []);

  const handleAddTaskComment = useCallback(async () => {
    const taskId = String(detailsTask?.id || '').trim();
    const body = String(detailsCommentBody || '').trim();
    if (!taskId || !body) return;
    setDetailsCommentSaving(true);
    try {
      await hubAPI.addTaskComment(taskId, body);
      setDetailsCommentBody('');
      await refreshTasksAndDetails(taskId);
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка добавления комментария');
    } finally {
      setDetailsCommentSaving(false);
    }
  }, [detailsCommentBody, detailsTask?.id, refreshTasksAndDetails]);

  const handleOpenTaskDiscussion = useCallback(async (task = detailsTask) => {
    const taskId = String(task?.id || '').trim();
    if (!taskId || !taskDiscussionChatEnabled) return;
    setDiscussionOpening(true);
    try {
      const response = await hubAPI.openTaskDiscussion(taskId);
      const conversationId = String(response?.conversation_id || '').trim();
      if (!conversationId) {
        throw new Error('Не удалось открыть чат по задаче');
      }
      invalidateSWRCacheByPrefix('chat', 'conversations', String(user?.id || 'guest'));
      navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
      window.dispatchEvent(new CustomEvent('chat-unread-needs-refresh'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка открытия чата по задаче');
    } finally {
      setDiscussionOpening(false);
    }
  }, [detailsTask, navigate, taskDiscussionChatEnabled, user?.id]);

  const handleCopyTaskLink = useCallback(async (taskId, taskTab = 'comments') => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId || !navigator?.clipboard?.writeText) return;
    const url = new URL('/tasks', window.location.origin);
    url.searchParams.set('task', normalizedId);
    url.searchParams.set('task_tab', normalizeTaskDetailTab(taskTab));
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      // ignore clipboard failures
    }
  }, []);

  const openTransferActReminder = useCallback((task) => {
    if (!canOpenTransferActUpload(task)) return;
    const uploadUrl = getTransferActUploadUrl(task);
    if (!uploadUrl) return;
    navigate(uploadUrl);
  }, [navigate]);

  const canDeleteTask = useCallback((task) => {
    if (!task?.id) return false;
    if (isTransferActUploadTask(task) && !canManageAllTasks) return false;
    if (canManageAllTasks) return true;
    return Number(task?.created_by_user_id) === Number(user?.id);
  }, [canManageAllTasks, user?.id]);

  const canEditTask = useCallback((task) => {
    if (!task?.id) return false;
    if (isTransferActUploadTask(task) && !canManageAllTasks) return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    return Number(task?.created_by_user_id) === Number(user?.id);
  }, [canManageAllTasks, currentUserManagedDepartmentIds, user?.id]);

  const canReviewTask = useCallback((task) => {
    if (isTransferActUploadTask(task)) return false;
    if (!task?.id || String(task?.status || '').toLowerCase() !== 'review') return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    return Number(task?.created_by_user_id) === Number(user?.id)
      || (canReviewTasks && Number(task?.controller_user_id) === Number(user?.id));
  }, [canManageAllTasks, canReviewTasks, currentUserManagedDepartmentIds, user?.id]);

  const canStartTask = useCallback((task) => (
    !isTransferActUploadTask(task)
    && Number(task?.assignee_user_id) === Number(user?.id)
    && String(task?.status || '').toLowerCase() === 'new'
  ), [user?.id]);

  const canSubmitTask = useCallback((task) => (
    !isTransferActUploadTask(task)
    &&
    Number(task?.assignee_user_id) === Number(user?.id)
    && ['new', 'in_progress'].includes(String(task?.status || '').toLowerCase())
  ), [user?.id]);

  const canUploadFiles = useCallback((task) => {
    if (isTransferActUploadTask(task)) return false;
    if (!task?.id || String(task?.status || '').toLowerCase() === 'done') return false;
    if (canManageAllTasks) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      Number(task?.assignee_user_id) === actorId
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [canManageAllTasks, user?.id]);

  const canUpdateTaskChecklist = useCallback((task) => {
    if (!task?.id || String(task?.status || '').toLowerCase() === 'done') return false;
    if (canManageAllTasks) return true;
    if (currentUserManagedDepartmentIds.has(String(task?.department_id || ''))) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      Number(task?.assignee_user_id) === actorId
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [canManageAllTasks, currentUserManagedDepartmentIds, user?.id]);

  const handleToggleTaskChecklistItem = useCallback(async (task, itemId, done) => {
    const taskId = String(task?.id || '').trim();
    const items = Array.isArray(task?.checklist_items) ? task.checklist_items : [];
    if (!taskId || !itemId || items.length === 0) return;
    const nextItems = items.map((item) => (
      String(item?.id || '') === String(itemId)
        ? { ...item, done: Boolean(done) }
        : item
    ));
    try {
      await hubAPI.updateTask(taskId, { checklist_items: nextItems });
      await refreshTasksAndDetails(taskId);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка обновления чек-листа');
    }
  }, [refreshTasksAndDetails]);

  const handleAddTaskChecklistItem = useCallback(async (task, text) => {
    const taskId = String(task?.id || '').trim();
    const itemText = String(text || '').trim();
    if (!taskId || !itemText || !canUpdateTaskChecklist(task)) return;
    const items = Array.isArray(task?.checklist_items) ? task.checklist_items : [];
    const nextItems = [
      ...items,
      { id: createChecklistItemId(), text: itemText, done: false },
    ];
    try {
      await hubAPI.updateTask(taskId, { checklist_items: nextItems });
      await refreshTasksAndDetails(taskId);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка добавления пункта чек-листа');
    }
  }, [canUpdateTaskChecklist, refreshTasksAndDetails]);

  const renderTaskChecklist = useCallback((task) => {
    return (
      <TaskChecklist
        task={task}
        canUpdate={canUpdateTaskChecklist(task)}
        onToggle={(itemId, done) => void handleToggleTaskChecklistItem(task, itemId, done)}
        ui={ui}
      />
    );
  }, [canUpdateTaskChecklist, handleToggleTaskChecklistItem, ui]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isTyping = Boolean(target?.isContentEditable) || tagName === 'input' || tagName === 'textarea';

      if (event.key === 'Escape') {
        if (editOpen) {
          setEditOpen(false);
          return;
        }
        if (createOpen) {
          setCreateOpen(false);
          return;
        }
        if (reviewTask) {
          setReviewTask(null);
          return;
        }
        if (submitTask) {
          setSubmitTask(null);
          setSubmitFile(null);
          return;
        }
        if (detailsOpen) {
          closeTaskDetails();
        }
        return;
      }

      if (isTyping) return;

      if (canCreateTasks && String(event.key || '').toLowerCase() === 'n') {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }

      if (event.key === '/' || String(event.key || '').toLowerCase() === 'f') {
        event.preventDefault();
        if (pageMode === 'analytics') {
          if (isAnalyticsMobile) {
            setMobileBoardFiltersOpen(true);
          } else {
            setAnalyticsDesktopFiltersVisible(true);
          }
          return;
        }
        if (!isMobile) {
          setShowFilters(true);
        } else {
          setMobileSearchOpen(true);
        }
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus?.();
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canCreateTasks, closeTaskDetails, createOpen, detailsOpen, editOpen, isAnalyticsMobile, isMobile, pageMode, reviewTask, submitTask]);

  const renderTaskCard = useCallback((task, column) => {
    const latestComment = getTaskCommentPreview(task);
    const canEdit = canEditTask(task);
    const attachCount = Number(task?.attachments_count || 0);
    const isTransferReminder = isTransferActUploadTask(task);
    const priority = priorityMeta(task?.priority);
    const descriptionPreview = String(task?.description || '').trim();
    const mobileCardMenuItems = [
      canEdit ? { key: 'edit', label: 'Редактировать' } : null,
      { key: 'copy', label: 'Копировать ссылку' },
      canDeleteTask(task) ? { key: 'delete', label: 'Удалить', tone: 'danger' } : null,
    ].filter(Boolean);

    if (isMobile) {
      return (
        <Card
          key={task.id}
          data-testid={`mobile-task-card-${task.id}`}
          onClick={() => openTaskDetails(task)}
          sx={{
            px: 1.35,
            py: 1,
            borderRadius: 0,
            border: 'none',
            borderBottom: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: 'transparent',
            boxShadow: 'none',
            cursor: 'pointer',
            transition: 'background-color 0.16s ease',
            '&:active': {
              bgcolor: ui.actionBg,
            },
          }}
        >
          <Stack spacing={0.55}>
            <Stack direction="row" spacing={0.6} alignItems="flex-start">
              <Typography
                sx={{
                  fontWeight: 850,
                  fontSize: '0.85rem',
                  lineHeight: 1.22,
                  minWidth: 0,
                  flex: 1,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {task?.title || '-'}
              </Typography>
              {mobileCardMenuItems.length > 0 ? (
                <OverflowMenu
                  label="Действия карточки задачи"
                  items={mobileCardMenuItems}
                  onSelect={(key) => {
                    if (key === 'edit') {
                      openEditTask(task);
                      return;
                    }
                    if (key === 'delete') {
                      void handleDeleteTask(task);
                      return;
                    }
                    if (key === 'copy') {
                      void handleCopyTaskLink(task.id);
                    }
                  }}
                />
              ) : null}
            </Stack>

            {descriptionPreview ? (
              <Typography
                data-testid={`mobile-task-card-description-${task.id}`}
                sx={{
                  color: ui.mutedText,
                  fontSize: '0.76rem',
                  lineHeight: 1.32,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {descriptionPreview}
              </Typography>
            ) : null}

            <Stack direction="row" spacing={0.45} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ color: statusMeta(task?.status).color, fontWeight: 900, flexShrink: 0 }}>
                {statusMeta(task?.status).label}
              </Typography>
              <Typography variant="caption" sx={{ color: ui.subtleText, flexShrink: 0 }}>·</Typography>
              <Typography variant="caption" sx={{ color: task?.is_overdue ? '#dc2626' : ui.subtleText, fontWeight: 800, flexShrink: 0 }}>
                {task?.due_at ? formatShortDate(task.due_at) : 'Без срока'}
              </Typography>
              <Typography variant="caption" sx={{ color: ui.subtleText, flexShrink: 0 }}>·</Typography>
              <Typography variant="caption" sx={{ color: ui.subtleText, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {task?.assignee_full_name || task?.assignee_username || '-'}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={0.35} justifyContent="space-between" alignItems="center" sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={0.35} sx={{ flexWrap: 'wrap', gap: 0.3, minWidth: 0, flex: 1 }}>
              {task?.is_overdue ? (
                <Chip size="small" label="Просрочено" sx={{ height: 19, fontSize: '0.64rem', fontWeight: 850, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626', border: 'none' }} />
              ) : null}
              {task?.has_unread_comments ? (
                <Chip size="small" label="Новый комментарий" sx={{ height: 19, fontSize: '0.64rem', fontWeight: 850, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb', border: 'none', maxWidth: 136 }} />
              ) : null}
              {priority.value !== 'normal' ? (
                <Chip
                  size="small"
                  icon={<FlagIcon sx={{ fontSize: '11px !important', color: `${priority.dotColor} !important` }} />}
                  label={priority.label}
                  sx={{
                    height: 19,
                    fontSize: '0.64rem',
                    fontWeight: 800,
                    bgcolor: alpha(priority.dotColor, 0.12),
                    color: priority.dotColor,
                    border: 'none',
                    '& .MuiChip-icon': { ml: '2px' },
                  }}
                />
              ) : null}
              </Stack>
              <Stack direction="row" spacing={0.55} alignItems="center" sx={{ flexShrink: 0 }}>
                {attachCount > 0 ? (
                  <Stack direction="row" spacing={0.25} alignItems="center">
                    <AttachFileIcon sx={{ fontSize: 13, color: ui.subtleText }} />
                    <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 700 }}>
                      {attachCount}
                    </Typography>
                  </Stack>
                ) : null}
              </Stack>
            </Stack>
          </Stack>
        </Card>
      );
    }

    return (
      <Card
        key={task.id}
        className="task-card"
        data-testid={isMobile ? `mobile-task-card-${task.id}` : undefined}
        onClick={() => openTaskDetails(task)}
        sx={{
          p: isMobile ? 1 : 1.15,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
          cursor: 'pointer',
          transition: 'border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease',
          minHeight: isMobile ? 'auto' : undefined,
          '&:hover': {
            borderColor: ui.selectedBorder,
            bgcolor: ui.actionHover,
            transform: 'translateY(-1px)',
            boxShadow: ui.dialogShadow,
          },
        }}
      >
        <Stack direction="row" spacing={0.6} alignItems="flex-start">
          <Typography
            sx={{
              fontWeight: 800,
              fontSize: isMobile ? '0.88rem' : '0.83rem',
              lineHeight: 1.3,
              minWidth: 0,
              flex: 1,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {task?.title || '-'}
          </Typography>
          <Stack
            direction="row"
            spacing={0.2}
            sx={{
              opacity: { xs: 1, md: 0 },
              transition: 'opacity 0.15s ease',
              '.task-card:hover &': { opacity: 1 },
            }}
          >
            <Tooltip title="Открыть">
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  openTaskDetails(task);
                }}
                sx={{ color: ui.mutedText }}
              >
                <OpenInNewIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            {canEdit && (
              <Tooltip title="Редактировать">
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditTask(task);
                  }}
                  sx={{ color: ui.mutedText }}
                >
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Скопировать ссылку">
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCopyTaskLink(task.id);
                }}
                sx={{ color: ui.mutedText }}
              >
                <ContentCopyIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.45} sx={{ mt: 0.65, flexWrap: 'wrap', gap: 0.35 }}>
          {isTransferReminder && (
            <Chip
              size="small"
              label={getTransferActReminderLabel(task)}
              sx={{ height: 19, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb', border: 'none' }}
            />
          )}
          {task?.is_overdue && (
            <Chip size="small" label="Просрочено" sx={{ height: 19, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626', border: 'none' }} />
          )}
          {task?.has_unread_comments && (
            <Chip size="small" label="Новый комментарий" sx={{ height: 19, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb', border: 'none' }} />
          )}
          {priorityMeta(task?.priority).value !== 'normal' && (
            <Chip
              size="small"
              icon={<FlagIcon sx={{ fontSize: '11px !important', color: `${priorityMeta(task?.priority).dotColor} !important` }} />}
              label={priorityMeta(task?.priority).label}
              sx={{
                height: 19,
                fontSize: '0.62rem',
                fontWeight: 700,
                bgcolor: alpha(priorityMeta(task?.priority).dotColor, 0.12),
                color: priorityMeta(task?.priority).dotColor,
                border: 'none',
                '& .MuiChip-icon': { ml: '2px' },
              }}
            />
          )}
          {attachCount > 0 && (
            <Chip
              size="small"
              icon={<AttachFileIcon sx={{ fontSize: '11px !important' }} />}
              label={attachCount}
              sx={{ height: 19, fontSize: '0.62rem', fontWeight: 700, bgcolor: ui.actionBg, color: ui.mutedText, border: 'none', '& .MuiChip-icon': { ml: '2px' } }}
            />
          )}
        </Stack>

        {latestComment && (
          <Typography
            sx={{
              mt: 0.7,
              fontSize: '0.72rem',
              lineHeight: 1.35,
              color: task?.has_unread_comments ? 'text.primary' : ui.mutedText,
              fontWeight: task?.has_unread_comments ? 700 : 500,
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {latestComment}
          </Typography>
        )}

        {isTransferReminder && (
          <Box sx={{ mt: 0.8 }}>
            {canOpenTransferActUpload(task) && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<OpenInNewIcon />}
                onClick={(event) => {
                  event.stopPropagation();
                  openTransferActReminder(task);
                }}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
              >
                Загрузить подписанный акт
              </Button>
            )}
          </Box>
        )}

        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.85 }}>
          <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
            <Avatar sx={{ width: 22, height: 22, fontSize: '0.62rem', bgcolor: alpha(column.color, theme.palette.mode === 'dark' ? 0.18 : 0.10), color: column.color }}>
              {getInitials(task?.assignee_full_name || task?.assignee_username)}
            </Avatar>
            <Typography variant="caption" sx={{ color: ui.subtleText, maxWidth: 108, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {task?.assignee_full_name || task?.assignee_username || '-'}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={0.7} alignItems="center">
            <Stack direction="row" spacing={0.25} alignItems="center">
              <ModeCommentOutlinedIcon sx={{ fontSize: 13, color: task?.has_unread_comments ? '#2563eb' : ui.subtleText }} />
              <Typography variant="caption" sx={{ color: task?.has_unread_comments ? '#2563eb' : ui.subtleText, fontWeight: task?.has_unread_comments ? 800 : 700 }}>
                {Number(task?.comments_count || 0)}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: task?.is_overdue ? '#dc2626' : ui.subtleText, fontWeight: 700 }}>
              {task?.due_at ? formatShortDate(task.due_at) : 'Без срока'}
            </Typography>
          </Stack>
        </Stack>
      </Card>
    );
  }, [canDeleteTask, canEditTask, handleCopyTaskLink, handleDeleteTask, isMobile, openEditTask, openTaskDetails, openTransferActReminder, theme.palette.mode, ui.actionBg, ui.actionHover, ui.borderSoft, ui.dialogShadow, ui.mutedText, ui.panelSolid, ui.selectedBorder, ui.shellShadow, ui.subtleText]);

  const renderTaskTags = (task) => {
    const status = statusMeta(task?.status);
    const priority = priorityMeta(task?.priority);
    const attachCount = Number(task?.attachments_count || 0);
    const commentCount = Number(task?.comments_count || 0);
    const checklistTotal = Number(task?.checklist_total ?? (Array.isArray(task?.checklist_items) ? task.checklist_items.length : 0));
    const checklistDone = Number(task?.checklist_done ?? (Array.isArray(task?.checklist_items) ? task.checklist_items.filter((item) => item?.done).length : 0));
    const chips = [
      { key: 'status', label: status.label, color: status.color, bg: status.bg },
      priority.value !== 'normal' ? { key: 'priority', label: priority.label, color: priority.dotColor, bg: alpha(priority.dotColor, 0.12) } : null,
      task?.is_overdue ? { key: 'overdue', label: 'Просрочено', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' } : null,
      attachCount > 0 ? { key: 'files', label: `Файлы ${attachCount}`, color: ui.mutedText, bg: ui.actionBg } : null,
      commentCount > 0 ? { key: 'comments', label: `Комментарии ${commentCount}`, color: task?.has_unread_comments ? '#2563eb' : ui.mutedText, bg: task?.has_unread_comments ? 'rgba(37,99,235,0.12)' : ui.actionBg } : null,
      checklistTotal > 0 ? { key: 'checklist', label: `Чек-лист ${checklistDone}/${checklistTotal}`, color: '#0f766e', bg: 'rgba(15,118,110,0.12)' } : null,
    ].filter(Boolean);

    return (
      <Stack direction="row" spacing={0.45} sx={{ flexWrap: 'wrap', gap: 0.4 }}>
        {chips.map((chip) => (
          <Chip
            key={chip.key}
            size="small"
            label={chip.label}
            sx={{
              height: 22,
              fontSize: '0.67rem',
              fontWeight: 800,
              borderRadius: '8px',
              bgcolor: chip.bg,
              color: chip.color,
              border: 'none',
            }}
          />
        ))}
      </Stack>
    );
  };

  const mobileScrollSx = {
    height: '100%',
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    px: 0,
    pb: 'calc(58px + 16px + 8px)',
    ...hideMobileScrollbarSx,
  };

  const renderMobileTaskFeedView = () => (
    <Box data-testid="tasks-mobile-feed-view" sx={mobileScrollSx}>
      {loading && taskItems.length === 0 ? (
        <Stack spacing={0.8}>
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} variant="rounded" height={118} sx={{ borderRadius: '14px' }} />)}
        </Stack>
      ) : mobileFeedItems.length === 0 ? (
        <Box sx={{ mx: 1.35, mt: 1, ...getOfficeEmptyStateSx(ui, { p: 1.4 }) }}>
          <Typography sx={{ fontWeight: 800, mb: 0.4 }}>Задачи по текущим фильтрам не найдены.</Typography>
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Смените роль, фокус, срок или поисковый запрос.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0}>
          {mobileFeedItems.map((task) => renderTaskCard(task))}
        </Stack>
      )}
    </Box>
  );

  const renderMobileBucketList = ({ buckets, testId, showCreateButtons = false }) => (
    <Box data-testid={testId} sx={mobileScrollSx}>
      <Stack spacing={0}>
        {buckets.map((bucket) => (
          <Box
            key={bucket.key}
            sx={{
              py: 0.9,
              borderBottom: '1px solid',
              borderColor: ui.borderSoft,
            }}
          >
            <Stack spacing={0.7}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.75} sx={{ px: 1.35 }}>
                <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '999px', bgcolor: bucket.color, flexShrink: 0 }} />
                  <Typography sx={{ fontWeight: 900, color: bucket.color, minWidth: 0 }}>
                    {bucket.label}
                  </Typography>
                  <Chip size="small" label={bucket.items.length} sx={{ height: 22, fontWeight: 900, bgcolor: alpha(bucket.color, 0.12), color: bucket.color }} />
                </Stack>
                {showCreateButtons && canCreateTasks ? (
                  <IconButton
                    size="small"
                    aria-label={`Создать задачу: ${bucket.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openCreateTaskWithPreset({ due_at: bucket.createDueAt });
                    }}
                    sx={{ width: 30, height: 30, color: bucket.color }}
                  >
                    <AddIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                ) : null}
              </Stack>
              {bucket.items.length === 0 ? (
                <Box sx={{ mx: 1.35, ...getOfficeEmptyStateSx(ui, { p: 1 }) }}>
                  <Typography sx={{ fontWeight: 800 }}>Нет задач.</Typography>
                </Box>
              ) : (
                <Stack spacing={0}>
                  {bucket.items.map((task) => renderTaskCard(task, bucket))}
                </Stack>
              )}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );

  const renderMobileBoardGroups = () => (
    <Box data-testid="tasks-mobile-board" sx={mobileScrollSx}>
      <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', px: 1.35, py: 0.75, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        {KANBAN_COLUMNS.map((column) => (
          <Chip
            key={column.key}
            label={`${column.label}: ${(columnData[column.key] || []).length}`}
            sx={{ flexShrink: 0, height: 28, fontWeight: 900, bgcolor: alpha(column.color, 0.12), color: column.color }}
          />
        ))}
      </Stack>
      {loading && taskItems.length === 0 ? (
        <Stack spacing={0.8}>
          {[0, 1, 2, 3].map((item) => <Skeleton key={item} variant="rounded" height={118} sx={{ borderRadius: '14px' }} />)}
        </Stack>
      ) : mobileBoardItems.length === 0 ? (
        <Box sx={{ mx: 1.35, mt: 1, ...getOfficeEmptyStateSx(ui, { p: 1.4 }) }}>
          <Typography sx={{ fontWeight: 800, mb: 0.4 }}>Задачи по текущим фильтрам не найдены.</Typography>
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Смените быстрый статус, фокус или расширенные фильтры.
          </Typography>
        </Box>
      ) : (
        <Stack spacing={0}>
          {KANBAN_COLUMNS.map((column) => {
            const items = columnData[column.key] || [];
            if (items.length === 0) return null;
            return (
              <Box key={column.key} sx={{ borderBottom: '1px solid', borderColor: ui.borderSoft, py: 0.85 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.55, px: 1.35 }}>
                  <Typography sx={{ fontWeight: 900, color: column.color, fontSize: '0.88rem' }}>{column.label}</Typography>
                  <Chip size="small" label={items.length} sx={{ height: 22, fontWeight: 900, bgcolor: alpha(column.color, 0.12), color: column.color }} />
                </Stack>
                <Stack spacing={0}>
                  {items.map((task) => renderTaskCard(task, column))}
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
    </Box>
  );

  const renderListView = () => (
    isMobile ? renderMobileTaskFeedView() : (
    <Card
      data-testid="tasks-list-view"
      sx={{
        ...getOfficePanelSx(ui),
        height: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <TableContainer sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Table stickyHeader size="small" aria-label="Список задач">
          <TableHead>
            <TableRow>
              {['Название', 'Активность', 'Крайний срок', 'Постановщик', 'Исполнитель', 'Проект', 'Теги'].map((label) => (
                <TableCell
                  key={label}
                  sx={{
                    bgcolor: ui.panelSolid,
                    color: ui.subtleText,
                    fontWeight: 900,
                    fontSize: '0.75rem',
                    borderColor: ui.borderSoft,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && visibleTaskItems.length === 0 ? (
              [0, 1, 2, 3].map((item) => (
                <TableRow key={item}>
                  <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft }}>
                    <Skeleton variant="rounded" height={34} sx={{ borderRadius: '10px' }} />
                  </TableCell>
                </TableRow>
              ))
            ) : visibleTaskItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} sx={{ borderColor: ui.borderSoft }}>
                  <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 2 }) }}>
                    <Typography sx={{ fontWeight: 850 }}>Задачи по текущим фильтрам не найдены.</Typography>
                    <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
                      Смените роль, статус, срок или поисковый запрос.
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            ) : visibleTaskItems.map((task) => {
              const projectLabel = task?.project_name
                || activeTaskProjects.find((project) => String(project?.id || '') === String(task?.project_id || ''))?.name
                || '-';
              return (
                <TableRow
                  key={task.id}
                  hover
                  data-testid={`tasks-list-row-${task.id}`}
                  onClick={() => openTaskDetails(task)}
                  sx={{
                    cursor: 'pointer',
                    '&:hover td': { bgcolor: ui.actionHover },
                  }}
                >
                  <TableCell sx={{ minWidth: 260, borderColor: ui.borderSoft }}>
                    <Typography sx={{ fontWeight: 850, lineHeight: 1.25 }}>{task?.title || '-'}</Typography>
                    {task?.description ? (
                      <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2, maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {task.description}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell sx={{ minWidth: 150, borderColor: ui.borderSoft }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatShortDate(task?.updated_at || task?.created_at) || '-'}</Typography>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>
                      {Number(task?.comments_count || 0)} комм. · {Number(task?.attachments_count || 0)} файл.
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 140, borderColor: ui.borderSoft }}>
                    <Typography variant="body2" sx={{ fontWeight: 800, color: task?.is_overdue ? '#dc2626' : 'text.primary' }}>
                      {task?.due_at ? formatDateTime(task.due_at) : 'Без срока'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 160, borderColor: ui.borderSoft }}>{task?.created_by_full_name || task?.created_by_username || '-'}</TableCell>
                  <TableCell sx={{ minWidth: 160, borderColor: ui.borderSoft }}>{task?.assignee_full_name || task?.assignee_username || '-'}</TableCell>
                  <TableCell sx={{ minWidth: 150, borderColor: ui.borderSoft }}>{projectLabel}</TableCell>
                  <TableCell sx={{ minWidth: 260, borderColor: ui.borderSoft }}>{renderTaskTags(task)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Card>
    )
  );

  const renderBucketColumns = ({ buckets, testId, showCreateButtons = false }) => (
    isMobile ? renderMobileBucketList({ buckets, testId, showCreateButtons }) : (
    <Box
      data-testid={testId}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          md: 'repeat(2, minmax(0, 1fr))',
          xl: `repeat(${Math.min(buckets.length, 7)}, minmax(0, 1fr))`,
        },
        gap: 1,
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {buckets.map((bucket) => (
        <Card
          key={bucket.key}
          sx={{
            ...getOfficePanelSx(ui),
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            height: '100%',
            borderRadius: '16px',
            overflow: 'hidden',
          }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1, py: 0.85, bgcolor: alpha(bucket.color, theme.palette.mode === 'dark' ? 0.12 : 0.08), borderColor: alpha(bucket.color, 0.14) }) }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.6}>
              <Typography sx={{ fontWeight: 900, fontSize: '0.8rem', color: bucket.color, minWidth: 0 }}>
                {bucket.label}
              </Typography>
              <Stack direction="row" spacing={0.35} alignItems="center" sx={{ flexShrink: 0 }}>
                <Chip size="small" label={bucket.items.length} sx={{ height: 22, minWidth: 30, fontWeight: 900, bgcolor: alpha(bucket.color, 0.12), color: bucket.color, border: 'none' }} />
                {showCreateButtons && canCreateTasks ? (
                  <Tooltip title="Создать задачу">
                    <IconButton
                      size="small"
                      aria-label={`Создать задачу: ${bucket.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        openCreateTaskWithPreset({ due_at: bucket.createDueAt });
                      }}
                      sx={{ width: 24, height: 24, color: bucket.color }}
                    >
                      <AddIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                ) : null}
              </Stack>
            </Stack>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 0.85 }}>
            {loading && taskItems.length === 0 ? (
              <Stack spacing={0.8}>
                {[0, 1, 2].map((item) => <Skeleton key={item} variant="rounded" height={94} sx={{ borderRadius: '14px' }} />)}
              </Stack>
            ) : bucket.items.length === 0 ? (
              <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 1.1 }) }}>
                <Typography sx={{ fontWeight: 800 }}>Нет задач.</Typography>
              </Box>
            ) : (
              <Stack spacing={0.8}>
                {bucket.items.map((task) => renderTaskCard(task, bucket))}
              </Stack>
            )}
          </Box>
        </Card>
      ))}
    </Box>
    )
  );

  const renderCalendarView = () => {
    const monthLabel = calendarPayload.monthStart.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    return (
      <Card
        data-testid="tasks-calendar-view"
        sx={{
          ...getOfficePanelSx(ui),
          height: '100%',
          minHeight: 0,
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.1, py: 0.9 }) }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
            <Stack direction="row" spacing={0.7} alignItems="center">
              <CalendarMonthOutlinedIcon sx={{ fontSize: 18, color: theme.palette.primary.main }} />
              <Typography sx={{ fontWeight: 900, textTransform: 'capitalize' }}>{monthLabel}</Typography>
            </Stack>
            <Stack direction="row" spacing={0.6} alignItems="center" justifyContent={{ xs: 'space-between', md: 'flex-end' }}>
              <Button size="small" variant="outlined" onClick={() => shiftCalendarMonth(-1)} sx={{ textTransform: 'none', fontWeight: 800 }}>Назад</Button>
              <Button size="small" variant="outlined" onClick={() => setCalendarMonth(new Date())} sx={{ textTransform: 'none', fontWeight: 800 }}>Сегодня</Button>
              <Button size="small" variant="outlined" onClick={() => shiftCalendarMonth(1)} sx={{ textTransform: 'none', fontWeight: 800 }}>Вперёд</Button>
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  setPageMode('deadlines');
                  setDueState('none');
                }}
                sx={{ textTransform: 'none', fontWeight: 850, whiteSpace: 'nowrap' }}
              >
                Без срока: {calendarPayload.noDueCount}
              </Button>
            </Stack>
          </Stack>
        </Box>
        <Box sx={{ px: 0.8, py: 0.65, borderBottom: '1px solid', borderColor: ui.borderSoft, display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 0.5 }}>
          {weekDays.map((day) => (
            <Typography key={day} variant="caption" sx={{ color: ui.subtleText, fontWeight: 900, textAlign: 'center' }}>{day}</Typography>
          ))}
        </Box>
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 0.8 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(120px, 1fr))', gridAutoRows: 'minmax(104px, 1fr)', gap: 0.55, minWidth: { xs: 840, md: 'auto' }, minHeight: '100%' }}>
            {calendarPayload.days.map((day) => (
              <Box
                key={day.dateKey}
                sx={{
                  border: '1px solid',
                  borderColor: day.isToday ? ui.selectedBorder : ui.borderSoft,
                  bgcolor: day.inMonth ? ui.panelSolid : alpha(ui.panelSolid, 0.45),
                  borderRadius: '10px',
                  p: 0.65,
                  minHeight: 104,
                  overflow: 'hidden',
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.45 }}>
                  <Typography variant="caption" sx={{ fontWeight: 900, color: day.inMonth ? 'text.primary' : ui.subtleText }}>
                    {day.date.getDate()}
                  </Typography>
                  {day.items.length > 0 ? (
                    <Chip size="small" label={day.items.length} sx={{ height: 18, minWidth: 24, fontSize: '0.62rem', fontWeight: 900 }} />
                  ) : null}
                </Stack>
                <Stack spacing={0.35}>
                  {day.items.slice(0, 3).map((task) => {
                    const meta = statusMeta(task?.status);
                    return (
                      <Box
                        key={task.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openTaskDetails(task)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') openTaskDetails(task);
                        }}
                        sx={{
                          borderLeft: '3px solid',
                          borderColor: meta.color,
                          bgcolor: meta.bg,
                          borderRadius: '7px',
                          px: 0.55,
                          py: 0.35,
                          cursor: 'pointer',
                        }}
                      >
                        <Typography variant="caption" sx={{ display: 'block', fontWeight: 800, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {task?.title || '-'}
                        </Typography>
                      </Box>
                    );
                  })}
                  {day.items.length > 3 ? (
                    <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>+{day.items.length - 3}</Typography>
                  ) : null}
                </Stack>
              </Box>
            ))}
          </Box>
        </Box>
      </Card>
    );
  };

  const renderGanttView = () => (
    <Card
      data-testid="tasks-gantt-view"
      sx={{
        ...getOfficePanelSx(ui),
        height: '100%',
        minHeight: 0,
        borderRadius: '16px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.1, py: 0.9 }) }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
          <Box>
            <Typography sx={{ fontWeight: 900 }}>Гант</Typography>
            <Typography variant="caption" sx={{ color: ui.subtleText }}>
              {formatShortDate(ganttPayload.rangeStart)} - {formatShortDate(ganttPayload.rangeEnd)}
            </Typography>
          </Box>
          <Chip size="small" label={`Без срока: ${ganttPayload.noDueItems.length}`} sx={{ alignSelf: { xs: 'flex-start', md: 'center' }, fontWeight: 850 }} />
        </Stack>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1 }}>
        {loading && taskItems.length === 0 ? (
          <Stack spacing={0.8}>
            {[0, 1, 2].map((item) => <Skeleton key={item} variant="rounded" height={50} sx={{ borderRadius: '12px' }} />)}
          </Stack>
        ) : ganttPayload.rows.length === 0 ? (
          <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 2 }) }}>
            <Typography sx={{ fontWeight: 850 }}>Нет задач со сроком для диаграммы.</Typography>
          </Box>
        ) : (
          <Stack spacing={0.65} sx={{ minWidth: { xs: 760, md: 0 } }}>
            {ganttPayload.rows.map((row) => {
              const meta = statusMeta(row.task?.status);
              return (
                <Box
                  key={row.task.id}
                  data-testid={`tasks-gantt-row-${row.task.id}`}
                  onClick={() => openTaskDetails(row.task)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(180px, 260px) minmax(360px, 1fr)',
                    gap: 0.8,
                    alignItems: 'center',
                    cursor: 'pointer',
                    p: 0.55,
                    borderRadius: '10px',
                    '&:hover': { bgcolor: ui.actionHover },
                  }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 850, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.task?.title || '-'}</Typography>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>{row.startKey} - {row.endKey}</Typography>
                  </Box>
                  <Box sx={{ position: 'relative', height: 32, borderRadius: '9px', bgcolor: ui.actionBg, overflow: 'hidden', border: '1px solid', borderColor: ui.borderSoft }}>
                    <Box
                      sx={{
                        position: 'absolute',
                        left: `${row.leftPercent}%`,
                        width: `${row.widthPercent}%`,
                        top: 5,
                        bottom: 5,
                        borderRadius: '7px',
                        bgcolor: alpha(meta.color, 0.22),
                        border: '1px solid',
                        borderColor: alpha(meta.color, 0.42),
                        color: meta.color,
                        display: 'flex',
                        alignItems: 'center',
                        px: 0.8,
                        minWidth: 42,
                      }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.label}</Typography>
                    </Box>
                  </Box>
                </Box>
              );
            })}
          </Stack>
        )}

        {ganttPayload.noDueItems.length > 0 ? (
          <Box sx={{ mt: 1, ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '13px' }) }}>
            <Typography sx={{ fontWeight: 900, mb: 0.65 }}>Без срока</Typography>
            <Stack spacing={0.45}>
              {ganttPayload.noDueItems.map((task) => (
                <Button
                  key={task.id}
                  variant="text"
                  onClick={() => openTaskDetails(task)}
                  sx={{ justifyContent: 'flex-start', textTransform: 'none', fontWeight: 800, px: 0.7 }}
                >
                  {task?.title || '-'}
                </Button>
              ))}
            </Stack>
          </Box>
        ) : null}
      </Box>
    </Card>
  );

  const renderBoardView = () => (
    isMobile ? renderMobileBoardGroups() : (
      <Box
        data-testid="tasks-desktop-kanban"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
          gap: 1.2,
          height: '100%',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {KANBAN_COLUMNS.map((column) => {
          const items = columnData[column.key] || [];
          return (
            <Card
              key={column.key}
              sx={{
                ...getOfficePanelSx(ui),
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                height: '100%',
                borderRadius: '16px',
                overflow: 'hidden',
              }}
            >
              <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.2, py: 0.9, bgcolor: alpha(column.color, theme.palette.mode === 'dark' ? 0.12 : 0.08), borderColor: alpha(column.color, 0.14) }) }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography sx={{ fontWeight: 900, fontSize: '0.84rem', color: column.color }}>
                    {column.label}
                  </Typography>
                  <Chip size="small" label={items.length} sx={{ height: 22, minWidth: 30, fontWeight: 900, bgcolor: alpha(column.color, 0.12), color: column.color, border: 'none' }} />
                </Stack>
              </Box>

              <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', p: 1, pr: 0.8 }}>
                {loading && taskItems.length === 0 ? (
                  <Stack spacing={0.8}>
                    {[0, 1, 2].map((item) => <Skeleton key={item} variant="rounded" height={110} sx={{ borderRadius: '14px' }} />)}
                  </Stack>
                ) : items.length === 0 ? (
                  <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 1.4 }) }}>
                    <Typography sx={{ fontWeight: 800, mb: 0.4 }}>Нет задач в колонке.</Typography>
                    <Typography variant="body2" sx={{ color: ui.mutedText }}>
                      {focusMode !== 'all'
                        ? 'Попробуйте переключить быстрый вид или ослабить фильтры.'
                        : 'Когда появятся подходящие задачи, они окажутся здесь.'}
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={0.85}>
                    {items.map((task) => renderTaskCard(task, column))}
                  </Stack>
                )}
              </Box>
            </Card>
          );
        })}
      </Box>
    )
  );

  const renderTaskDataModeContent = () => {
    if (pageMode === 'deadlines') {
      return renderBucketColumns({ buckets: deadlineBuckets, testId: 'tasks-deadlines-view', showCreateButtons: true });
    }
    if (pageMode === 'calendar') return renderCalendarView();
    if (pageMode === 'gantt') return renderGanttView();
    if (pageMode === 'board') return renderBoardView();
    return renderListView();
  };

  const detailActionMenuItems = useMemo(() => {
    if (!detailsTask) return [];
    const items = [
      { key: 'copy', label: 'Копировать ссылку' },
      canEditTask(detailsTask) ? { key: 'edit', label: 'Редактировать' } : null,
      canDeleteTask(detailsTask) ? { key: 'delete', label: 'Удалить', tone: 'danger' } : null,
    ].filter(Boolean);
    return items;
  }, [canDeleteTask, canEditTask, detailsTask]);

  const detailMobileActionState = useMemo(() => {
    if (!detailsTask) return null;
    return buildMobileTaskActionState(detailsTask, {
      canOpenTransferActUpload: canOpenTransferActUpload(detailsTask),
      canStart: canStartTask(detailsTask),
      canSubmit: canSubmitTask(detailsTask),
      canReview: canReviewTask(detailsTask),
    });
  }, [canReviewTask, canStartTask, canSubmitTask, detailsTask]);

  const detailPrimaryActions = detailsTask ? (
    <TaskPrimaryActions
      task={detailsTask}
      canOpenTransferActUpload={canOpenTransferActUpload(detailsTask)}
      canStartTask={canStartTask(detailsTask)}
      canSubmitTask={canSubmitTask(detailsTask)}
      canReviewTask={canReviewTask(detailsTask)}
      canEditTask={canEditTask(detailsTask)}
      canDeleteTask={canDeleteTask(detailsTask)}
      compactMobile={isMobile}
      onOpenTransferActReminder={openTransferActReminder}
      onStartTask={handleStartTask}
      onOpenSubmitTask={setSubmitTask}
      onOpenReviewTask={setReviewTask}
      onOpenEditTask={openEditTask}
      onDeleteTask={(task) => void handleDeleteTask(task)}
      onCopyLink={() => void handleCopyTaskLink(detailsTask?.id, selectedTaskTab)}
      mobileRail={isMobile}
    />
  ) : null;

  const detailOverviewSections = detailsTask ? (
    <>
      {String(detailsTask.review_comment || '').trim() && (
        <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
          <Typography sx={{ fontWeight: 800, mb: 0.45 }}>Комментарий проверки</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {detailsTask.review_comment}
          </Typography>
        </Box>
      )}

      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.3, borderRadius: '14px' }) }}>
        <Typography sx={{ fontWeight: 800, mb: 0.7 }}>Описание задачи</Typography>
        {String(detailsTask.description || '').trim() ? (
          <MarkdownRenderer value={detailsTask.description} />
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Описание задачи не заполнено.
          </Typography>
        )}
      </Box>

      {renderTaskChecklist(detailsTask)}

      {detailsTask.latest_report && (
        <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography sx={{ fontWeight: 800 }}>Последний отчёт</Typography>
              <Typography variant="caption" sx={{ color: ui.subtleText }}>
                {formatDateTime(detailsTask.latest_report.uploaded_at)} · {detailsTask.latest_report.uploaded_by_username || '-'}
              </Typography>
            </Box>
            {detailsTask.latest_report.file_name && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={() => void handleDownloadReport(detailsTask.latest_report)}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
              >
                Скачать
              </Button>
            )}
          </Stack>
          {detailsTask.latest_report.comment && (
            <Typography variant="body2" sx={{ mt: 0.8, whiteSpace: 'pre-wrap' }}>
              {detailsTask.latest_report.comment}
            </Typography>
          )}
        </Box>
      )}
    </>
  ) : null;

  const detailWorkspace = detailsOpen ? (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <TaskDetailHeader
        task={detailsTask}
        statusMeta={statusMeta(detailsTask?.status)}
        priorityMeta={priorityMeta(detailsTask?.priority)}
        transferLabel={getTransferActReminderLabel(detailsTask)}
        isTransferReminder={isTransferActUploadTask(detailsTask)}
        mobileTitle={selectedMobileTaskView === 'checklist' ? 'Чек-лист' : 'Задача'}
        onBack={isMobile && selectedMobileTaskView === 'checklist' ? closeMobileTaskChecklist : closeTaskDetails}
        onCopyLink={() => void handleCopyTaskLink(detailsTask?.id, selectedTaskTab)}
        mobile={isMobile}
        actionMenuItems={detailActionMenuItems}
        onActionMenuSelect={(key) => {
          if (key === 'edit') {
            openEditTask(detailsTask);
            return;
          }
          if (key === 'delete') {
            void handleDeleteTask(detailsTask);
            return;
          }
          if (key === 'copy') {
            void handleCopyTaskLink(detailsTask?.id, selectedTaskTab);
          }
        }}
        ui={ui}
        theme={theme}
      />

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: isMobile ? 0 : { xs: 1, md: 1.25 },
          py: isMobile ? 0 : 1.1,
          bgcolor: isMobile && theme.palette.mode === 'dark' ? '#0b0b0c' : undefined,
          ...(isMobile ? hideMobileScrollbarSx : {}),
        }}
      >
        {detailsLoading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
        {detailsTask ? (
          isMobile ? (
            selectedMobileTaskView === 'checklist' ? (
              <TaskMobileChecklistScreen
                task={detailsTask}
                canUpdate={canUpdateTaskChecklist(detailsTask)}
                onToggleItem={(itemId, done) => void handleToggleTaskChecklistItem(detailsTask, itemId, done)}
                onAddItem={(text) => void handleAddTaskChecklistItem(detailsTask, text)}
                ui={ui}
                theme={theme}
              />
            ) : (
              <TaskMobileDetailScreen
                task={detailsTask}
                attachments={Array.isArray(detailsTask.attachments) ? detailsTask.attachments : []}
                canUploadFiles={canUploadFiles(detailsTask)}
                uploadingAttachment={uploadingAttachment}
                onUploadAttachment={(file) => void handleUploadAttachment(detailsTask.id, file)}
                onDownloadAttachment={(attachment) => void handleDownloadAttachment(detailsTask, attachment)}
                onDownloadReport={(report) => void handleDownloadReport(report)}
                onOpenChecklist={openMobileTaskChecklist}
                taskDiscussionEnabled={taskDiscussionChatEnabled}
                onOpenTaskDiscussion={() => void handleOpenTaskDiscussion(detailsTask)}
                discussionOpening={discussionOpening}
                formatDateTime={formatDateTime}
                formatFileSize={formatFileSize}
                ui={ui}
                theme={theme}
                actions={detailPrimaryActions}
              />
            )
          ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.35fr) minmax(300px, 360px)' },
              gap: 1.25,
              alignItems: 'start',
            }}
          >
            <Stack spacing={1.25} sx={{ minWidth: 0 }}>
              {String(detailsTask.review_comment || '').trim() && (
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.45 }}>Комментарий проверки</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {detailsTask.review_comment}
                  </Typography>
                </Box>
              )}

              <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.3, borderRadius: '14px' }) }}>
                <Typography sx={{ fontWeight: 800, mb: 0.7 }}>Описание задачи</Typography>
                {String(detailsTask.description || '').trim() ? (
                  <MarkdownRenderer value={detailsTask.description} />
                ) : (
                  <Typography variant="body2" sx={{ color: ui.mutedText }}>
                    Описание задачи не заполнено.
                  </Typography>
                )}
              </Box>

              {renderTaskChecklist(detailsTask)}

              {detailsTask.latest_report && (
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Box>
                      <Typography sx={{ fontWeight: 800 }}>Последний отчёт</Typography>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>
                        {formatDateTime(detailsTask.latest_report.uploaded_at)} · {detailsTask.latest_report.uploaded_by_username || '-'}
                      </Typography>
                    </Box>
                    {detailsTask.latest_report.file_name && (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<DownloadIcon />}
                        onClick={() => void handleDownloadReport(detailsTask.latest_report)}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
                      >
                        Скачать
                      </Button>
                    )}
                  </Stack>
                  {detailsTask.latest_report.comment && (
                    <Typography variant="body2" sx={{ mt: 0.8, whiteSpace: 'pre-wrap' }}>
                      {detailsTask.latest_report.comment}
                    </Typography>
                  )}
                </Box>
              )}

              <TaskActivityTabs
                activeTab={selectedTaskTab}
                onTabChange={setTaskDetailTab}
                comments={detailsComments}
                attachments={Array.isArray(detailsTask.attachments) ? detailsTask.attachments : []}
                statusLog={detailsStatusLog}
                commentBody={detailsCommentBody}
                onCommentChange={setDetailsCommentBody}
                onAddComment={() => void handleAddTaskComment()}
                commentSaving={detailsCommentSaving}
                canUploadFiles={canUploadFiles(detailsTask)}
                onUploadAttachment={(file) => void handleUploadAttachment(detailsTask.id, file)}
                uploadingAttachment={uploadingAttachment}
                onDownloadAttachment={(attachment) => void handleDownloadAttachment(detailsTask, attachment)}
                formatDateTime={formatDateTime}
                formatFileSize={formatFileSize}
                getInitials={getInitials}
                statusMeta={statusMeta}
                ui={ui}
                theme={theme}
                taskDiscussionEnabled={taskDiscussionChatEnabled}
                onOpenTaskDiscussion={() => void handleOpenTaskDiscussion(detailsTask)}
                discussionOpening={discussionOpening}
              />
            </Stack>

            <TaskContextSidebar
              task={detailsTask}
              ui={ui}
              theme={theme}
              statusMeta={statusMeta(detailsTask?.status)}
              priorityMeta={priorityMeta(detailsTask?.priority)}
              transferLabel={getTransferActReminderLabel(detailsTask)}
              isTransferReminder={isTransferActUploadTask(detailsTask)}
              formatDateTime={formatDateTime}
              actionState={detailMobileActionState}
              actions={(
                <TaskPrimaryActions
                  task={detailsTask}
                  canOpenTransferActUpload={canOpenTransferActUpload(detailsTask)}
                  canStartTask={canStartTask(detailsTask)}
                  canSubmitTask={canSubmitTask(detailsTask)}
                  canReviewTask={canReviewTask(detailsTask)}
                  canEditTask={canEditTask(detailsTask)}
                  canDeleteTask={canDeleteTask(detailsTask)}
                  onOpenTransferActReminder={openTransferActReminder}
                  onStartTask={handleStartTask}
                  onOpenSubmitTask={setSubmitTask}
                  onOpenReviewTask={setReviewTask}
                  onOpenEditTask={openEditTask}
                  onDeleteTask={(task) => void handleDeleteTask(task)}
                  onCopyLink={() => void handleCopyTaskLink(detailsTask?.id, selectedTaskTab)}
                />
              )}
            />
          </Box>
          )
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            {detailsLoading ? 'Загрузка карточки задачи...' : 'Карточка задачи недоступна.'}
          </Typography>
        )}
      </Box>
    </Box>
  ) : null;

  const mobileHeaderMenuItems = [
    canWriteTasks ? { key: 'taxonomy', label: 'Справочники' } : null,
  ].filter(Boolean);

  const boardSummaryItems = [
    { key: 'open', label: 'Открыто', value: openTasksCount, color: '#2563eb' },
    { key: 'review', label: 'Проверка', value: focusCounts.review, color: '#7c3aed' },
    { key: 'overdue', label: 'Просрочено', value: focusCounts.overdue, color: '#dc2626' },
    { key: 'comments', label: 'Комментарии', value: focusCounts.comments, color: '#059669' },
  ];

  const boardFiltersContent = (
    <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1, borderRadius: '14px' }) }}>
      <Grid container spacing={1.1}>
        <Grid item xs={12} md={4}>
          <TextField
            fullWidth
            size="small"
            label="Поиск по задачам"
            value={q}
            inputRef={isMobile ? undefined : searchInputRef}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Заголовок, комментарий, участник..."
            InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, color: ui.subtleText, mr: 0.8 }} /> }}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="tasks-status-filter-label">Статус</InputLabel>
            <Select labelId="tasks-status-filter-label" label="Статус" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {statusOptions.map((item) => <MenuItem key={item.value || 'all'} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="tasks-due-filter-label">Срок</InputLabel>
            <Select labelId="tasks-due-filter-label" label="Срок" value={dueState} onChange={(event) => setDueState(event.target.value)}>
              {dueStateOptions.map((item) => <MenuItem key={item.value || 'all'} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            fullWidth
            size="small"
            options={departments}
            value={selectedBoardDepartment}
            onChange={(_, value) => setDepartmentFilter(String(value?.id || ''))}
            getOptionLabel={getDepartmentLabel}
            isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
            clearOnEscape
            renderInput={(params) => (
              <TextField
                {...params}
                label="Отдел"
                placeholder="Любой отдел"
              />
            )}
            noOptionsText="Ничего не найдено"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            fullWidth
            size="small"
            options={assignees}
            value={selectedBoardAssignee}
            onChange={(_, value) => setAssigneeFilter(String(value?.id || ''))}
            getOptionLabel={getTaskUserLabel}
            filterOptions={filterTaskUserOptions}
            isOptionEqualToValue={areSameTaskUsers}
            clearOnEscape
            renderInput={(params) => (
              <TextField
                {...params}
                label="Исполнитель"
                placeholder="Фамилия или логин"
              />
            )}
            noOptionsText="Ничего не найдено"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Autocomplete
            fullWidth
            size="small"
            options={controllers}
            value={selectedBoardController}
            onChange={(_, value) => setControllerFilter(String(value?.id || ''))}
            getOptionLabel={getTaskUserLabel}
            filterOptions={filterTaskUserOptions}
            isOptionEqualToValue={areSameTaskUsers}
            clearOnEscape
            renderInput={(params) => (
              <TextField
                {...params}
                label="Контролёр"
                placeholder="Фамилия или логин"
              />
            )}
            noOptionsText="Ничего не найдено"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <FormControlLabel control={<Checkbox checked={hasAttachments} onChange={(event) => setHasAttachments(event.target.checked)} />} label="С файлами" />
        </Grid>
        <Grid item xs={12} sm={6} md={2.6}>
          <FormControlLabel control={<Checkbox checked={unreadCommentsOnly} onChange={(event) => setUnreadCommentsOnly(event.target.checked)} />} label="Есть новые комментарии" />
        </Grid>
        <Grid item xs={12} md={7}>
          <Typography variant="caption" sx={{ color: ui.subtleText }}>
            Фильтры и текущая карточка синхронизируются с URL, поэтому состояние страницы можно открыть по ссылке.
          </Typography>
        </Grid>
        <Grid item xs={12} md={5} sx={{ display: 'flex', justifyContent: { xs: 'stretch', md: 'flex-end' } }}>
          <Button variant="outlined" onClick={resetFilters} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', minWidth: 180 }}>
            Сбросить фильтры
          </Button>
        </Grid>
      </Grid>
    </Box>
  );

  const analyticsFiltersContent = (
    <Stack spacing={0.8}>
      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.85, borderRadius: '13px' }) }}>
        <Typography sx={{ fontWeight: 800, mb: 0.65 }}>Период отчёта</Typography>
        <Grid container spacing={1}>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-preset-label">Период</InputLabel>
              <Select
                labelId="analytics-preset-label"
                label="Период"
                value={analyticsFilters.preset}
                onChange={(event) => {
                  const preset = event.target.value;
                  const range = buildAnalyticsRangeFromPreset(preset);
                  setAnalyticsFilters((prev) => ({ ...prev, preset, ...range }));
                }}
              >
                {analyticsPresetOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-date-basis-label">База дат</InputLabel>
              <Select
                labelId="analytics-date-basis-label"
                label="База дат"
                value={analyticsFilters.date_basis}
                onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, date_basis: event.target.value }))}
              >
                {analyticsDateBasisOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Дата с"
              value={analyticsFilters.start_date}
              onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, preset: 'custom', start_date: event.target.value }))}
              InputLabelProps={{ shrink: true }}
              sx={analyticsFilterFieldSx}
            />
          </Grid>
          <Grid item xs={12} md={3}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Дата по"
              value={analyticsFilters.end_date}
              onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, preset: 'custom', end_date: event.target.value }))}
              InputLabelProps={{ shrink: true }}
              sx={analyticsFilterFieldSx}
            />
          </Grid>
        </Grid>
      </Box>

      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.85, borderRadius: '13px' }) }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8} sx={{ mb: 0.75 }}>
          <Box>
            <Typography sx={{ fontWeight: 800 }}>Срез отчёта</Typography>
            <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
              Выберите проект, затем при необходимости объект. Участник дополнительно сузит отчёт до конкретного исполнителя.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            onClick={() => setAnalyticsFilters((prev) => ({ ...prev, project_ids: [], object_ids: [], participant_user_id: '' }))}
            sx={{ alignSelf: { xs: 'stretch', md: 'flex-start' }, textTransform: 'none', fontWeight: 800 }}
          >
            Сбросить срез
          </Button>
        </Stack>

        <Grid container spacing={1}>
          <Grid item xs={12} lg={5}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-projects-label">Проекты</InputLabel>
              <Select
                multiple
                labelId="analytics-projects-label"
                label="Проекты"
                value={analyticsFilters.project_ids}
                onChange={(event) => setAnalyticsFilters((prev) => ({
                  ...prev,
                  project_ids: Array.isArray(event.target.value) ? event.target.value : [],
                  object_ids: [],
                }))}
                renderValue={(selected) => {
                  const ids = Array.isArray(selected) ? selected : [];
                  if (ids.length === 0) return 'Все проекты';
                  return ids
                    .map((value) => activeTaskProjects.find((item) => String(item.id) === String(value))?.name)
                    .filter(Boolean)
                    .join(', ');
                }}
              >
                {activeTaskProjects.map((item) => (
                  <MenuItem key={item.id} value={String(item.id)}>
                    <Checkbox checked={analyticsFilters.project_ids.includes(String(item.id))} />
                    <Typography>{item.name}</Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} lg={4}>
            <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
              <InputLabel id="analytics-objects-label">Объекты</InputLabel>
              <Select
                multiple
                labelId="analytics-objects-label"
                label="Объекты"
                value={analyticsFilters.object_ids}
                onChange={(event) => setAnalyticsFilters((prev) => ({
                  ...prev,
                  object_ids: Array.isArray(event.target.value) ? event.target.value : [],
                }))}
                renderValue={(selected) => {
                  const ids = Array.isArray(selected) ? selected : [];
                  if (ids.length === 0) return 'Все объекты';
                  return ids
                    .map((value) => activeTaskObjects.find((item) => String(item.id) === String(value))?.name)
                    .filter(Boolean)
                    .join(', ');
                }}
              >
                {analyticsObjectOptions.map((item) => (
                  <MenuItem key={item.id} value={String(item.id)}>
                    <Checkbox checked={analyticsFilters.object_ids.includes(String(item.id))} />
                    <Typography>{item.name}</Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} lg={3}>
            <Autocomplete
              fullWidth
              size="small"
              options={assignees}
              value={selectedAnalyticsParticipantOption}
              onChange={(_, value) => setAnalyticsFilters((prev) => ({
                ...prev,
                participant_user_id: String(value?.id || ''),
              }))}
              getOptionLabel={getTaskUserLabel}
              filterOptions={filterTaskUserOptions}
              isOptionEqualToValue={areSameTaskUsers}
              clearOnEscape
              noOptionsText="Ничего не найдено"
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Участник"
                  placeholder="Фамилия или логин"
                  sx={analyticsFilterFieldSx}
                  inputProps={{
                    ...params.inputProps,
                    'data-testid': 'analytics-participant-select',
                  }}
                />
              )}
            />
          </Grid>
        </Grid>
      </Box>

      <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.8, borderRadius: '13px' }) }}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
          <Box>
            <Typography sx={{ fontWeight: 800 }}>{analyticsFocusMeta.title}</Typography>
            <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
              {analyticsFocusMeta.description}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
            {analyticsFocusMeta.chips.length > 0 ? analyticsFocusMeta.chips.map((item) => (
              <Chip
                key={item.key}
                size="small"
                label={item.label}
                sx={{ height: 24, fontWeight: 800, bgcolor: item.bg, color: item.color }}
              />
            )) : (
              <Chip
                size="small"
                label="Все проекты и объекты"
                sx={{ height: 24, fontWeight: 800, bgcolor: alpha(analyticsAccentColor, 0.12), color: analyticsAccentColor }}
              />
            )}
            {selectedAnalyticsParticipant ? (
              <Chip
                size="small"
                label={`Участник: ${selectedAnalyticsParticipant.participant_name || 'Не назначен'}`}
                sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#7c3aed', 0.12), color: '#7c3aed' }}
              />
            ) : null}
          </Stack>
        </Stack>
      </Box>
    </Stack>
  );

  const mobileTasksCopy = {
    tasksTitle: 'Задачи',
    analyticsTitle: 'Аналитика',
    feedTitle: 'Лента',
    listSuffix: 'задач в ленте',
    boardHint: 'Откройте карточку, чтобы увидеть детали, файлы и обсуждение.',
    analyticsHint: 'Фильтры аналитики и экспорт спрятаны в «Ещё».',
    drawerTitle: 'Ещё и фильтры',
    drawerBoardSubtitle: 'Режимы, роли, статусы и расширенные фильтры.',
    drawerAnalyticsSubtitle: 'Навигация, фильтры и экспорт аналитики.',
    closeDrawer: 'Закрыть меню задач',
    refresh: 'Обновить',
    taxonomy: 'Справочники',
    listView: 'Роль',
    all: 'Все',
    assignee: 'Исполняю',
    department: 'Отдел',
    creator: 'Созданные',
    controller: 'На контроле',
    status: 'Статус',
    focus: 'Фокус',
    advancedFilters: 'Расширенные фильтры',
    analyticsFilters: 'Фильтры аналитики',
    resetFilters: 'Сбросить фильтры',
    closeMenu: 'Закрыть меню',
    openMenu: 'Открыть ещё и фильтры',
    filtersChip: 'Фильтры',
    search: 'Поиск',
    searchPlaceholder: 'Заголовок, комментарий, участник...',
  };

  const mobileModeLabel = pageMode === 'list' ? mobileTasksCopy.feedTitle : activeTaskModeMeta.label;
  const mobileBottomMode = ['list', 'deadlines', 'board'].includes(pageMode) ? pageMode : 'more';
  const mobilePrimaryModeOptions = useMemo(() => [
    { value: 'list', label: mobileTasksCopy.feedTitle, icon: AssignmentIcon },
    { value: 'deadlines', label: 'Сроки', icon: CalendarMonthOutlinedIcon },
    { value: 'board', label: 'Доска', icon: ChecklistOutlinedIcon },
  ], [mobileTasksCopy.feedTitle]);
  const mobileMoreModeOptions = [
    { value: 'calendar', label: 'Календарь', icon: CalendarMonthOutlinedIcon },
    { value: 'gantt', label: 'Гант', icon: AssignmentIcon },
    { value: 'analytics', label: 'Аналитика', icon: TuneOutlinedIcon },
  ];

  const mobileHeaderSubtitleSafe = isTaskDataMode
    ? `${visibleTaskItems.length} ${mobileTasksCopy.listSuffix}`
    : analyticsFocusMeta.title;

  const mobileHeaderHintSafe = isTaskDataMode
    ? (activeFilterCount
      ? `\u041f\u0440\u0438\u043c\u0435\u043d\u0435\u043d\u043e ${mobileTasksCopy.filtersChip.toLowerCase()}: ${activeFilterCount}. \u041e\u0441\u0442\u0430\u043b\u044c\u043d\u044b\u0435 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0441\u043f\u0440\u044f\u0442\u0430\u043d\u044b \u0432 \u043c\u0435\u043d\u044e.`
      : mobileTasksCopy.boardHint)
    : mobileTasksCopy.analyticsHint;

  const mobileNavigationDrawerSafe = isMobile ? (
    <Drawer
      anchor="bottom"
      open={mobileBoardFiltersOpen}
      onClose={() => setMobileBoardFiltersOpen(false)}
      PaperProps={{
        sx: {
          width: '100%',
          maxHeight: '88dvh',
          bgcolor: ui.pageBg,
          backgroundImage: 'none',
          borderTopLeftRadius: '18px',
          borderTopRightRadius: '18px',
          borderTop: '1px solid',
          borderColor: ui.borderSoft,
          overflow: 'hidden',
        },
      }}
    >
      <Box data-testid="tasks-mobile-navigation-drawer" sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.15, py: 1.05 }), borderBottom: '1px solid', borderColor: ui.borderSoft }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, fontSize: '1rem', lineHeight: 1.1 }}>{mobileTasksCopy.drawerTitle}</Typography>
              <Typography variant="caption" sx={{ color: ui.mutedText, display: 'block', mt: 0.25 }}>
                {isTaskDataMode ? mobileTasksCopy.drawerBoardSubtitle : mobileTasksCopy.drawerAnalyticsSubtitle}
              </Typography>
            </Box>
            <IconButton
              data-testid="tasks-mobile-close-navigation"
              aria-label={mobileTasksCopy.closeDrawer}
              onClick={() => setMobileBoardFiltersOpen(false)}
              sx={{
                width: 34,
                height: 34,
                borderRadius: '10px',
                border: '1px solid',
                borderColor: ui.actionBorder,
                bgcolor: ui.actionBg,
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1, py: 1 }}>
          <Stack spacing={1}>
            <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.8, borderRadius: '13px' }) }}>
              <Typography sx={{ fontWeight: 800, mb: 0.65 }}>Дополнительные режимы</Typography>
              <Stack direction="row" spacing={0.65} sx={{ overflowX: 'auto', pb: 0.1 }}>
                {mobileMoreModeOptions.map((option) => {
                  const IconComponent = option.icon;
                  const selected = pageMode === option.value;
                  return (
                    <Button
                      key={option.value}
                      variant={selected ? 'contained' : 'outlined'}
                      size="small"
                      startIcon={<IconComponent sx={{ fontSize: 17 }} />}
                      onClick={() => {
                        setPageMode(option.value);
                        setMobileBoardFiltersOpen(false);
                      }}
                      sx={{ flexShrink: 0, textTransform: 'none', fontWeight: 850, borderRadius: '10px', boxShadow: 'none' }}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </Stack>
            </Box>

            {isTaskDataMode ? (
              <>
                <Stack direction="row" spacing={0.75}>
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={() => {
                      setMobileBoardFiltersOpen(false);
                      void loadTasks();
                    }}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                  >
                    {mobileTasksCopy.refresh}
                  </Button>
                </Stack>

                {canWriteTasks ? (
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      setTaxonomyOpen(true);
                      setMobileBoardFiltersOpen(false);
                    }}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                  >
                    {mobileTasksCopy.taxonomy}
                  </Button>
                ) : null}

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.75, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.65 }}>Дополнительные роли</Typography>
                  <Tabs
                    value={secondaryViewMode || false}
                    onChange={(_, value) => {
                      if (!value) return;
                      setViewMode(value);
                      setMobileBoardFiltersOpen(false);
                    }}
                    variant="scrollable"
                    allowScrollButtonsMobile
                    sx={{
                      minHeight: 38,
                      '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, minHeight: 38, fontSize: '0.8rem' },
                      '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
                    }}
                  >
                    {canManageAllTasks && <Tab value="all" label={mobileTasksCopy.all} />}
                    <Tab value="department" label={mobileTasksCopy.department} />
                    {canUseControllerTab && <Tab value="controller" label={mobileTasksCopy.controller} />}
                  </Tabs>
                </Box>

                <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', pb: 0.1 }}>
                  {boardSummaryItems.map((item) => (
                    <Chip
                      key={item.key}
                      label={`${item.label}: ${item.value}`}
                      sx={{
                        flexShrink: 0,
                        height: 26,
                        fontWeight: 800,
                        bgcolor: alpha(item.color, 0.12),
                        color: item.color,
                      }}
                    />
                  ))}
                </Stack>

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.75, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.65 }}>{mobileTasksCopy.status}</Typography>
                  <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', pb: 0.2 }}>
                    {mobileStatusOptions.map((option) => (
                      <Chip
                        key={option.value || 'all'}
                        data-testid={`tasks-mobile-status-${option.value || 'all'}`}
                        clickable
                        label={option.label}
                        onClick={() => {
                          setStatusFilter(option.value);
                          setMobileBoardFiltersOpen(false);
                        }}
                        sx={{
                          flexShrink: 0,
                          height: 28,
                          fontWeight: 800,
                          border: '1px solid',
                          borderColor: statusFilter === option.value ? ui.selectedBorder : ui.actionBorder,
                          bgcolor: statusFilter === option.value ? ui.selectedBg : ui.actionBg,
                          color: statusFilter === option.value ? theme.palette.primary.main : 'text.primary',
                        }}
                      />
                    ))}
                  </Stack>
                </Box>

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.75, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 0.65 }}>{mobileTasksCopy.focus}</Typography>
                  <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto' }}>
                    {focusOptions.map((option) => (
                      <Chip
                        key={option.value}
                        clickable
                        label={`${option.label}: ${focusCounts[option.value] || 0}`}
                        onClick={() => {
                          setFocusMode(option.value);
                          setMobileBoardFiltersOpen(false);
                        }}
                        sx={{
                          flexShrink: 0,
                          height: 26,
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          border: '1px solid',
                          borderColor: focusMode === option.value ? ui.selectedBorder : ui.actionBorder,
                          bgcolor: focusMode === option.value ? ui.selectedBg : ui.actionBg,
                          color: focusMode === option.value ? theme.palette.primary.main : 'text.primary',
                        }}
                      />
                    ))}
                  </Stack>
                </Box>

                <Box>
                  <Typography sx={{ fontWeight: 800, mb: 0.6 }}>{mobileTasksCopy.advancedFilters}</Typography>
                  {boardFiltersContent}
                </Box>
              </>
            ) : (
              <>
                <Stack direction="row" spacing={0.75}>
                  <Button
                    fullWidth
                    size="small"
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={() => {
                      setMobileBoardFiltersOpen(false);
                      void loadTaskAnalytics();
                    }}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                  >
                    {mobileTasksCopy.refresh}
                  </Button>
                  <Button
                    fullWidth
                    variant="contained"
                    size="small"
                    startIcon={<DownloadIcon />}
                    onClick={() => void handleExportTaskAnalytics()}
                    disabled={analyticsLoading || analyticsExporting}
                    sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                  >
                    {analyticsExporting ? 'Export...' : 'Excel'}
                  </Button>
                </Stack>

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.8, borderRadius: '13px' }) }}>
                  <Typography sx={{ fontWeight: 800 }}>{analyticsFocusMeta.title}</Typography>
                  <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.25 }}>
                    {analyticsFocusMeta.description}
                  </Typography>
                  {analyticsFocusMeta.chips?.length ? (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.75, overflowX: 'auto' }}>
                      {analyticsFocusMeta.chips.map((chip) => (
                        <Chip
                          key={chip.key}
                          label={chip.label}
                          sx={{
                            flexShrink: 0,
                            height: 24,
                            fontWeight: 700,
                            bgcolor: chip.bg,
                            color: chip.color,
                          }}
                        />
                      ))}
                    </Stack>
                  ) : null}
                </Box>

                <Box>
                  <Typography sx={{ fontWeight: 800, mb: 0.6 }}>{mobileTasksCopy.analyticsFilters}</Typography>
                  {analyticsFiltersContent}
                </Box>
              </>
            )}
          </Stack>
        </Box>

        <Box
          sx={{
            px: 1,
            py: 1,
            borderTop: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.pageBg,
            pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
          }}
        >
          <Stack spacing={0.75}>
            {isTaskDataMode ? (
              <Button
                fullWidth
                variant="outlined"
                onClick={() => {
                  resetFilters();
                  setMobileBoardFiltersOpen(false);
                }}
                sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
              >
                {mobileTasksCopy.resetFilters}
              </Button>
            ) : null}
            <Button fullWidth onClick={() => setMobileBoardFiltersOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>
              {mobileTasksCopy.closeMenu}
            </Button>
          </Stack>
        </Box>
      </Box>
    </Drawer>
  ) : null;

  const createMobileSheetTitle = ({
    description: 'Описание задачи',
    assignees: 'Исполнители',
    priority: 'Приоритет',
    files: 'Файлы',
    checklist: 'Чек-лист',
    project: 'Проект',
    controller: 'Контролёр',
    advanced: 'Полная форма',
  })[createMobileSheet] || '';

  const createMobileSheetContent = (() => {
    if (createMobileSheet === 'description') {
      return (
        <MobileCreateDescriptionEditor
          initialValue={createDescriptionRef.current || createDescriptionPreview || createData.description}
          onDraftChange={handleCreateDescriptionDraftChange}
          onDone={handleCloseCreateMobileSheet}
          onAddFiles={handleAddCreateFiles}
          resetKey={`${createOpen ? 'open' : 'closed'}:mobile-description:${createMobileSheet}`}
          ui={ui}
          theme={theme}
        />
      );
    }

    if (createMobileSheet === 'assignees') {
      return (
        <MobileCreateAssigneePicker
          options={assignees}
          selectedIds={createData.assignee_user_ids}
          onChange={handleChangeCreateAssigneeIds}
          onClear={handleClearCreateAssignees}
          onDone={handleCloseCreateMobileSheet}
          ui={ui}
          theme={theme}
        />
      );
    }

    if (createMobileSheet === 'priority') {
      return (
        <Stack spacing={0.35}>
          {priorityOptions.map((item) => {
            const selected = createData.priority === item.value;
            return (
              <Button
                key={item.value}
                data-testid={`create-priority-mobile-${item.value}`}
                onClick={() => {
                  setCreateData((prev) => ({ ...prev, priority: item.value }));
                  setCreateOptionalSections((prev) => ({ ...prev, priority: item.value !== 'normal' }));
                  setCreateMobileSheet('');
                }}
                sx={{
                  minHeight: 56,
                  justifyContent: 'space-between',
                  textTransform: 'none',
                  color: ui.text,
                  borderRadius: '14px',
                  bgcolor: selected ? alpha(item.dotColor, 0.16) : 'transparent',
                  '&:hover': { bgcolor: selected ? alpha(item.dotColor, 0.2) : ui.actionHover },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 9, height: 9, borderRadius: '999px', bgcolor: item.dotColor }} />
                  <Typography sx={{ fontWeight: 900 }}>{item.label}</Typography>
                </Stack>
                {selected ? <CheckIcon sx={{ color: item.dotColor }} /> : null}
              </Button>
            );
          })}
        </Stack>
      );
    }

    if (createMobileSheet === 'files') {
      return (
        <Stack spacing={1}>
          <Button
            component="label"
            variant="outlined"
            startIcon={<AttachFileIcon />}
            disabled={createSaving}
            sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px' }}
          >
            {createFiles.length > 0 ? 'Добавить файлы' : 'Выбрать файлы'}
            <input
              type="file"
              hidden
              multiple
              onChange={(event) => {
                handleAddCreateFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </Button>
          {createFiles.length === 0 ? (
            <Typography variant="body2" sx={{ color: ui.mutedText }}>
              Файлы прикрепятся автоматически после создания задачи.
            </Typography>
          ) : (
            <Stack spacing={0.7}>
              {createFiles.map((file, index) => (
                <Box key={`${getFileIdentity(file)}:${index}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.75, borderRadius: '12px', bgcolor: ui.actionBg }}>
                  <Avatar sx={{ width: 30, height: 30, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                    <AttachFileIcon sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontWeight: 850, fontSize: '0.88rem' }} noWrap>
                      {file?.name || 'file'}
                    </Typography>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>
                      {formatFileSize(file?.size)}
                    </Typography>
                  </Box>
                  <IconButton size="small" aria-label={`Убрать файл ${file?.name || index + 1}`} onClick={() => handleRemoveCreateFile(index)} disabled={createSaving}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Stack>
          )}
          <Button onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 800 }}>
            Готово
          </Button>
        </Stack>
      );
    }

    if (createMobileSheet === 'checklist') {
      return (
        <Stack spacing={1}>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={handleAddChecklistItem} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px' }}>
            Добавить пункт
          </Button>
          <Stack spacing={0.8}>
            {createChecklistItems.map((item, index) => (
              <Stack key={item.id} direction="row" spacing={0.7} alignItems="center">
                <Checkbox checked={Boolean(item.done)} onChange={(event) => handleUpdateChecklistItem(item.id, { done: event.target.checked })} sx={{ p: 0.35 }} />
                <TextField
                  value={item.text}
                  onChange={(event) => handleUpdateChecklistItem(item.id, { text: event.target.value })}
                  placeholder={`Пункт ${index + 1}`}
                  size="small"
                  fullWidth
                />
                <IconButton size="small" aria-label={`Удалить пункт ${index + 1}`} onClick={() => handleRemoveChecklistItem(item.id)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
          <Button variant="contained" onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}>
            Готово
          </Button>
        </Stack>
      );
    }

    if (createMobileSheet === 'project') {
      return (
        <Stack spacing={1}>
          <FormControl fullWidth size="small">
            <InputLabel id="create-project-mobile-label">Проект</InputLabel>
            <Select
              labelId="create-project-mobile-label"
              label="Проект"
              value={effectiveCreateProjectId}
              onChange={(event) => setCreateData((prev) => ({ ...prev, project_id: String(event.target.value || ''), object_id: '' }))}
            >
              {activeTaskProjects.map((item) => (
                <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack direction="row" spacing={0.8}>
            <TextField label="Новый проект" value={createProjectName} onChange={(event) => setCreateProjectName(event.target.value)} size="small" fullWidth />
            <Button variant="outlined" onClick={() => void handleCreateProjectFromTaskDialog()} disabled={createProjectSaving || String(createProjectName || '').trim().length < 2} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '10px' }}>
              {createProjectSaving ? '...' : 'Добавить'}
            </Button>
          </Stack>
          <Button variant="contained" onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}>
            Готово
          </Button>
        </Stack>
      );
    }

    if (createMobileSheet === 'controller') {
      return (
        <Stack spacing={1}>
          <Autocomplete
            fullWidth
            size="small"
            options={controllers}
            value={selectedCreateController}
            onChange={(_, value) => setCreateData((prev) => ({ ...prev, controller_user_id: String(value?.id || '') }))}
            getOptionLabel={getTaskUserLabel}
            filterOptions={filterTaskUserOptions}
            isOptionEqualToValue={areSameTaskUsers}
            clearOnEscape
            noOptionsText="Ничего не найдено"
            renderInput={(params) => <TextField {...params} label="Контролёр" placeholder="Фамилия или логин" />}
          />
          <Button variant="contained" onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}>
            Готово
          </Button>
        </Stack>
      );
    }

    if (createMobileSheet === 'advanced') {
      return (
        <Stack spacing={1.1}>
          <TextField label="Дата постановки задачи" type="date" value={createData.protocol_date} onChange={(event) => setCreateData((prev) => ({ ...prev, protocol_date: event.target.value }))} InputLabelProps={{ shrink: true }} fullWidth size="small" />
          <TextField label="Срок" type="datetime-local" value={createData.due_at} onChange={(event) => setCreateData((prev) => ({ ...prev, due_at: event.target.value }))} InputLabelProps={{ shrink: true }} fullWidth size="small" />
          <FormControl fullWidth size="small">
            <InputLabel id="create-priority-mobile-advanced-label">Приоритет</InputLabel>
            <Select labelId="create-priority-mobile-advanced-label" label="Приоритет" value={createData.priority} onChange={(event) => setCreateData((prev) => ({ ...prev, priority: event.target.value }))}>
              {priorityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth size="small">
            <InputLabel id="create-project-mobile-advanced-label">Проект</InputLabel>
            <Select labelId="create-project-mobile-advanced-label" label="Проект" value={effectiveCreateProjectId} onChange={(event) => setCreateData((prev) => ({ ...prev, project_id: String(event.target.value || ''), object_id: '' }))}>
              {activeTaskProjects.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
            </Select>
          </FormControl>
          <Autocomplete
            fullWidth
            size="small"
            options={controllers}
            value={selectedCreateController}
            onChange={(_, value) => setCreateData((prev) => ({ ...prev, controller_user_id: String(value?.id || '') }))}
            getOptionLabel={getTaskUserLabel}
            filterOptions={filterTaskUserOptions}
            isOptionEqualToValue={areSameTaskUsers}
            renderInput={(params) => <TextField {...params} label="Контролёр" placeholder="Фамилия или логин" />}
          />
          <Autocomplete
            fullWidth
            size="small"
            options={departments}
            value={selectedCreateDepartment}
            onChange={(_, value) => setCreateData((prev) => ({ ...prev, department_id: String(value?.id || ''), visibility_scope: value?.id ? (prev.visibility_scope || 'department') : 'private' }))}
            getOptionLabel={getDepartmentLabel}
            isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
            renderInput={(params) => <TextField {...params} label="Отдел" placeholder="Автоматически по исполнителю" />}
          />
          <FormControl fullWidth size="small">
            <InputLabel id="create-visibility-mobile-advanced-label">Видимость</InputLabel>
            <Select labelId="create-visibility-mobile-advanced-label" label="Видимость" value={createData.visibility_scope} onChange={(event) => setCreateData((prev) => ({ ...prev, visibility_scope: event.target.value }))}>
              {taskVisibilityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Button variant="contained" onClick={handleCloseCreateMobileSheet} sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}>
            Готово
          </Button>
        </Stack>
      );
    }

    return null;
  })();

  const isCreateDescriptionMobileSheet = createMobileSheet === 'description';
  const isCreateTallMobileSheet = createMobileSheet === 'description' || createMobileSheet === 'assignees';

  const mobileTasksHeaderInline = useMemo(() => {
    if (!isMobile || detailsOpen) return null;
    const headerLabel = `${mobileModeLabel} · ${visibleTaskItems.length}`;
    return (
      <Stack
        data-testid="tasks-mobile-header-inline"
        spacing={0.65}
        sx={{
          width: '100%',
          minWidth: 0,
          py: 0.45,
        }}
      >
        <Stack direction="row" spacing={0.45} alignItems="center" sx={{ minWidth: 0 }}>
        {mobileSearchOpen && isTaskDataMode ? (
          <TextField
            fullWidth
            size="small"
            value={q}
            inputRef={searchInputRef}
            onChange={(event) => setQ(event.target.value)}
            placeholder={mobileTasksCopy.searchPlaceholder}
            inputProps={{ 'data-testid': 'tasks-mobile-search-input', 'aria-label': mobileTasksCopy.search }}
            InputProps={{
              startAdornment: <SearchIcon sx={{ fontSize: 16, color: ui.subtleText, mr: 0.55, flexShrink: 0 }} />,
              endAdornment: (
                <IconButton
                  size="small"
                  data-testid="tasks-mobile-close-search"
                  aria-label="Закрыть поиск"
                  onClick={() => setMobileSearchOpen(false)}
                  sx={{ width: 26, height: 26, flexShrink: 0 }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              ),
            }}
            sx={{
              minWidth: 0,
              '& .MuiOutlinedInput-root': {
                minHeight: 34,
                borderRadius: '11px',
                bgcolor: ui.actionBg,
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'transparent',
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'transparent',
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'transparent',
                  borderWidth: 1,
                },
              },
              '& .MuiOutlinedInput-input': {
                py: 0.55,
                fontSize: '0.82rem',
              },
            }}
          />
        ) : (
          <>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                data-testid="tasks-mobile-header-mode"
                sx={{ fontWeight: 900, fontSize: '0.82rem', lineHeight: 1.08, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {headerLabel}
              </Typography>
              {!isTaskDataMode ? (
                <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {mobileHeaderSubtitleSafe}
                </Typography>
              ) : null}
            </Box>
            {isTaskDataMode ? (
              <IconButton
                size="small"
                data-testid="tasks-mobile-open-search"
                aria-label={mobileTasksCopy.search}
                onClick={() => setMobileSearchOpen(true)}
                sx={{
                  width: 34,
                  height: 34,
                  borderRadius: '999px',
                  color: q ? theme.palette.primary.main : ui.mutedText,
                  bgcolor: q ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
                  flexShrink: 0,
                }}
              >
                <SearchIcon fontSize="small" />
              </IconButton>
            ) : null}
          </>
        )}

        <Badge
          color="primary"
          badgeContent={activeFilterCount}
          invisible={!isTaskDataMode || activeFilterCount <= 0}
          overlap="circular"
        >
          <IconButton
            size="small"
            data-testid="tasks-mobile-open-navigation"
            aria-label={mobileTasksCopy.openMenu}
            onClick={() => setMobileBoardFiltersOpen(true)}
            sx={{
              width: 34,
              height: 34,
              borderRadius: '999px',
              color: ui.mutedText,
              bgcolor: activeFilterCount > 0 ? alpha(theme.palette.primary.main, 0.1) : 'transparent',
              flexShrink: 0,
            }}
          >
            <FilterListIcon fontSize="small" />
          </IconButton>
        </Badge>
        <ShellNotificationsButton size="small" />
        </Stack>

        <Stack
          direction="row"
          spacing={0.45}
          data-testid="tasks-mobile-mode-segmented"
          sx={{
            minWidth: 0,
            overflowX: 'auto',
            pb: 0.1,
            ...hideMobileScrollbarSx,
          }}
        >
          {mobilePrimaryModeOptions.map((option) => {
            const IconComponent = option.icon;
            const selected = mobileBottomMode === option.value;
            return (
              <Button
                key={option.value}
                size="small"
                variant={selected ? 'contained' : 'outlined'}
                startIcon={<IconComponent sx={{ fontSize: 15 }} />}
                data-testid={`tasks-mobile-mode-${option.value}`}
                onClick={() => setPageMode(option.value)}
                sx={{
                  flexShrink: 0,
                  minWidth: 0,
                  height: 30,
                  px: 0.85,
                  borderRadius: '999px',
                  textTransform: 'none',
                  fontWeight: 850,
                  fontSize: '0.72rem',
                  boxShadow: 'none',
                }}
              >
                {option.label}
              </Button>
            );
          })}
          <Badge
            color="primary"
            badgeContent={activeFilterCount}
            invisible={!isTaskDataMode || activeFilterCount <= 0}
            overlap="circular"
          >
            <Button
              size="small"
              variant={mobileBottomMode === 'more' ? 'contained' : 'outlined'}
              startIcon={<TuneOutlinedIcon sx={{ fontSize: 15 }} />}
              data-testid="tasks-mobile-open-navigation-segment"
              onClick={() => setMobileBoardFiltersOpen(true)}
              sx={{
                flexShrink: 0,
                minWidth: 0,
                height: 30,
                px: 0.85,
                borderRadius: '999px',
                textTransform: 'none',
                fontWeight: 850,
                fontSize: '0.72rem',
                boxShadow: 'none',
              }}
            >
              Ещё
            </Button>
          </Badge>
        </Stack>

        {isTaskDataMode ? (
          <TaskRoleScopeSwitch
            value={viewMode}
            onChange={handlePersonalRoleChange}
            compact
            fullWidth
            counts={personalRoleCounts}
          />
        ) : null}
      </Stack>
    );
  }, [
    handlePersonalRoleChange,
    isTaskDataMode,
    personalRoleCounts,
    activeFilterCount,
    detailsOpen,
    isMobile,
    mobileBottomMode,
    mobileHeaderSubtitleSafe,
    mobileModeLabel,
    mobilePrimaryModeOptions,
    mobileSearchOpen,
    mobileTasksCopy.openMenu,
    mobileTasksCopy.search,
    mobileTasksCopy.searchPlaceholder,
    q,
    theme.palette.primary.main,
    ui.actionBg,
    ui.mutedText,
    ui.subtleText,
    visibleTaskItems.length,
    viewMode,
  ]);

  return (
    <MainLayout
      mobileBottomNavMode={isMobile && (detailsOpen || createOpen) ? 'hidden' : 'auto'}
      contentMode={isMobile ? 'edge-to-edge-mobile' : 'default'}
    >
      <PageShell
        fullHeight
        sx={{
          bgcolor: ui.pageBg,
        }}
      >
        <Box
          sx={{
            px: { xs: 0, md: 1.25 },
            py: { xs: 0, md: 1 },
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          {loading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
          {error && (
            <Alert severity="error" sx={{ mb: 1.2, borderRadius: '12px' }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {detailsOpen ? (
            detailWorkspace
          ) : (
            <>
          {isMobile ? (
            <>
              {mobileTasksHeaderInline ? (
                <Box sx={{ px: 1, pt: 0.75, pb: 0.35, flexShrink: 0 }}>
                  {mobileTasksHeaderInline}
                </Box>
              ) : null}
              {false ? (
                <>
              <Card data-testid="tasks-mobile-header-legacy" sx={{ ...getOfficePanelSx(ui, { mb: 1, p: 1, borderRadius: '16px', flexShrink: 0 }) }}>
                <Stack spacing={1}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                      <IconButton
                        size="small"
                        data-testid="tasks-mobile-open-navigation-legacy"
                        aria-label="Открыть меню задач"
                        onClick={() => setMobileBoardFiltersOpen(true)}
                        sx={{
                          width: 34,
                          height: 34,
                          borderRadius: '10px',
                          border: '1px solid',
                          borderColor: ui.actionBorder,
                          bgcolor: ui.actionBg,
                          flexShrink: 0,
                        }}
                      >
                        <MenuIcon fontSize="small" />
                      </IconButton>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 900, fontSize: '1rem', lineHeight: 1.1 }}>
                          {pageMode === 'board' ? 'Задачи' : 'Аналитика'}
                        </Typography>
                        <Typography variant="caption" sx={{ color: ui.mutedText, display: 'block', mt: 0.2 }}>
                          {mobileHeaderSubtitleSafe}
                        </Typography>
                      </Box>
                    </Stack>
                    {pageMode === 'board' && activeFilterCount ? (
                      <Chip
                        label={`Фильтры: ${activeFilterCount}`}
                        size="small"
                        sx={{
                          height: 26,
                          fontWeight: 800,
                          borderRadius: '8px',
                          bgcolor: alpha(theme.palette.primary.main, 0.12),
                          color: theme.palette.primary.main,
                          flexShrink: 0,
                        }}
                      />
                    ) : null}
                  </Stack>

                  {pageMode === 'board' ? (
                    <>
                      <TextField
                        fullWidth
                        size="small"
                        label="Поиск"
                        value={q}
                        inputRef={searchInputRef}
                        onChange={(event) => setQ(event.target.value)}
                        placeholder="Заголовок, комментарий, участник..."
                        inputProps={{ 'data-testid': 'tasks-mobile-search-input-legacy' }}
                        InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, color: ui.subtleText, mr: 0.8 }} /> }}
                      />
                      <Typography variant="caption" sx={{ color: ui.subtleText, lineHeight: 1.35 }}>
                        {mobileHeaderHintSafe}
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="caption" sx={{ color: ui.subtleText, lineHeight: 1.35 }}>
                      {mobileHeaderHintSafe}
                    </Typography>
                  )}
                </Stack>
              </Card>
              <Box sx={{ display: 'none' }}>
            <Card data-testid="tasks-mobile-header-legacy-2" sx={{ ...getOfficePanelSx(ui, { mb: 1, p: 1, borderRadius: '16px', flexShrink: 0 }) }}>
              <Stack spacing={1}>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { borderRadius: '12px', px: 0.5 }) }}>
                  <Tabs
                    value={pageMode}
                    onChange={(_, value) => setPageMode(value)}
                    variant="scrollable"
                    allowScrollButtonsMobile
                    sx={{
                      minHeight: 40,
                      '& .MuiTab-root': { textTransform: 'none', fontWeight: 800, minHeight: 40, fontSize: '0.84rem' },
                      '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
                    }}
                  >
                    <Tab value="board" label="Доска задач" />
                    <Tab value="analytics" label="Аналитика" />
                  </Tabs>
                </Box>

                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 900, fontSize: '1rem', lineHeight: 1.1 }}>Задачи</Typography>
                    <Typography variant="caption" sx={{ color: ui.mutedText, display: 'block', mt: 0.2 }}>
                      {pageMode === 'board' ? `${mobileBoardItems.length} задач в мобильной ленте` : analyticsFocusMeta.title}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.4} alignItems="center">
                    <IconButton
                      size="small"
                      aria-label="Обновить задачи"
                      onClick={() => void (pageMode === 'analytics' ? loadTaskAnalytics() : loadTasks())}
                      sx={{
                        width: 34,
                        height: 34,
                        borderRadius: '10px',
                        border: '1px solid',
                        borderColor: ui.actionBorder,
                        bgcolor: ui.actionBg,
                      }}
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                    {canCreateTasks && pageMode === 'board' ? (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<AddIcon />}
                        onClick={() => setCreateOpen(true)}
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                      >
                        Новая
                      </Button>
                    ) : null}
                    {mobileHeaderMenuItems.length > 0 ? (
                      <OverflowMenu
                        label="Дополнительные действия"
                        items={mobileHeaderMenuItems}
                        onSelect={(key) => {
                          if (key === 'taxonomy') setTaxonomyOpen(true);
                        }}
                      />
                    ) : null}
                  </Stack>
                </Stack>

                {pageMode === 'board' ? (
                  <>
                    <TextField
                      fullWidth
                      size="small"
                      label="Поиск"
                      value={q}
                      inputRef={searchInputRef}
                      onChange={(event) => setQ(event.target.value)}
                      placeholder="Заголовок, комментарий, участник..."
                      inputProps={{ 'data-testid': 'tasks-mobile-search-input-legacy-2' }}
                      InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, color: ui.subtleText, mr: 0.8 }} /> }}
                    />

                    <Stack direction="row" spacing={0.6} alignItems="center">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<FilterListIcon />}
                        onClick={() => setMobileBoardFiltersOpen(true)}
                        data-testid="tasks-mobile-open-filters-legacy"
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', whiteSpace: 'nowrap' }}
                      >
                        {`Фильтры${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
                      </Button>
                      <Typography variant="caption" sx={{ color: ui.subtleText, lineHeight: 1.25 }}>
                        `/` и `F` ставят курсор в поиск, `N` открывает создание задачи.
                      </Typography>
                    </Stack>

                    <TaskRoleScopeSwitch
                      value={viewMode}
                      onChange={handlePersonalRoleChange}
                      compact
                      fullWidth
                      counts={personalRoleCounts}
                    />

                    <Box sx={{ ...getOfficeSubtlePanelSx(ui, { borderRadius: '12px', px: 0.5 }) }}>
                      <Tabs
                        value={secondaryViewMode || false}
                        onChange={(_, value) => {
                          if (value) setViewMode(value);
                        }}
                        variant="scrollable"
                        allowScrollButtonsMobile
                        sx={{
                          minHeight: 40,
                          '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, minHeight: 40, fontSize: '0.82rem' },
                          '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
                        }}
                      >
                        {canManageAllTasks && <Tab value="all" label="Все" />}
                        <Tab value="department" label="Отдел" />
                        {canUseControllerTab && <Tab value="controller" label="На контроле" />}
                      </Tabs>
                    </Box>

                    <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', pb: 0.2 }}>
                      {boardSummaryItems.map((item) => (
                        <Chip
                          key={item.key}
                          label={`${item.label}: ${item.value}`}
                          sx={{
                            flexShrink: 0,
                            height: 26,
                            fontWeight: 800,
                            bgcolor: alpha(item.color, 0.12),
                            color: item.color,
                          }}
                        />
                      ))}
                    </Stack>

                    <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', pb: 0.2 }}>
                      {mobileStatusOptions.map((option) => (
                        <Chip
                          key={option.value || 'all'}
                          clickable
                          label={option.label}
                          onClick={() => setStatusFilter(option.value)}
                          sx={{
                            flexShrink: 0,
                            height: 28,
                            fontWeight: 800,
                            border: '1px solid',
                            borderColor: statusFilter === option.value ? ui.selectedBorder : ui.actionBorder,
                            bgcolor: statusFilter === option.value ? ui.selectedBg : ui.actionBg,
                            color: statusFilter === option.value ? theme.palette.primary.main : 'text.primary',
                          }}
                        />
                      ))}
                    </Stack>

                    <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto' }}>
                      {focusOptions.map((option) => (
                        <Chip
                          key={option.value}
                          clickable
                          label={`${option.label}: ${focusCounts[option.value] || 0}`}
                          onClick={() => setFocusMode(option.value)}
                          sx={{
                            flexShrink: 0,
                            height: 26,
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            border: '1px solid',
                            borderColor: focusMode === option.value ? ui.selectedBorder : ui.actionBorder,
                            bgcolor: focusMode === option.value ? ui.selectedBg : ui.actionBg,
                            color: focusMode === option.value ? theme.palette.primary.main : 'text.primary',
                          }}
                        />
                      ))}
                    </Stack>
                  </>
                ) : (
                  <Stack spacing={0.8}>
                    <Stack direction="row" spacing={0.6}>
                      <Button
                        fullWidth
                        size="small"
                        variant="outlined"
                        startIcon={<FilterListIcon />}
                        onClick={toggleAnalyticsFilters}
                        data-testid="tasks-mobile-open-analytics-filters-legacy"
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                      >
                        Фильтры
                      </Button>
                      <Button
                        fullWidth
                        variant="contained"
                        size="small"
                        startIcon={<DownloadIcon />}
                        onClick={handleExportTaskAnalytics}
                        disabled={analyticsLoading || analyticsExporting}
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                      >
                        {analyticsExporting ? 'Экспорт...' : 'Excel'}
                      </Button>
                    </Stack>
                    <Stack direction="row" spacing={0.6} sx={{ overflowX: 'auto', pb: 0.2 }}>
                      {analyticsKpis.slice(0, 4).map((item) => (
                        <Chip
                          key={item.title}
                          label={`${item.title}: ${item.value}`}
                          sx={{
                            flexShrink: 0,
                            height: 28,
                            fontWeight: 800,
                            bgcolor: alpha(item.color, 0.12),
                            color: item.color,
                          }}
                        />
                      ))}
                    </Stack>
                  </Stack>
                )}
              </Stack>
            </Card>
              </Box>
                </>
              ) : null}
            </>
          ) : null}

          {!isMobile ? (
          <Card sx={{ ...getOfficePanelSx(ui, { mb: 0.75, p: 0.65, borderRadius: '14px', flexShrink: 0 }) }}>
            <Stack spacing={0.55}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8} sx={{ minHeight: 34 }}>
                <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" spacing={0.65} alignItems="center" sx={{ flexShrink: 0 }}>
                    <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                      <AssignmentIcon sx={{ fontSize: 17 }} />
                    </Avatar>
                    <Typography sx={{ fontWeight: 900, fontSize: '0.94rem', lineHeight: 1 }}>Задачи</Typography>
                  </Stack>

                  <Box sx={{ ...getOfficeSubtlePanelSx(ui, { borderRadius: '10px', px: 0.35 }), flexShrink: 0 }}>
                    <Tabs
                      value={pageMode}
                      onChange={(_, value) => setPageMode(value)}
                      variant="scrollable"
                      allowScrollButtonsMobile
                      sx={{
                        minHeight: 32,
                        '& .MuiTab-root': { textTransform: 'none', fontWeight: 800, minHeight: 32, px: 1.15, fontSize: '0.8rem' },
                        '& .MuiTabs-indicator': { borderRadius: '2px', height: 2 },
                      }}
                    >
                      {TASK_MODE_OPTIONS.map((option) => (
                        <Tab key={option.value} value={option.value} label={option.label} />
                      ))}
                    </Tabs>
                  </Box>

                  {isTaskDataMode ? (
                    <Stack direction="row" spacing={0.45} sx={{ minWidth: 0, overflowX: 'auto', flex: 1 }}>
                      {boardSummaryItems.map((item) => (
                        <Chip
                          key={item.key}
                          size="small"
                          label={`${item.label}: ${item.value}`}
                          sx={{
                            flexShrink: 0,
                            height: 24,
                            fontWeight: 850,
                            fontSize: '0.7rem',
                            borderRadius: '8px',
                            bgcolor: alpha(item.color, 0.12),
                            color: item.color,
                          }}
                        />
                      ))}
                    </Stack>
                  ) : (
                    <Typography variant="caption" sx={{ color: ui.subtleText, lineHeight: 1.1, minWidth: 0 }} noWrap>
                      Аналитика по постановке, срокам и выполнению задач.
                    </Typography>
                  )}
                </Stack>

                <Stack direction="row" spacing={0.45} alignItems="center" sx={{ flexShrink: 0 }}>
                  <Tooltip title="Обновить">
                    <span>
                      <IconButton
                        size="small"
                        aria-label="Обновить"
                        onClick={() => void (pageMode === 'analytics' ? loadTaskAnalytics() : loadTasks())}
                        sx={{ width: 32, height: 32, borderRadius: '10px', border: '1px solid', borderColor: ui.actionBorder, bgcolor: ui.actionBg }}
                      >
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {canWriteTasks && (
                    <Tooltip title="Справочники">
                      <span>
                        <IconButton
                          size="small"
                          aria-label="Справочники"
                          onClick={() => setTaxonomyOpen(true)}
                          sx={{ width: 32, height: 32, borderRadius: '10px', border: '1px solid', borderColor: ui.actionBorder, bgcolor: ui.actionBg }}
                        >
                          <AssignmentIcon sx={{ fontSize: 17 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  {canCreateTasks && (
                    <Button
                      size="small"
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => setCreateOpen(true)}
                      sx={{ minHeight: 32, textTransform: 'none', fontWeight: 850, borderRadius: '10px', boxShadow: 'none', px: 1.25 }}
                    >
                      Новая задача
                    </Button>
                  )}
                </Stack>
              </Stack>

              {isTaskDataMode ? (
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.8} sx={{ minHeight: 32 }}>
                <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0, flex: '1 1 auto' }}>
                  <TaskRoleScopeSwitch
                    value={viewMode}
                    onChange={handlePersonalRoleChange}
                    counts={personalRoleCounts}
                  />
                  <Box sx={{ ...getOfficeSubtlePanelSx(ui, { borderRadius: '10px', px: 0.35 }), minWidth: 0 }}>
                    <Tabs
                      value={secondaryViewMode || false}
                      onChange={(_, value) => {
                        if (value) setViewMode(value);
                      }}
                      variant="scrollable"
                      allowScrollButtonsMobile
                      sx={{
                        minHeight: 32,
                        '& .MuiTab-root': { textTransform: 'none', fontWeight: 750, minHeight: 32, px: 1.15, fontSize: '0.79rem' },
                        '& .MuiTabs-indicator': { borderRadius: '2px', height: 2 },
                      }}
                    >
                      {canManageAllTasks && <Tab value="all" label="Все" />}
                      <Tab value="department" label="Отдел" />
                      {canUseControllerTab && <Tab value="controller" label="На контроле" />}
                    </Tabs>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={0.45} alignItems="center" sx={{ flexShrink: 0, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.45} sx={{ maxWidth: { md: 520, lg: 640 }, overflowX: 'auto' }}>
                    {focusOptions.map((option) => (
                      <Chip
                        key={option.value}
                        clickable
                        label={`${option.label}: ${focusCounts[option.value] || 0}`}
                        onClick={() => setFocusMode(option.value)}
                        sx={{
                          flexShrink: 0,
                          height: 24,
                          fontSize: '0.7rem',
                          fontWeight: 850,
                          borderRadius: '8px',
                          border: '1px solid',
                          borderColor: focusMode === option.value ? ui.selectedBorder : ui.actionBorder,
                          bgcolor: focusMode === option.value ? ui.selectedBg : ui.actionBg,
                          color: focusMode === option.value ? theme.palette.primary.main : 'text.primary',
                        }}
                      />
                    ))}
                  </Stack>
                  <Button
                    size="small"
                    variant={showFilters ? 'contained' : 'text'}
                    startIcon={<FilterListIcon />}
                    onClick={() => setShowFilters((prev) => !prev)}
                    sx={{ minHeight: 30, textTransform: 'none', fontWeight: 850, borderRadius: '9px', px: 1, py: 0.25, whiteSpace: 'nowrap', boxShadow: 'none' }}
                  >
                    {showFilters ? 'Свернуть фильтры' : `Развернуть фильтры${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
                  </Button>
                </Stack>
              </Stack>
              ) : null}

              {isTaskDataMode && showFilters && (
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1, borderRadius: '14px' }) }}>
                  <Grid container spacing={1.1}>
                    <Grid item xs={12} md={4}>
                      <TextField
                        fullWidth
                        size="small"
                        label="Поиск по задачам"
                        value={q}
                        inputRef={searchInputRef}
                        onChange={(event) => setQ(event.target.value)}
                        placeholder="Заголовок, комментарий, участник..."
                        InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, color: ui.subtleText, mr: 0.8 }} /> }}
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="tasks-status-filter-label">Статус</InputLabel>
                        <Select labelId="tasks-status-filter-label" label="Статус" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                          {statusOptions.map((item) => <MenuItem key={item.value || 'all'} value={item.value}>{item.label}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="tasks-due-filter-label">Срок</InputLabel>
                        <Select labelId="tasks-due-filter-label" label="Срок" value={dueState} onChange={(event) => setDueState(event.target.value)}>
                          {dueStateOptions.map((item) => <MenuItem key={item.value || 'all'} value={item.value}>{item.label}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2}>
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={assignees}
                        value={selectedBoardAssignee}
                        onChange={(_, value) => setAssigneeFilter(String(value?.id || ''))}
                        getOptionLabel={getTaskUserLabel}
                        filterOptions={filterTaskUserOptions}
                        isOptionEqualToValue={areSameTaskUsers}
                        clearOnEscape
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Исполнитель"
                            placeholder="Фамилия или логин"
                          />
                        )}
                        noOptionsText="Ничего не найдено"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={2}>
                      <Autocomplete
                        fullWidth
                        size="small"
                        options={controllers}
                        value={selectedBoardController}
                        onChange={(_, value) => setControllerFilter(String(value?.id || ''))}
                        getOptionLabel={getTaskUserLabel}
                        filterOptions={filterTaskUserOptions}
                        isOptionEqualToValue={areSameTaskUsers}
                        clearOnEscape
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Контролёр"
                            placeholder="Фамилия или логин"
                          />
                        )}
                        noOptionsText="Ничего не найдено"
                      />
                    </Grid>
                    <Grid item xs={12} sm={6} md={2.4}><FormControlLabel control={<Checkbox checked={hasAttachments} onChange={(event) => setHasAttachments(event.target.checked)} />} label="С файлами" /></Grid>
                    <Grid item xs={12} sm={6} md={2.6}><FormControlLabel control={<Checkbox checked={unreadCommentsOnly} onChange={(event) => setUnreadCommentsOnly(event.target.checked)} />} label="Есть новые комментарии" /></Grid>
                    <Grid item xs={12} md={7}>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>
                        Фильтры и текущая карточка синхронизируются с URL, поэтому состояние страницы можно открыть по ссылке.
                      </Typography>
                    </Grid>
                    <Grid item xs={12} md={5} sx={{ display: 'flex', justifyContent: { xs: 'stretch', md: 'flex-end' } }}>
                      <Button variant="outlined" onClick={resetFilters} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', minWidth: 180 }}>
                        Сбросить фильтры
                      </Button>
                    </Grid>
                  </Grid>
                </Box>
              )}
            </Stack>
          </Card>
          ) : null}

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            {pageMode === 'analytics' ? (
              <Box sx={{ height: '100%', minHeight: 0, overflowY: 'auto', pr: 0.2 }}>
                <Stack spacing={1.2} sx={{ minHeight: '100%', pb: 0.6 }}>
                  {!isAnalyticsMobile ? (
                  <Box
                    sx={{
                      position: isAnalyticsMobile ? 'static' : 'sticky',
                      top: 0,
                      zIndex: 5,
                      pt: 0.1,
                      pb: 0.25,
                      bgcolor: ui.pageBg,
                    }}
                  >
                    <Card
                      data-testid="analytics-filters-panel"
                      sx={{
                        ...getOfficePanelSx(ui, { p: 0.95, borderRadius: '15px' }),
                        overflow: 'visible',
                      }}
                    >
                      <Stack spacing={0.8}>
                        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.75}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 900 }}>Фильтры аналитики</Typography>
                            <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
                              Сначала выберите проект, потом при необходимости сузьте отчёт до объекта. Ниже появится отдельный срез по выбранному фокусу.
                            </Typography>
                          </Box>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.7} sx={{ width: { xs: '100%', md: 'auto' }, alignItems: { xs: 'stretch', md: 'flex-start' } }}>
                            <Button
                              variant="contained"
                              size="small"
                              startIcon={<DownloadIcon />}
                              onClick={handleExportTaskAnalytics}
                              disabled={analyticsLoading || analyticsExporting}
                              sx={{ textTransform: 'none', fontWeight: 800, alignSelf: { xs: 'stretch', md: 'flex-start' }, whiteSpace: 'nowrap' }}
                            >
                              {analyticsExporting ? 'Экспорт...' : 'Экспорт Excel'}
                            </Button>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<FilterListIcon />}
                              onClick={toggleAnalyticsFilters}
                              sx={{ textTransform: 'none', fontWeight: 800, alignSelf: { xs: 'stretch', md: 'flex-start' }, whiteSpace: 'nowrap' }}
                            >
                              {analyticsFiltersVisible ? 'Скрыть фильтры' : 'Показать фильтры'}
                            </Button>
                            <Box
                              sx={{
                                ...getOfficeSubtlePanelSx(ui, { px: 0.95, py: 0.65, borderRadius: '12px' }),
                                minWidth: { md: 300 },
                                maxWidth: { md: 430 },
                              }}
                            >
                              <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block' }}>Сейчас считаем</Typography>
                              <Typography sx={{ fontWeight: 900, mt: 0.2 }}>{analyticsFocusMeta.title}</Typography>
                              <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.25 }}>
                                {analyticsFocusMeta.description}
                              </Typography>
                            </Box>
                          </Stack>
                        </Stack>

                        {!isAnalyticsMobile && (
                          <Collapse in={analyticsFiltersVisible} timeout="auto" unmountOnExit={false}>
                          <Stack spacing={0.8}>
                            <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.85, borderRadius: '13px' }) }}>
                              <Typography sx={{ fontWeight: 800, mb: 0.65 }}>Период отчёта</Typography>
                              <Grid container spacing={1}>
                                <Grid item xs={12} md={3}>
                                  <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
                                    <InputLabel id="analytics-preset-label">Период</InputLabel>
                                    <Select
                                      labelId="analytics-preset-label"
                                      label="Период"
                                      value={analyticsFilters.preset}
                                      onChange={(event) => {
                                        const preset = event.target.value;
                                        const range = buildAnalyticsRangeFromPreset(preset);
                                        setAnalyticsFilters((prev) => ({ ...prev, preset, ...range }));
                                      }}
                                    >
                                      {analyticsPresetOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                                    </Select>
                                  </FormControl>
                                </Grid>
                                <Grid item xs={12} md={3}>
                                  <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
                                    <InputLabel id="analytics-date-basis-label">База дат</InputLabel>
                                    <Select
                                      labelId="analytics-date-basis-label"
                                      label="База дат"
                                      value={analyticsFilters.date_basis}
                                      onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, date_basis: event.target.value }))}
                                    >
                                      {analyticsDateBasisOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                                    </Select>
                                  </FormControl>
                                </Grid>
                                <Grid item xs={12} md={3}>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    type="date"
                                    label="Дата с"
                                    value={analyticsFilters.start_date}
                                    onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, preset: 'custom', start_date: event.target.value }))}
                                    InputLabelProps={{ shrink: true }}
                                    sx={analyticsFilterFieldSx}
                                  />
                                </Grid>
                                <Grid item xs={12} md={3}>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    type="date"
                                    label="Дата по"
                                    value={analyticsFilters.end_date}
                                    onChange={(event) => setAnalyticsFilters((prev) => ({ ...prev, preset: 'custom', end_date: event.target.value }))}
                                    InputLabelProps={{ shrink: true }}
                                    sx={analyticsFilterFieldSx}
                                  />
                                </Grid>
                              </Grid>
                            </Box>

                            <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.85, borderRadius: '13px' }) }}>
                              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8} sx={{ mb: 0.75 }}>
                                <Box>
                                  <Typography sx={{ fontWeight: 800 }}>Срез отчёта</Typography>
                                  <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
                                    Выберите проект, затем при необходимости объект. Участник дополнительно сузит отчёт до конкретного исполнителя.
                                  </Typography>
                                </Box>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => setAnalyticsFilters((prev) => ({ ...prev, project_ids: [], object_ids: [], participant_user_id: '' }))}
                                  sx={{ alignSelf: { xs: 'stretch', md: 'flex-start' }, textTransform: 'none', fontWeight: 800 }}
                                >
                                  Сбросить срез
                                </Button>
                              </Stack>

                              <Grid container spacing={1}>
                                <Grid item xs={12} lg={5}>
                                  <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
                                    <InputLabel id="analytics-projects-label">Проекты</InputLabel>
                                    <Select
                                      multiple
                                      labelId="analytics-projects-label"
                                      label="Проекты"
                                      value={analyticsFilters.project_ids}
                                      onChange={(event) => setAnalyticsFilters((prev) => ({
                                        ...prev,
                                        project_ids: Array.isArray(event.target.value) ? event.target.value : [],
                                        object_ids: [],
                                      }))}
                                      renderValue={(selected) => {
                                        const ids = Array.isArray(selected) ? selected : [];
                                        if (ids.length === 0) return 'Все проекты';
                                        return ids
                                          .map((value) => activeTaskProjects.find((item) => String(item.id) === String(value))?.name)
                                          .filter(Boolean)
                                          .join(', ');
                                      }}
                                    >
                                      {activeTaskProjects.map((item) => (
                                        <MenuItem key={item.id} value={String(item.id)}>
                                          <Checkbox checked={analyticsFilters.project_ids.includes(String(item.id))} />
                                          <Typography>{item.name}</Typography>
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Grid>
                                <Grid item xs={12} lg={4}>
                                  <FormControl fullWidth size="small" sx={analyticsFilterFieldSx}>
                                    <InputLabel id="analytics-objects-label">Объекты</InputLabel>
                                    <Select
                                      multiple
                                      labelId="analytics-objects-label"
                                      label="Объекты"
                                      value={analyticsFilters.object_ids}
                                      onChange={(event) => setAnalyticsFilters((prev) => ({
                                        ...prev,
                                        object_ids: Array.isArray(event.target.value) ? event.target.value : [],
                                      }))}
                                      renderValue={(selected) => {
                                        const ids = Array.isArray(selected) ? selected : [];
                                        if (ids.length === 0) return 'Все объекты';
                                        return ids
                                          .map((value) => activeTaskObjects.find((item) => String(item.id) === String(value))?.name)
                                          .filter(Boolean)
                                          .join(', ');
                                      }}
                                    >
                                      {analyticsObjectOptions.map((item) => (
                                        <MenuItem key={item.id} value={String(item.id)}>
                                          <Checkbox checked={analyticsFilters.object_ids.includes(String(item.id))} />
                                          <Typography>{item.name}</Typography>
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </FormControl>
                                </Grid>
                                <Grid item xs={12} lg={3}>
                                  <Autocomplete
                                    fullWidth
                                    size="small"
                                    options={assignees}
                                    value={selectedAnalyticsParticipantOption}
                                    onChange={(_, value) => setAnalyticsFilters((prev) => ({
                                      ...prev,
                                      participant_user_id: String(value?.id || ''),
                                    }))}
                                    getOptionLabel={getTaskUserLabel}
                                    filterOptions={filterTaskUserOptions}
                                    isOptionEqualToValue={areSameTaskUsers}
                                    clearOnEscape
                                    noOptionsText="Ничего не найдено"
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        label="Участник"
                                        placeholder="Фамилия или логин"
                                        sx={analyticsFilterFieldSx}
                                        inputProps={{
                                          ...params.inputProps,
                                          'data-testid': 'analytics-participant-select',
                                        }}
                                      />
                                    )}
                                  />
                                </Grid>
                              </Grid>
                            </Box>

                            <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.8, borderRadius: '13px' }) }}>
                              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                                <Box>
                                  <Typography sx={{ fontWeight: 800 }}>{analyticsFocusMeta.title}</Typography>
                                  <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
                                    {analyticsFocusMeta.description}
                                  </Typography>
                                </Box>
                                <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                                  {analyticsFocusMeta.chips.length > 0 ? analyticsFocusMeta.chips.map((item) => (
                                    <Chip
                                      key={item.key}
                                      size="small"
                                      label={item.label}
                                      sx={{ height: 24, fontWeight: 800, bgcolor: item.bg, color: item.color }}
                                    />
                                  )) : (
                                    <Chip
                                      size="small"
                                      label="Все проекты и объекты"
                                      sx={{ height: 24, fontWeight: 800, bgcolor: alpha(analyticsAccentColor, 0.12), color: analyticsAccentColor }}
                                    />
                                  )}
                                  {selectedAnalyticsParticipant ? (
                                    <Chip
                                      size="small"
                                      label={`Участник: ${selectedAnalyticsParticipant.participant_name || 'Не назначен'}`}
                                      sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#7c3aed', 0.12), color: '#7c3aed' }}
                                    />
                                  ) : null}
                                </Stack>
                              </Stack>
                            </Box>
                          </Stack>
                          </Collapse>
                        )}
                      </Stack>
                    </Card>
                  </Box>
                  ) : null}

                  {analyticsLoading ? <LinearProgress sx={{ borderRadius: 999 }} /> : null}

                  <Grid container spacing={1}>
                  {analyticsKpis.map((item) => (
                    <Grid item xs={6} sm={6} xl={2} key={item.title}>
                      <Box sx={{ ...getOfficeMetricBlockSx(ui, item.color, { p: 0.95, minHeight: 88 }) }}>
                        <Typography sx={{ fontWeight: 900, color: item.color, fontSize: '1.02rem', lineHeight: 1.1 }}>{item.value}</Typography>
                        <Typography sx={{ mt: 0.45, fontWeight: 800, fontSize: '0.76rem' }}>{item.title}</Typography>
                        <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.35, lineHeight: 1.35 }}>
                          {item.helper}
                        </Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>

                <Grid container spacing={1.2}>
                  {analyticsProjectSectionMeta ? (
                    <Grid item xs={12}>
                      <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }) }}>
                        <Stack spacing={0.8}>
                          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                            <Box>
                              <Typography sx={{ fontWeight: 900 }}>{analyticsProjectSectionMeta.title}</Typography>
                              <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                {selectedAnalyticsProjects.length === 1
                                  ? 'Выбрали проект, ниже видно кто по нему работает и сколько задач у каждого исполнителя.'
                                  : 'Выбраны проекты, ниже видно кто по ним работает и сколько задач у каждого исполнителя.'}
                              </Typography>
                            </Box>
                            <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                              {selectedAnalyticsProjects.map((item) => (
                                <Chip
                                  key={`analytics-project-${item.id}`}
                                  size="small"
                                  label={item.name}
                                  sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#059669', 0.12), color: '#059669' }}
                                />
                              ))}
                            </Stack>
                          </Stack>

                          {(analyticsPayload?.by_participant || []).length > 0 ? (
                            <Grid container spacing={0.8}>
                              {(analyticsPayload?.by_participant || []).map((row) => (
                                <Grid item xs={12} md={6} xl={4} key={`project-focus-user-${row.participant_user_id || 'none'}`}>
                                  <Box
                                    data-testid={`project-focus-user-${row.participant_user_id || 'none'}`}
                                    onClick={() => selectAnalyticsParticipant(row.participant_user_id)}
                                    sx={{
                                      ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }),
                                      cursor: 'pointer',
                                      transition: 'transform 0.16s ease, box-shadow 0.16s ease',
                                      '&:hover': {
                                        transform: 'translateY(-1px)',
                                        boxShadow: theme.shadows[2],
                                      },
                                    }}
                                  >
                                    <Typography sx={{ fontWeight: 800 }}>{row.participant_name || 'Не назначен'}</Typography>
                                    <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.15 }}>
                                      Всего {Number(row.total || 0)} · Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · В срок {Number(row.done_on_time || 0)} · Просрочено {Number(row.overdue || 0)}
                                    </Typography>
                                  </Box>
                                </Grid>
                              ))}
                            </Grid>
                          ) : (
                            <Box sx={getOfficeEmptyStateSx(ui, { p: 1.5 })}>
                              <Typography sx={{ fontWeight: 800 }}>По выбранному проекту задач не найдено.</Typography>
                            </Box>
                          )}
                        </Stack>
                      </Card>
                    </Grid>
                  ) : null}

                  {selectedAnalyticsObjects.length > 0 ? (
                    <Grid item xs={12}>
                      <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }) }}>
                        <Stack spacing={0.8}>
                          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                            <Box>
                              <Typography sx={{ fontWeight: 900 }}>Срез по объекту</Typography>
                              <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                Выбрали объект, ниже видно кто по нему работает и сколько задач у каждого исполнителя.
                              </Typography>
                            </Box>
                            <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                              {selectedAnalyticsObjects.map((item) => (
                                <Chip
                                  key={`analytics-object-${item.id}`}
                                  size="small"
                                  label={item.name}
                                  sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#2563eb', 0.12), color: '#2563eb' }}
                                />
                              ))}
                            </Stack>
                          </Stack>

                          {(analyticsPayload?.by_participant || []).length > 0 ? (
                            <Grid container spacing={0.8}>
                              {(analyticsPayload?.by_participant || []).map((row) => (
                                <Grid item xs={12} md={6} xl={4} key={`object-focus-user-${row.participant_user_id || 'none'}`}>
                                  <Box
                                    data-testid={`object-focus-user-${row.participant_user_id || 'none'}`}
                                    onClick={() => selectAnalyticsParticipant(row.participant_user_id)}
                                    sx={{
                                      ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }),
                                      cursor: 'pointer',
                                      transition: 'transform 0.16s ease, box-shadow 0.16s ease',
                                      '&:hover': {
                                        transform: 'translateY(-1px)',
                                        boxShadow: theme.shadows[2],
                                      },
                                    }}
                                  >
                                    <Typography sx={{ fontWeight: 800 }}>{row.participant_name || 'Не назначен'}</Typography>
                                    <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.15 }}>
                                      Всего {Number(row.total || 0)} · Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · В срок {Number(row.done_on_time || 0)} · Просрочено {Number(row.overdue || 0)}
                                    </Typography>
                                  </Box>
                                </Grid>
                              ))}
                            </Grid>
                          ) : (
                            <Box sx={getOfficeEmptyStateSx(ui, { p: 1.5 })}>
                              <Typography sx={{ fontWeight: 800 }}>По выбранному объекту задач не найдено.</Typography>
                            </Box>
                          )}
                        </Stack>
                      </Card>
                    </Grid>
                  ) : null}

                  <Grid item xs={12} lg={4}>
                    <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
                      <Typography sx={{ fontWeight: 900, mb: 1 }}>Статусы</Typography>
                      {analyticsStatusChartData.some((item) => Number(item?.value || 0) > 0) ? (
                        <Box sx={{ width: '100%', height: 280 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={analyticsStatusChartData} dataKey="value" nameKey="label" innerRadius={56} outerRadius={88} paddingAngle={2}>
                                {analyticsStatusChartData.map((item) => <Cell key={item.status} fill={item.color} />)}
                              </Pie>
                              <RechartsTooltip formatter={(value, name) => [Number(value || 0), name]} />
                              <Legend />
                            </PieChart>
                          </ResponsiveContainer>
                        </Box>
                      ) : (
                        <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 220 })}>
                          <Typography sx={{ fontWeight: 800 }}>Нет данных для диаграммы.</Typography>
                        </Box>
                      )}
                    </Card>
                  </Grid>

                  <Grid item xs={12} lg={8}>
                    <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.8} sx={{ mb: 0.8 }}>
                        <Typography sx={{ fontWeight: 900 }}>Постановка и выполнение по времени</Typography>
                        <Typography variant="caption" sx={{ color: ui.subtleText }}>
                          Гранулярность: {analyticsPayload?.trend?.granularity || 'day'}
                        </Typography>
                      </Stack>
                      {analyticsTrendItems.length > 0 ? (
                        <Box sx={{ width: '100%', height: 280 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={analyticsTrendItems}>
                              <CartesianGrid strokeDasharray="3 3" stroke={alpha(analyticsGridStroke, 0.7)} />
                              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                              <RechartsTooltip />
                              <Legend />
                              <Line type="monotone" dataKey="created" name="По протоколу" stroke="#2563eb" strokeWidth={3} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                              <Line type="monotone" dataKey="completed" name="Выполнено" stroke="#059669" strokeWidth={3} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                              <Line type="monotone" dataKey="completed_on_time" name="В срок" stroke="#7c3aed" strokeWidth={2} dot={{ r: 1.5 }} activeDot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </Box>
                      ) : (
                        <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 220 })}>
                          <Typography sx={{ fontWeight: 800 }}>Нет временного ряда по выбранным фильтрам.</Typography>
                        </Box>
                      )}
                    </Card>
                  </Grid>

                  <Grid item xs={12} lg={6}>
                    <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
                      <Typography sx={{ fontWeight: 900, mb: 0.2 }}>{analyticsParticipantSectionMeta.title}</Typography>
                      {analyticsParticipantSectionMeta.subtitle ? (
                        <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mb: 0.9 }}>
                          {analyticsParticipantSectionMeta.subtitle}
                        </Typography>
                      ) : <Box sx={{ mb: 0.9 }} />}
                      {analyticsParticipantChartData.length > 0 ? (
                        <Box sx={{ width: '100%', height: 320 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={analyticsParticipantChartData} layout="vertical" margin={{ left: 16, right: 8 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke={alpha(analyticsGridStroke, 0.7)} />
                              <XAxis type="number" allowDecimals={false} />
                              <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                              <RechartsTooltip />
                              <Legend />
                              <Bar dataKey="open" name="Открыто" stackId="participant" fill="#2563eb" radius={[0, 0, 0, 0]} />
                              <Bar dataKey="done" name="Выполнено" stackId="participant" fill="#059669" radius={[0, 0, 0, 0]} />
                              <Bar dataKey="overdue" name="Просрочено" stackId="participant" fill="#dc2626" radius={[0, 6, 6, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                        </Box>
                      ) : (
                        <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 240 })}>
                          <Typography sx={{ fontWeight: 800 }}>Нет участников по текущим фильтрам.</Typography>
                        </Box>
                      )}
                    </Card>
                  </Grid>

                  <Grid item xs={12} lg={6}>
                    <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }), height: '100%' }}>
                      <Typography sx={{ fontWeight: 900, mb: 1 }}>{analyticsScopeChart.title}</Typography>
                      {analyticsScopeChart.rows.length > 0 ? (
                        <Box sx={{ width: '100%', height: 320 }}>
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={analyticsScopeChart.rows}>
                              <CartesianGrid strokeDasharray="3 3" stroke={alpha(analyticsGridStroke, 0.7)} />
                              <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-18} textAnchor="end" height={70} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                              <RechartsTooltip />
                              <Legend />
                              <Bar dataKey="open" name="Открыто" stackId="scope" fill="#2563eb" />
                              <Bar dataKey="done" name="Выполнено" stackId="scope" fill="#059669" />
                              <Bar dataKey="overdue" name="Просрочено" stackId="scope" fill="#dc2626" />
                            </BarChart>
                          </ResponsiveContainer>
                        </Box>
                      ) : (
                        <Box sx={getOfficeEmptyStateSx(ui, { p: 2, minHeight: 240 })}>
                          <Typography sx={{ fontWeight: 800 }}>Нет данных для сравнения проектов и объектов.</Typography>
                        </Box>
                      )}
                    </Card>
                  </Grid>
                </Grid>

                {selectedAnalyticsParticipant ? (
                  <Card data-testid="analytics-participant-card" sx={{ ...getOfficePanelSx(ui, { p: 1.1, borderRadius: '16px' }) }}>
                    <Stack spacing={1}>
                      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                        <Box>
                          <Typography sx={{ fontWeight: 900 }}>Участник: {selectedAnalyticsParticipant.participant_name || '—'}</Typography>
                          <Typography variant="caption" sx={{ color: ui.subtleText }}>
                            Детальная карточка выбранного исполнителя по текущим фильтрам.
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={`Выполнено ${formatPercent(selectedAnalyticsParticipant.completion_percent)}`}
                          sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#059669', 0.12), color: '#059669' }}
                        />
                      </Stack>

                      <Grid container spacing={0.8}>
                        {[
                          { label: 'Новые', value: Number(selectedAnalyticsParticipant.new || 0), color: '#2563eb' },
                          { label: 'В работе', value: Number(selectedAnalyticsParticipant.in_progress || 0), color: '#d97706' },
                          { label: 'На проверке', value: Number(selectedAnalyticsParticipant.review || 0), color: '#7c3aed' },
                          { label: 'Открыто', value: Number(selectedAnalyticsParticipant.open || 0), color: '#0f172a' },
                          { label: 'Выполнено', value: Number(selectedAnalyticsParticipant.done || 0), color: '#059669' },
                          { label: 'В срок', value: Number(selectedAnalyticsParticipant.done_on_time || 0), color: '#7c3aed' },
                          { label: 'Просрочено', value: Number(selectedAnalyticsParticipant.overdue || 0), color: '#dc2626' },
                        ].map((item) => (
                          <Grid item xs={6} sm={4} md={3} key={item.label}>
                            <Box sx={{ ...getOfficeMetricBlockSx(ui, item.color, { p: 0.8, minHeight: 74 }) }}>
                              <Typography sx={{ fontWeight: 900, color: item.color, fontSize: '1rem', lineHeight: 1 }}>{item.value}</Typography>
                              <Typography sx={{ mt: 0.4, fontWeight: 800, fontSize: '0.72rem' }}>{item.label}</Typography>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>

                      <Grid container spacing={1}>
                        <Grid item xs={12} lg={6}>
                          <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }) }}>
                            <Typography sx={{ fontWeight: 800, mb: 0.7 }}>По проектам участника</Typography>
                            <Stack spacing={0.55}>
                              {(analyticsPayload?.by_project || []).length === 0 ? (
                                <Typography variant="body2" sx={{ color: ui.mutedText }}>Нет данных по проектам.</Typography>
                              ) : (analyticsPayload?.by_project || []).map((row) => (
                                <Stack key={`participant-project-${row.project_id || 'none'}`} direction="row" justifyContent="space-between" spacing={1}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.project_name || 'Без проекта'}</Typography>
                                  <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                    Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · Просрочено {Number(row.overdue || 0)}
                                  </Typography>
                                </Stack>
                              ))}
                            </Stack>
                          </Box>
                        </Grid>
                        <Grid item xs={12} lg={6}>
                          <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }) }}>
                            <Typography sx={{ fontWeight: 800, mb: 0.7 }}>По объектам участника</Typography>
                            <Stack spacing={0.55}>
                              {(analyticsPayload?.by_object || []).length === 0 ? (
                                <Typography variant="body2" sx={{ color: ui.mutedText }}>Нет данных по объектам.</Typography>
                              ) : (analyticsPayload?.by_object || []).map((row) => (
                                <Stack key={`participant-object-${row.object_id || 'none'}`} direction="row" justifyContent="space-between" spacing={1}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.object_name || 'Без объекта'}</Typography>
                                  <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                    Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · Просрочено {Number(row.overdue || 0)}
                                  </Typography>
                                </Stack>
                              ))}
                            </Stack>
                          </Box>
                        </Grid>
                      </Grid>
                    </Stack>
                  </Card>
                ) : null}

                <Grid container spacing={1.2} sx={{ minHeight: 0 }}>
                  {[
                    { title: analyticsParticipantSectionMeta.title, rows: analyticsPayload?.by_participant || [], idKey: 'participant_user_id', labelKey: 'participant_name', subtitle: analyticsParticipantSectionMeta.subtitle },
                    { title: 'По проектам', rows: analyticsPayload?.by_project || [], idKey: 'project_id', labelKey: 'project_name' },
                    { title: 'По объектам', rows: analyticsPayload?.by_object || [], idKey: 'object_id', labelKey: 'object_name' },
                  ].map((section) => (
                    <Grid item xs={12} key={section.title}>
                      <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }) }}>
                        <Typography sx={{ fontWeight: 900, mb: 0.9 }}>{section.title}</Typography>
                        {section.subtitle ? (
                          <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mb: 0.9 }}>
                            {section.subtitle}
                          </Typography>
                        ) : null}
                        {section.rows.length === 0 ? (
                          <Box sx={getOfficeEmptyStateSx(ui, { p: 1.4 })}>
                            <Typography sx={{ fontWeight: 800 }}>Нет данных по фильтрам.</Typography>
                          </Box>
                        ) : (
                          <Stack spacing={0.75}>
                            <Box
                              sx={{
                                display: { xs: 'none', lg: 'grid' },
                                gridTemplateColumns: 'minmax(220px, 1.6fr) repeat(8, minmax(62px, 0.7fr))',
                                gap: 0.7,
                                px: 0.35,
                              }}
                            >
                              <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>Срез</Typography>
                              {analyticsTableColumns.map((column) => (
                                <Typography key={`${section.title}-head-${column.key}`} variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>{column.label}</Typography>
                              ))}
                            </Box>
                            {section.rows.map((row) => (
                              <Box key={`${section.title}-${row[section.idKey] || 'none'}`} sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '12px' }) }}>
                                <Box
                                  sx={{
                                    display: 'grid',
                                    gridTemplateColumns: { xs: '1fr 1fr', lg: 'minmax(220px, 1.6fr) repeat(8, minmax(62px, 0.7fr))' },
                                    gap: 0.7,
                                    alignItems: 'center',
                                  }}
                                >
                                  <Box sx={{ minWidth: 0 }}>
                                    <Typography sx={{ fontWeight: 800 }}>{row[section.labelKey] || '-'}</Typography>
                                    <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
                                      Выполнено {formatPercent(row.completion_percent)} · В срок {formatPercent(row.completion_on_time_percent)}
                                    </Typography>
                                  </Box>
                                  {analyticsTableColumns.map((column) => (
                                    <Box key={`${section.title}-${row[section.idKey] || 'none'}-${column.key}`} sx={{ minWidth: 0 }}>
                                      <Typography variant="caption" sx={{ color: ui.subtleText, display: { xs: 'block', lg: 'none' } }}>{column.label}</Typography>
                                      <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>{Number(row[column.key] || 0)}</Typography>
                                    </Box>
                                  ))}
                                </Box>
                              </Box>
                            ))}
                          </Stack>
                        )}
                      </Card>
                    </Grid>
                  ))}
                </Grid>
                </Stack>
              </Box>
            ) : (
              renderTaskDataModeContent()
            )}
          </Box>
            </>
          )}
        </Box>

        {mobileNavigationDrawerSafe}

        {false ? (
        <>
        <Dialog
          open={isMobile && pageMode === 'board' && mobileBoardFiltersOpen}
          onClose={() => setMobileBoardFiltersOpen(false)}
          fullScreen
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.4, py: 1.15 }) }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1rem' }}>Фильтры задач</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.3 }}>
              Сузьте список по статусу, срокам и участникам.
            </Typography>
          </Box>
          <DialogContent sx={{ px: 1, py: 1 }}>
            {boardFiltersContent}
          </DialogContent>
          <DialogActions
            sx={{
              px: 1,
              py: 1,
              borderTop: '1px solid',
              borderColor: ui.borderSoft,
              position: 'sticky',
              bottom: 0,
              bgcolor: ui.pageBg,
              flexDirection: 'column-reverse',
              gap: 0.8,
              '& > :not(style)': { m: 0, width: '100%' },
            }}
          >
            <Button onClick={() => setMobileBoardFiltersOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Закрыть
            </Button>
            <Button variant="outlined" onClick={resetFilters} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}>
              Сбросить фильтры
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(isAnalyticsMobile && analyticsMobileFiltersVisible)}
          onClose={() => setAnalyticsMobileFiltersVisible(false)}
          fullScreen
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.4, py: 1.15 }) }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1rem' }}>Фильтры аналитики</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.3 }}>
              Период, срез и участник для мобильного отчёта.
            </Typography>
          </Box>
          <DialogContent sx={{ px: 1, py: 1 }}>
            {analyticsFiltersContent}
          </DialogContent>
          <DialogActions
            sx={{
              px: 1,
              py: 1,
              borderTop: '1px solid',
              borderColor: ui.borderSoft,
              position: 'sticky',
              bottom: 0,
              bgcolor: ui.pageBg,
              flexDirection: 'column-reverse',
              gap: 0.8,
              '& > :not(style)': { m: 0, width: '100%' },
            }}
          >
            <Button onClick={() => setAnalyticsMobileFiltersVisible(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Закрыть
            </Button>
            <Button
              variant="contained"
              startIcon={<DownloadIcon />}
              onClick={handleExportTaskAnalytics}
              disabled={analyticsLoading || analyticsExporting}
              sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
            >
              {analyticsExporting ? 'Экспорт...' : 'Экспорт Excel'}
            </Button>
          </DialogActions>
        </Dialog>
        </>
        ) : null}

        {/*
        <Drawer
          anchor="right"
          open={detailsOpen}
          onClose={closeTaskDetails}
          PaperProps={{
            sx: {
              width: { xs: '100%', sm: 560, lg: 620 },
              maxWidth: '100%',
              borderLeft: '1px solid',
              display: 'flex',
              flexDirection: 'column',
              ...getOfficeDialogPaperSx(ui, { borderLeftColor: ui.borderSoft }),
            },
          }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2, py: 1.5 }) }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.2 }}>
                  {detailsTask?.title || 'Карточка задачи'}
                </Typography>
                <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
                  Быстрый просмотр: контроль, обсуждение, файлы и история без отдельного экрана.
                </Typography>
              </Box>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                {detailsTask?.id && (
                  <Button variant="outlined" size="small" startIcon={<ContentCopyIcon />} onClick={() => void handleCopyTaskLink(detailsTask.id)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                    Копировать ссылку
                  </Button>
                )}
                <Button onClick={closeTaskDetails} sx={{ textTransform: 'none', fontWeight: 700 }}>
                  Закрыть
                </Button>
              </Stack>
            </Stack>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.6 }}>
            {detailsLoading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
            {detailsTask ? (
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', gap: 0.6 }}>
                  <Chip size="small" label={statusMeta(detailsTask.status).label} sx={{ fontWeight: 800, bgcolor: statusMeta(detailsTask.status).bg, color: statusMeta(detailsTask.status).color }} />
                  {isTransferActUploadTask(detailsTask) && (
                    <Chip
                      size="small"
                      label={getTransferActReminderLabel(detailsTask)}
                      sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
                    />
                  )}
                  {detailsTask.is_overdue && <Chip size="small" label="Просрочено" sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }} />}
                  {detailsTask.has_unread_comments && <Chip size="small" label="Новый комментарий" sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />}
                  {Number(detailsTask.comments_count || 0) > 0 && <Chip size="small" label={`Комментарии: ${detailsTask.comments_count}`} sx={{ fontWeight: 700 }} />}
                  {Number(detailsTask.attachments_count || 0) > 0 && <Chip size="small" label={`Файлы: ${detailsTask.attachments_count}`} sx={{ fontWeight: 700 }} />}
                </Stack>

                <Grid container spacing={1.1}>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Постановщик</Typography><Typography sx={{ fontWeight: 700 }}>{detailsTask.created_by_full_name || detailsTask.created_by_username || '-'}</Typography></Grid>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Исполнитель</Typography><Typography sx={{ fontWeight: 700 }}>{detailsTask.assignee_full_name || detailsTask.assignee_username || '-'}</Typography></Grid>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Контролёр</Typography><Typography sx={{ fontWeight: 700 }}>{detailsTask.controller_full_name || detailsTask.controller_username || '-'}</Typography></Grid>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Проверил</Typography><Typography sx={{ fontWeight: 700 }}>{detailsTask.reviewer_full_name || '-'}</Typography></Grid>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Срок</Typography><Typography sx={{ fontWeight: 700 }}>{detailsTask.due_at ? formatDateTime(detailsTask.due_at) : 'Без срока'}</Typography></Grid>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Сдано</Typography><Typography sx={{ fontWeight: 700 }}>{formatDateTime(detailsTask.submitted_at)}</Typography></Grid>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Проверено</Typography><Typography sx={{ fontWeight: 700 }}>{formatDateTime(detailsTask.reviewed_at)}</Typography></Grid>
                  <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Обновлено</Typography><Typography sx={{ fontWeight: 700 }}>{formatDateTime(detailsTask.updated_at || detailsTask.created_at)}</Typography></Grid>
                </Grid>

                {String(detailsTask.review_comment || '').trim() && (
                  <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
                    <Typography sx={{ fontWeight: 800, mb: 0.45 }}>Комментарий проверки</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{detailsTask.review_comment}</Typography>
                  </Box>
                )}

                <Stack direction="row" spacing={0.8} flexWrap="wrap">
                  {taskDiscussionChatEnabled && (
                    <Button
                      size="small"
                      variant="contained"
                      color="secondary"
                      onClick={() => void handleOpenTaskDiscussion(detailsTask)}
                      disabled={discussionOpening}
                      sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                    >
                      {discussionOpening ? 'Открываем чат…' : 'Чат по задаче'}
                    </Button>
                  )}
                  {canOpenTransferActUpload(detailsTask) && (
                    <Button size="small" variant="contained" onClick={() => openTransferActReminder(detailsTask)} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                      Загрузить подписанный акт
                    </Button>
                  )}
                  {canStartTask(detailsTask) && (
                    <Button size="small" variant="outlined" onClick={() => void handleStartTask(detailsTask.id)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      В работу
                    </Button>
                  )}
                  {canSubmitTask(detailsTask) && (
                    <Button size="small" variant="contained" onClick={() => setSubmitTask(detailsTask)} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                      Сдать работу
                    </Button>
                  )}
                  {canReviewTask(detailsTask) && (
                    <Button size="small" variant="contained" color="secondary" onClick={() => setReviewTask(detailsTask)} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                      Проверить
                    </Button>
                  )}
                  {canEditTask(detailsTask) && (
                    <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={() => openEditTask(detailsTask)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      Редактировать
                    </Button>
                  )}
                  {canDeleteTask(detailsTask) && (
                    <Button size="small" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => void handleDeleteTask(detailsTask)} sx={{ textTransform: 'none', borderRadius: '10px' }}>
                      Удалить
                    </Button>
                  )}
                  <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => navigate(`/tasks?task=${encodeURIComponent(detailsTask.id)}`)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                    Открыть ссылкой
                  </Button>
                </Stack>

                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.3, borderRadius: '14px' }) }}>
                  {String(detailsTask.description || '').trim() ? (
                    <MarkdownRenderer value={detailsTask.description} />
                  ) : (
                    <Typography variant="body2" sx={{ color: ui.mutedText }}>
                      Описание задачи не заполнено.
                    </Typography>
                  )}
                </Box>

                {detailsTask.latest_report && (
                  <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                      <Box>
                        <Typography sx={{ fontWeight: 800 }}>Последний отчёт</Typography>
                        <Typography variant="caption" sx={{ color: ui.subtleText }}>
                          {formatDateTime(detailsTask.latest_report.uploaded_at)} · {detailsTask.latest_report.uploaded_by_username || '-'}
                        </Typography>
                      </Box>
                      {detailsTask.latest_report.file_name && (
                        <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => void handleDownloadReport(detailsTask.latest_report)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                          Скачать
                        </Button>
                      )}
                    </Stack>
                    {detailsTask.latest_report.comment && (
                      <Typography variant="body2" sx={{ mt: 0.8, whiteSpace: 'pre-wrap' }}>
                        {detailsTask.latest_report.comment}
                      </Typography>
                    )}
                  </Box>
                )}

                {Array.isArray(detailsTask.attachments) && detailsTask.attachments.length > 0 && (
                  <Box sx={{ ...getOfficePanelSx(ui, { p: 1.2, borderRadius: '14px', boxShadow: 'none' }) }}>
                    <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Файлы задачи</Typography>
                    <List disablePadding dense>
                      {detailsTask.attachments.map((attachment) => (
                        <ListItem
                          key={attachment.id}
                          disableGutters
                          secondaryAction={<IconButton size="small" onClick={() => void handleDownloadAttachment(detailsTask, attachment)}><DownloadIcon fontSize="small" /></IconButton>}
                        >
                          <ListItemAvatar sx={{ minWidth: 36 }}>
                            <Avatar sx={{ width: 24, height: 24, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                              <AttachFileIcon sx={{ fontSize: 14 }} />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText primary={attachment.file_name || 'file'} secondary={`${formatFileSize(attachment.file_size)} · ${formatDateTime(attachment.uploaded_at)}`} />
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                )}

                {canUploadFiles(detailsTask) && (
                  <Button size="small" variant="outlined" component="label" startIcon={<AttachFileIcon />} disabled={uploadingAttachment} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                    {uploadingAttachment ? 'Загрузка...' : 'Прикрепить файл'}
                    <input
                      type="file"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void handleUploadAttachment(detailsTask.id, file);
                        }
                        event.target.value = '';
                      }}
                    />
                  </Button>
                )}

                <Box sx={{ ...getOfficePanelSx(ui, { borderRadius: '14px', overflow: 'hidden', boxShadow: 'none' }) }}>
                  <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.2, py: 1 }) }}>
                    <Stack direction="row" spacing={0.6} alignItems="center">
                      <ModeCommentOutlinedIcon sx={{ fontSize: 18, color: theme.palette.primary.main }} />
                      <Typography sx={{ fontWeight: 800 }}>Обсуждение</Typography>
                    </Stack>
                  </Box>
                  <Box ref={detailsCommentsRef} sx={{ maxHeight: 280, overflowY: 'auto', px: 1.2, py: 0.8 }}>
                    {detailsComments.length === 0 ? (
                      <Typography variant="body2" sx={{ color: ui.mutedText, py: 0.8 }}>
                        Комментариев пока нет.
                      </Typography>
                    ) : (
                      <List disablePadding dense>
                        {detailsComments.map((item) => (
                          <ListItem key={item.id} disableGutters sx={{ alignItems: 'flex-start', py: 0.6 }}>
                            <ListItemAvatar sx={{ minWidth: 36 }}>
                              <Avatar sx={{ width: 24, height: 24, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main, fontSize: '0.62rem' }}>
                                {getInitials(item.full_name || item.username)}
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText
                              primary={item.full_name || item.username || '-'}
                              secondary={(
                                <>
                                  <Typography component="span" variant="caption" sx={{ display: 'block', color: ui.subtleText, mb: 0.25 }}>
                                    {formatDateTime(item.created_at)}
                                  </Typography>
                                  <Typography component="span" variant="body2" sx={{ color: 'text.primary', whiteSpace: 'pre-wrap' }}>
                                    {item.body || ''}
                                  </Typography>
                                </>
                              )}
                            />
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </Box>
                  <Box sx={{ px: 1.2, py: 1, borderTop: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
                    <Stack spacing={0.8}>
                      <TextField label="Новый комментарий" value={detailsCommentBody} onChange={(event) => setDetailsCommentBody(event.target.value)} multiline minRows={3} fullWidth />
                      <Stack direction="row" justifyContent="flex-end">
                        <Button
                          variant="contained"
                          onClick={() => void handleAddTaskComment()}
                          disabled={detailsCommentSaving || String(detailsCommentBody || '').trim().length === 0}
                          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                        >
                          {detailsCommentSaving ? 'Сохранение...' : 'Добавить комментарий'}
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                </Box>

                <Box sx={{ ...getOfficePanelSx(ui, { p: 1.2, borderRadius: '14px', boxShadow: 'none' }) }}>
                  <Typography sx={{ fontWeight: 800, mb: 1 }}>История статусов</Typography>
                  {detailsStatusLog.length === 0 ? (
                    <Typography variant="body2" sx={{ color: ui.mutedText }}>
                      Переходы статусов пока не зафиксированы.
                    </Typography>
                  ) : (
                    <Stack spacing={0.9}>
                      {detailsStatusLog.map((item, index) => (
                        <Stack key={item.id || `${item.changed_at}-${index}`} direction="row" spacing={1}>
                          <Box sx={{ width: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: '999px', bgcolor: statusMeta(item.new_status).color, mt: 0.4 }} />
                            {index < detailsStatusLog.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: ui.border, minHeight: 18, borderRadius: '999px' }} />}
                          </Box>
                          <Box sx={{ flex: 1, pb: 0.4 }}>
                            <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
                              {`${item.old_status ? statusMeta(item.old_status).label : 'Создано'} -> ${statusMeta(item.new_status).label}`}
                            </Typography>
                            <Typography variant="caption" sx={{ color: ui.subtleText }}>
                              {item.changed_by_username || '-'} · {formatDateTime(item.changed_at)}
                            </Typography>
                          </Box>
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                {detailsLoading ? 'Загрузка карточки задачи...' : 'Карточка задачи недоступна.'}
              </Typography>
            )}
          </Box>
        </Drawer>
        */}

        <Dialog
          open={createOpen}
          onClose={handleCloseCreateDialog}
          fullScreen={isMobile}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <DialogContent sx={{ px: { xs: 1.2, sm: 2.2 }, py: { xs: 1.2, sm: 1.8 } }}>
            <Stack spacing={1.35}>
              <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1.2, sm: 1.6 }, borderRadius: '16px' }) }}>
                <Stack direction="row" alignItems="flex-start" spacing={1}>
                  <TextField
                    value={createData.title}
                    onChange={(event) => setCreateData((prev) => ({ ...prev, title: event.target.value }))}
                    fullWidth
                    required
                    autoFocus={!isMobile}
                    variant="standard"
                    placeholder="Название задачи"
                    inputProps={{ 'aria-label': 'Что нужно сделать' }}
                    InputProps={{ disableUnderline: true }}
                    error={createData.title.length > 0 && createData.title.trim().length < 3}
                    helperText={createData.title.length > 0 && createData.title.trim().length < 3 ? 'Минимум 3 символа' : ' '}
                    sx={{
                      '& .MuiInputBase-input': {
                        py: 0.2,
                        fontSize: { xs: '1.25rem', sm: '1.45rem' },
                        fontWeight: 900,
                        lineHeight: 1.18,
                      },
                      '& .MuiInputBase-input::placeholder': {
                        color: ui.mutedText,
                        opacity: 0.8,
                      },
                      '& .MuiFormHelperText-root': { mx: 0, mt: 0.35 },
                    }}
                  />
                  <Tooltip title="Закрыть">
                    <span>
                      <IconButton
                        size="small"
                        onClick={handleCloseCreateDialog}
                        disabled={createSaving}
                        aria-label="Закрыть создание задачи"
                        sx={{ mt: 0.1 }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                {isMobile ? (
                  <Button
                    type="button"
                    fullWidth
                    data-testid="create-description-mobile-open"
                    onClick={() => handleOpenCreateMobileSheet('description')}
                    sx={{
                      mt: 0.2,
                      px: 0,
                      py: 0.55,
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      textTransform: 'none',
                      color: createDescriptionSummary ? ui.text : ui.mutedText,
                      borderRadius: '10px',
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 850, fontSize: '0.92rem', lineHeight: 1.25 }}>
                        Описание
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{
                          color: createDescriptionSummary ? ui.mutedText : ui.subtleText,
                          mt: 0.25,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {createDescriptionSummary || 'Добавить описание задачи'}
                      </Typography>
                    </Box>
                  </Button>
                ) : (
                  <LocalTaskDescriptionField
                    initialValue={createData.description}
                    onDraftChange={handleCreateDescriptionDraftChange}
                    resetKey={createOpen ? 'open' : 'closed'}
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={5}
                    variant="standard"
                    placeholder="Описание"
                    inputProps={{ 'aria-label': 'Описание' }}
                    InputProps={{ disableUnderline: true }}
                    sx={{
                      mt: 0.2,
                      '& .MuiInputBase-input': { color: ui.text, fontSize: '0.96rem', lineHeight: 1.45 },
                      '& .MuiInputBase-input::placeholder': { color: ui.mutedText, opacity: 0.85 },
                    }}
                  />
                )}

                <Stack spacing={1.05} sx={{ mt: 1.2 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.45, sm: 1.4 }} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Typography sx={{ width: { sm: 120 }, flexShrink: 0, color: ui.subtleText, fontSize: '0.86rem', fontWeight: 700 }}>
                      Исполнитель
                    </Typography>
                    {isMobile ? (
                      <Button
                        type="button"
                        fullWidth
                        data-testid="create-assignees-mobile-open"
                        onClick={() => handleOpenCreateMobileSheet('assignees')}
                        sx={{
                          justifyContent: 'flex-start',
                          minHeight: 38,
                          px: 0,
                          textAlign: 'left',
                          textTransform: 'none',
                          color: createAssigneeSummary ? ui.text : ui.mutedText,
                          borderRadius: '10px',
                          outline: selectedCreateAssignees.length === 0 && createData.title.trim().length > 0 ? `1px solid ${alpha(theme.palette.error.main, 0.65)}` : 'none',
                          outlineOffset: 2,
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography sx={{ fontWeight: 900, fontSize: '0.95rem', lineHeight: 1.25 }} noWrap>
                            {createAssigneeSummary || 'Выбрать исполнителя'}
                          </Typography>
                          {selectedCreateAssignees.length === 0 && createData.title.trim().length > 0 ? (
                            <Typography variant="caption" sx={{ color: theme.palette.error.main, fontWeight: 800 }}>
                              Выберите хотя бы одного исполнителя
                            </Typography>
                          ) : null}
                        </Box>
                      </Button>
                    ) : (
                      <Autocomplete
                        multiple
                        fullWidth
                        size="small"
                        options={assignees}
                        value={selectedCreateAssignees}
                        onChange={(_, value) => handleChangeCreateAssigneeIds(Array.isArray(value) ? value.map((item) => String(item?.id || '')).filter(Boolean) : [])}
                        getOptionLabel={getTaskUserLabel}
                        filterOptions={filterTaskUserOptions}
                        isOptionEqualToValue={areSameTaskUsers}
                        disableCloseOnSelect
                        filterSelectedOptions
                        noOptionsText="Ничего не найдено"
                        renderOption={(props, option, { selected }) => {
                          const { key, ...optionProps } = props;
                          return (
                            <Box component="li" key={key} {...optionProps}>
                              <Checkbox checked={selected} sx={{ mr: 1 }} />
                              <Typography>{getTaskUserLabel(option)}</Typography>
                            </Box>
                          );
                        }}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            variant="standard"
                            placeholder={selectedCreateAssignees.length === 0 ? 'Фамилия или логин' : ''}
                            InputProps={{ ...params.InputProps, disableUnderline: true }}
                            inputProps={{ ...params.inputProps, 'aria-label': 'Исполнители' }}
                            sx={{
                              '& .MuiInputBase-root': { minHeight: 34 },
                              '& .MuiChip-root': { borderRadius: '999px', fontWeight: 800 },
                            }}
                          />
                        )}
                      />
                    )}
                  </Stack>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.45, sm: 1.4 }} alignItems={{ xs: 'stretch', sm: 'center' }}>
                    <Typography sx={{ width: { sm: 120 }, flexShrink: 0, color: ui.subtleText, fontSize: '0.86rem', fontWeight: 700 }}>
                      Крайний срок
                    </Typography>
                    {isMobile ? (
                      <Button
                        type="button"
                        fullWidth
                        variant="text"
                        data-testid="create-due-mobile-open"
                        onClick={() => setCreateDueSheetOpen(true)}
                        startIcon={<CalendarMonthOutlinedIcon />}
                        sx={{
                          justifyContent: 'flex-start',
                          minHeight: 34,
                          px: 0,
                          color: ui.text,
                          textTransform: 'none',
                          fontWeight: 800,
                          borderRadius: '10px',
                          '& .MuiButton-startIcon': { color: theme.palette.primary.main },
                        }}
                      >
                        {createDueLabel}
                      </Button>
                    ) : (
                      <TextField
                        type="datetime-local"
                        value={createData.due_at}
                        onChange={(event) => setCreateData((prev) => ({ ...prev, due_at: event.target.value }))}
                        fullWidth
                        size="small"
                        variant="standard"
                        inputProps={{ 'aria-label': 'Крайний срок' }}
                        InputProps={{
                          disableUnderline: true,
                          startAdornment: <CalendarMonthOutlinedIcon sx={{ mr: 1, fontSize: 19, color: theme.palette.primary.main }} />,
                        }}
                        sx={{ '& .MuiInputBase-root': { minHeight: 34 } }}
                      />
                    )}
                  </Stack>
                </Stack>

                <Divider sx={{ my: 1.25, borderColor: ui.borderSoft }} />

                <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap">
                  {createOptionalSectionOptions.map((option) => {
                    const selected = option.key === 'priority'
                      ? createData.priority !== 'normal'
                      : Boolean(createOptionalSections[option.key]);
                    const IconComponent = option.icon;
                    let label = option.label;
                    if (option.key === 'priority' && createData.priority !== 'normal') {
                      label = priorityMeta(createData.priority).label;
                    } else if (option.key === 'files' && createFiles.length > 0) {
                      label = `${option.label}: ${createFiles.length}`;
                    } else if (option.key === 'checklist') {
                      const count = normalizeChecklistItems(createChecklistItems).length;
                      if (count > 0) label = `Чек-лист: ${count}`;
                    } else if (option.key === 'controller' && selectedCreateController) {
                      label = `Контролёр: ${getTaskUserLabel(selectedCreateController)}`;
                    } else if (option.key === 'project' && effectiveCreateProject) {
                      label = `Проект: ${effectiveCreateProject.name}`;
                    }
                    return (
                      <Chip
                        key={option.key}
                        clickable
                        icon={IconComponent ? <IconComponent /> : undefined}
                        color={selected ? 'primary' : 'default'}
                        variant={selected ? 'filled' : 'outlined'}
                        label={label}
                        onClick={() => handleOpenCreateMobileSheet(option.key)}
                        sx={{
                          fontWeight: 800,
                          borderRadius: '8px',
                          ...(option.key === 'priority' && selected ? {
                            bgcolor: alpha(priorityMeta(createData.priority).dotColor, 0.16),
                            color: priorityMeta(createData.priority).dotColor,
                            '& .MuiChip-icon': { color: `${priorityMeta(createData.priority).dotColor} !important` },
                          } : {}),
                        }}
                      />
                    );
                  })}
                </Stack>

                <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 1.05 }}>
                  <Chip size="small" variant="outlined" label={`Дата постановки: ${createData.protocol_date ? formatShortDate(createData.protocol_date) : 'сегодня'}`} />
                  <Chip size="small" variant="outlined" label={`Приоритет: ${priorityMeta(createData.priority).label}`} />
                  {createFiles.length > 0 ? <Chip size="small" variant="outlined" icon={<AttachFileIcon />} label={`Файлы: ${createFiles.length}`} /> : null}
                </Stack>
              </Box>

              <Collapse in={Boolean(!isMobile && (createOptionalSections.controller || createOptionalSections.advanced))} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px' }) }}>
                  <Autocomplete
                    fullWidth
                    size="small"
                    options={controllers}
                    value={selectedCreateController}
                    onChange={(_, value) => setCreateData((prev) => ({ ...prev, controller_user_id: String(value?.id || '') }))}
                    getOptionLabel={getTaskUserLabel}
                    filterOptions={filterTaskUserOptions}
                    isOptionEqualToValue={areSameTaskUsers}
                    clearOnEscape
                    noOptionsText="Ничего не найдено"
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Контролёр"
                        placeholder="Фамилия или логин"
                      />
                    )}
                  />
                </Box>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.checklist)} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px' }) }}>
                  <Stack spacing={0.9}>
                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontWeight: 900 }}>Чек-лист</Typography>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddIcon />}
                        onClick={handleAddChecklistItem}
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
                      >
                        Пункт
                      </Button>
                    </Stack>
                    {createChecklistItems.map((item, index) => (
                      <Stack key={item.id} direction="row" spacing={0.8} alignItems="center">
                        <Checkbox
                          checked={Boolean(item.done)}
                          onChange={(event) => handleUpdateChecklistItem(item.id, { done: event.target.checked })}
                          inputProps={{ 'aria-label': `Пункт чек-листа ${index + 1}` }}
                          sx={{ p: 0.4 }}
                        />
                        <TextField
                          value={item.text}
                          onChange={(event) => handleUpdateChecklistItem(item.id, { text: event.target.value })}
                          placeholder={`Пункт ${index + 1}`}
                          size="small"
                          fullWidth
                        />
                        <Tooltip title="Удалить пункт">
                          <span>
                            <IconButton
                              size="small"
                              onClick={() => handleRemoveChecklistItem(item.id)}
                              aria-label={`Удалить пункт ${index + 1}`}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    ))}
                  </Stack>
                </Box>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.files)} unmountOnExit>
                <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: { xs: 1, sm: 1.2 }, borderRadius: '12px' }) }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
                    <Typography sx={{ fontWeight: 900 }}>Файлы к задаче</Typography>
                    <Button
                      component="label"
                      size="small"
                      variant="outlined"
                      startIcon={<AttachFileIcon />}
                      disabled={createSaving}
                      sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', alignSelf: { xs: 'stretch', sm: 'center' } }}
                    >
                      {createFiles.length > 0 ? 'Добавить файлы' : 'Выбрать файлы'}
                      <input
                        type="file"
                        hidden
                        multiple
                        onChange={(event) => {
                          handleAddCreateFiles(event.target.files);
                          event.target.value = '';
                        }}
                      />
                    </Button>
                  </Stack>

                  {createFiles.length === 0 ? (
                    <Typography variant="body2" sx={{ color: ui.mutedText, mt: 1 }}>
                      Файлы можно выбрать до постановки задачи. После создания они прикрепятся автоматически.
                    </Typography>
                  ) : (
                    <Stack spacing={0.7} sx={{ mt: 1 }}>
                      {createFiles.map((file, index) => (
                        <Box
                          key={`${getFileIdentity(file)}:${index}`}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1,
                            minHeight: 44,
                            px: 1,
                            py: 0.7,
                            border: '1px solid',
                            borderColor: ui.borderSoft,
                            borderRadius: '10px',
                            bgcolor: ui.panelSolid,
                          }}
                        >
                          <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                            <AttachFileIcon sx={{ fontSize: 15 }} />
                          </Avatar>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography sx={{ fontWeight: 800, fontSize: '0.86rem' }} noWrap title={file?.name || 'file'}>
                              {file?.name || 'file'}
                            </Typography>
                            <Typography variant="caption" sx={{ color: ui.subtleText }}>
                              {formatFileSize(file?.size)}
                            </Typography>
                          </Box>
                          <Tooltip title="Убрать файл">
                            <span>
                              <IconButton
                                size="small"
                                aria-label={`Убрать файл ${file?.name || index + 1}`}
                                onClick={() => handleRemoveCreateFile(index)}
                                disabled={createSaving}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </Box>
                      ))}
                    </Stack>
                  )}
                </Box>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.schedule)} unmountOnExit>
                <Grid container spacing={1.2}>
                  <Grid item xs={12} md={4}>
                    <TextField
                      label="Дата постановки задачи"
                      type="date"
                      value={createData.protocol_date}
                      onChange={(event) => setCreateData((prev) => ({ ...prev, protocol_date: event.target.value }))}
                      InputLabelProps={{ shrink: true }}
                      fullWidth
                      size="small"
                    />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <TextField label="Срок" type="datetime-local" value={createData.due_at} onChange={(event) => setCreateData((prev) => ({ ...prev, due_at: event.target.value }))} InputLabelProps={{ shrink: true }} fullWidth size="small" />
                  </Grid>
                  <Grid item xs={12} md={4}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="create-priority-label">Приоритет</InputLabel>
                      <Select labelId="create-priority-label" label="Приоритет" value={createData.priority} onChange={(event) => setCreateData((prev) => ({ ...prev, priority: event.target.value }))}>
                        {priorityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.project)} unmountOnExit>
                <Grid container spacing={1.2} alignItems="flex-start">
                  <Grid item xs={12}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="create-project-label">Проект</InputLabel>
                      <Select
                        labelId="create-project-label"
                        label="Проект"
                        value={effectiveCreateProjectId}
                        onChange={(event) => setCreateData((prev) => ({
                          ...prev,
                          project_id: String(event.target.value || ''),
                          object_id: '',
                        }))}
                      >
                        {activeTaskProjects.map((item) => (
                          <MenuItem key={item.id} value={String(item.id)}>
                            {item.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid item xs={12}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <TextField
                        label="Новый проект"
                        value={createProjectName}
                        onChange={(event) => setCreateProjectName(event.target.value)}
                        size="small"
                        fullWidth
                        placeholder="Например: Переезд бухгалтерии"
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleCreateProjectFromTaskDialog();
                          }
                        }}
                      />
                      <Button
                        variant="outlined"
                        onClick={() => void handleCreateProjectFromTaskDialog()}
                        disabled={createProjectSaving || String(createProjectName || '').trim().length < 2}
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', whiteSpace: 'nowrap' }}
                      >
                        {createProjectSaving ? 'Создание...' : 'Добавить'}
                      </Button>
                    </Stack>
                  </Grid>
                </Grid>
              </Collapse>

              <Collapse in={Boolean(!isMobile && createOptionalSections.access)} unmountOnExit>
                <Grid container spacing={1.2}>
                  <Grid item xs={12} md={6}>
                    <Autocomplete
                      fullWidth
                      size="small"
                      options={departments}
                      value={selectedCreateDepartment}
                      onChange={(_, value) => setCreateData((prev) => ({
                        ...prev,
                        department_id: String(value?.id || ''),
                        visibility_scope: value?.id ? (prev.visibility_scope || 'department') : 'private',
                      }))}
                      getOptionLabel={getDepartmentLabel}
                      isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
                      clearOnEscape
                      noOptionsText="Ничего не найдено"
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Отдел"
                          placeholder="Автоматически по исполнителю"
                        />
                      )}
                    />
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="create-visibility-label">Видимость</InputLabel>
                      <Select
                        labelId="create-visibility-label"
                        label="Видимость"
                        value={createData.visibility_scope}
                        onChange={(event) => setCreateData((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                      >
                        {taskVisibilityOptions.map((item) => (
                          <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>
              </Collapse>
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
            <Button onClick={handleCloseCreateDialog} disabled={createSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button
              variant="contained"
              onClick={handleCreateTask}
              disabled={
                createSaving
                || String(createData.title || '').trim().length < 3
                || createData.assignee_user_ids.length === 0
                || !effectiveCreateProjectId
                || !String(createData.protocol_date || '').trim()
              }
              sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
            >
              {createSaving ? 'Создание...' : `Создать${(Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids.length : 0) > 1 ? ` (${createData.assignee_user_ids.length})` : ''}`}
            </Button>
          </DialogActions>
        </Dialog>

        <Drawer
          data-testid="create-due-mobile-drawer"
          anchor="bottom"
          open={Boolean(isMobile && createDueSheetOpen)}
          onClose={() => {
            setCreateDueSheetOpen(false);
            setCreateDueCustomOpen(false);
          }}
          sx={{ zIndex: theme.zIndex.modal + 2 }}
          PaperProps={{
            style: { zIndex: theme.zIndex.modal + 3 },
            sx: {
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              bgcolor: ui.panelSolid,
              color: ui.text,
              borderTop: '1px solid',
              borderColor: ui.borderSoft,
              boxShadow: ui.dialogShadow,
              maxHeight: '82dvh',
              overflow: 'hidden',
            },
          }}
        >
          <Box
            data-testid="create-due-mobile-sheet"
            sx={{
              px: 2,
              pt: 1.1,
              pb: 'calc(1.4rem + env(safe-area-inset-bottom, 0px))',
            }}
          >
            <Box sx={{ width: 54, height: 5, borderRadius: 999, bgcolor: alpha(ui.mutedText, 0.35), mx: 'auto', mb: 1.4 }} />
            <Typography sx={{ textAlign: 'center', fontWeight: 950, fontSize: '1.16rem', mb: 1.2 }}>
              Крайний срок
            </Typography>
            <Stack spacing={0.15}>
              {createDuePresets.map((preset) => {
                const selected = String(createData.due_at || '') === String(preset.value || '');
                return (
                  <Button
                    key={preset.key}
                    data-testid={`create-due-preset-${preset.key}`}
                    onClick={() => handleSelectCreateDuePreset(preset.value)}
                    sx={{
                      minHeight: 64,
                      px: 1.3,
                      py: 0.9,
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      textTransform: 'none',
                      borderRadius: '14px',
                      color: ui.text,
                      bgcolor: selected ? alpha(theme.palette.primary.main, 0.16) : 'transparent',
                      '&:hover': {
                        bgcolor: selected ? alpha(theme.palette.primary.main, 0.2) : ui.actionHover,
                      },
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 900, fontSize: '1rem', lineHeight: 1.15 }}>
                        {preset.label}
                      </Typography>
                      {preset.description ? (
                        <Typography variant="body2" sx={{ color: ui.subtleText, mt: 0.35 }}>
                          {preset.description}
                        </Typography>
                      ) : null}
                    </Box>
                    {selected ? <CheckIcon sx={{ color: theme.palette.primary.main, flexShrink: 0 }} /> : null}
                  </Button>
                );
              })}

              <Button
                data-testid="create-due-custom-open"
                onClick={handleOpenCreateCustomDue}
                endIcon={<CalendarMonthOutlinedIcon />}
                sx={{
                  minHeight: 60,
                  px: 1.3,
                  py: 0.9,
                  justifyContent: 'space-between',
                  textAlign: 'left',
                  textTransform: 'none',
                  borderRadius: '14px',
                  color: ui.text,
                  '&:hover': { bgcolor: ui.actionHover },
                }}
              >
                <Typography sx={{ fontWeight: 900, fontSize: '1rem' }}>
                  Указать свою дату
                </Typography>
              </Button>
            </Stack>

            <Collapse in={createDueCustomOpen} unmountOnExit>
              <Stack spacing={1} sx={{ mt: 1.1 }}>
                <TextField
                  data-testid="create-due-custom-input"
                  label="Свой срок"
                  type="datetime-local"
                  value={createData.due_at}
                  onChange={(event) => setCreateData((prev) => ({ ...prev, due_at: event.target.value }))}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  size="small"
                />
                <Button
                  variant="contained"
                  onClick={() => {
                    setCreateDueSheetOpen(false);
                    setCreateDueCustomOpen(false);
                  }}
                  sx={{ textTransform: 'none', fontWeight: 900, borderRadius: '12px', boxShadow: 'none' }}
                >
                  Готово
                </Button>
              </Stack>
            </Collapse>
          </Box>
        </Drawer>

        <Drawer
          data-testid="create-mobile-sheet-drawer"
          anchor="bottom"
          open={Boolean(isMobile && createMobileSheet)}
          onClose={handleCloseCreateMobileSheet}
          sx={{ zIndex: theme.zIndex.modal + 2 }}
          PaperProps={{
            style: { zIndex: theme.zIndex.modal + 3 },
            sx: {
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              bgcolor: ui.panelSolid,
              color: ui.text,
              borderTop: '1px solid',
              borderColor: ui.borderSoft,
              boxShadow: ui.dialogShadow,
              height: isCreateTallMobileSheet ? '90dvh' : 'auto',
              maxHeight: isCreateTallMobileSheet ? '92dvh' : '88dvh',
              overflow: 'hidden',
            },
          }}
        >
          <Box
            data-testid="create-mobile-sheet"
            sx={{
              px: 2,
              pt: 1.1,
              pb: isCreateTallMobileSheet ? 0 : 'calc(1.4rem + env(safe-area-inset-bottom, 0px))',
              height: isCreateTallMobileSheet ? '100%' : 'auto',
              maxHeight: isCreateTallMobileSheet ? 'none' : '88dvh',
              overflowY: isCreateTallMobileSheet ? 'hidden' : 'auto',
              ...hideMobileScrollbarSx,
            }}
          >
            <Box sx={{ width: 54, height: 5, borderRadius: 999, bgcolor: alpha(ui.mutedText, 0.35), mx: 'auto', mb: 1.4 }} />
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: isCreateDescriptionMobileSheet ? 1.8 : 1.2 }}>
              <Typography sx={{ fontWeight: 950, fontSize: isCreateDescriptionMobileSheet ? '1.52rem' : '1.16rem', textAlign: isCreateDescriptionMobileSheet ? 'center' : 'left', flex: isCreateDescriptionMobileSheet ? 1 : 'initial' }}>
                {createMobileSheetTitle}
              </Typography>
              <IconButton size="small" aria-label="Закрыть плашку" onClick={handleCloseCreateMobileSheet} sx={{ visibility: isCreateDescriptionMobileSheet ? 'hidden' : 'visible' }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Box sx={{ height: isCreateTallMobileSheet ? 'calc(100% - 72px)' : 'auto', minHeight: 0 }}>
              {createMobileSheetContent}
            </Box>
          </Box>
        </Drawer>

        <Dialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          fullScreen={isMobile}
          fullWidth
          maxWidth="md"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }), position: { xs: 'sticky', sm: 'static' }, top: 0, zIndex: 2 }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Редактирование задачи</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
              Автор и администратор могут менять состав участников, срок, приоритет и описание.
            </Typography>
          </Box>

          <DialogContent sx={{ px: { xs: 1, sm: 2.2 }, py: { xs: 1, sm: 1.6 } }}>
            <Stack spacing={1.5}>
              <TextField label="Заголовок" value={editData.title} onChange={(event) => setEditData((prev) => ({ ...prev, title: event.target.value }))} fullWidth required />

              <LocalTaskMarkdownEditor
                label="Описание"
                initialValue={editData.description}
                onDraftChange={handleEditDescriptionDraftChange}
                resetKey={editData.id}
                minRows={6}
                enableAiTransform
                transformContext="task"
                onAiTransform={transformTaskMarkdown}
                visualVariant="taskDialog"
              />

              <Grid container spacing={1.2}>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    fullWidth
                    size="small"
                    options={assignees}
                    value={selectedEditAssignee}
                    onChange={(_, value) => setEditData((prev) => ({ ...prev, assignee_user_id: String(value?.id || '') }))}
                    getOptionLabel={getTaskUserLabel}
                    filterOptions={filterTaskUserOptions}
                    isOptionEqualToValue={areSameTaskUsers}
                    clearOnEscape
                    noOptionsText="Ничего не найдено"
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Исполнитель"
                        placeholder="Введите фамилию или логин"
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    fullWidth
                    size="small"
                    options={controllers}
                    value={selectedEditController}
                    onChange={(_, value) => setEditData((prev) => ({ ...prev, controller_user_id: String(value?.id || '') }))}
                    getOptionLabel={getTaskUserLabel}
                    filterOptions={filterTaskUserOptions}
                    isOptionEqualToValue={areSameTaskUsers}
                    clearOnEscape
                    noOptionsText="Ничего не найдено"
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Контролёр"
                        placeholder="Введите фамилию или логин"
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    fullWidth
                    size="small"
                    options={departments}
                    value={selectedEditDepartment}
                    onChange={(_, value) => setEditData((prev) => ({
                      ...prev,
                      department_id: String(value?.id || ''),
                      visibility_scope: value?.id ? (prev.visibility_scope || 'department') : 'private',
                    }))}
                    getOptionLabel={getDepartmentLabel}
                    isOptionEqualToValue={(option, value) => String(option?.id || '') === String(value?.id || '')}
                    clearOnEscape
                    noOptionsText="Ничего не найдено"
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Отдел"
                        placeholder="Без отдела"
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-visibility-label">Видимость</InputLabel>
                    <Select
                      labelId="edit-visibility-label"
                      label="Видимость"
                      value={editData.visibility_scope}
                      onChange={(event) => setEditData((prev) => ({ ...prev, visibility_scope: event.target.value }))}
                    >
                      {taskVisibilityOptions.map((item) => (
                        <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-project-label">Проект</InputLabel>
                    <Select
                      labelId="edit-project-label"
                      label="Проект"
                      value={editData.project_id}
                      onChange={(event) => setEditData((prev) => ({
                        ...prev,
                        project_id: String(event.target.value || ''),
                        object_id: '',
                      }))}
                    >
                      {activeTaskProjects.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-object-label">Объект</InputLabel>
                    <Select
                      labelId="edit-object-label"
                      label="Объект"
                      value={editData.object_id}
                      onChange={(event) => setEditData((prev) => ({ ...prev, object_id: String(event.target.value || '') }))}
                      disabled={!editData.project_id}
                    >
                      <MenuItem value="">Без объекта</MenuItem>
                      {editProjectObjects.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="Дата постановки задачи"
                    type="date"
                    value={editData.protocol_date}
                    onChange={(event) => setEditData((prev) => ({ ...prev, protocol_date: event.target.value }))}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="Срок" type="datetime-local" value={editData.due_at} onChange={(event) => setEditData((prev) => ({ ...prev, due_at: event.target.value }))} InputLabelProps={{ shrink: true }} fullWidth size="small" />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-priority-label">Приоритет</InputLabel>
                    <Select labelId="edit-priority-label" label="Приоритет" value={editData.priority} onChange={(event) => setEditData((prev) => ({ ...prev, priority: event.target.value }))}>
                      {priorityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
            <Button onClick={() => setEditOpen(false)} disabled={editSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button variant="contained" onClick={handleSaveEdit} disabled={editSaving || String(editData.title || '').trim().length < 3} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
              {editSaving ? 'Сохранение...' : 'Сохранить изменения'}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={taxonomyOpen}
          onClose={() => setTaxonomyOpen(false)}
          fullScreen={isMobile}
          fullWidth
          maxWidth="md"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }), position: { xs: 'sticky', sm: 'static' }, top: 0, zIndex: 2 }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Проекты и объекты</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
              Справочники для постановки задач и аналитики по объектам.
            </Typography>
          </Box>
          <DialogContent sx={{ px: { xs: 1, sm: 2.2 }, py: { xs: 1, sm: 1.7 } }}>
            <Grid container spacing={1.4}>
              <Grid item xs={12} md={6}>
                <Stack spacing={1.1}>
                  <Typography sx={{ fontWeight: 800 }}>
                    {editingProjectId ? 'Редактирование проекта' : 'Новый проект'}
                  </Typography>
                  <TextField label="Название проекта" size="small" value={projectDraft.name} onChange={(event) => setProjectDraft((prev) => ({ ...prev, name: event.target.value }))} fullWidth />
                  <TextField label="Код" size="small" value={projectDraft.code} onChange={(event) => setProjectDraft((prev) => ({ ...prev, code: event.target.value }))} fullWidth />
                  <TextField label="Описание" size="small" value={projectDraft.description} onChange={(event) => setProjectDraft((prev) => ({ ...prev, description: event.target.value }))} multiline minRows={3} fullWidth />
                  <FormControlLabel
                    control={<Switch checked={projectDraft.is_active !== false} onChange={(event) => setProjectDraft((prev) => ({ ...prev, is_active: event.target.checked }))} />}
                    label="Активный проект"
                  />
                  <Button variant="contained" onClick={() => void handleCreateProject()} disabled={taxonomySaving || String(projectDraft.name || '').trim().length < 2} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                    {editingProjectId ? 'Сохранить проект' : 'Добавить проект'}
                  </Button>
                  {editingProjectId ? (
                    <Button variant="outlined" onClick={resetProjectDraft} disabled={taxonomySaving} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      Отменить редактирование
                    </Button>
                  ) : null}
                  <Stack spacing={0.7}>
                    {taskProjects.map((item) => (
                      <Box key={item.id} sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '12px' }) }}>
                        <Typography sx={{ fontWeight: 800 }}>{item.name}</Typography>
                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.45, mb: 0.25 }}>
                          <Chip
                            size="small"
                            label={item.is_active === false ? 'Архив' : 'Активен'}
                            sx={{ height: 22, fontWeight: 800, bgcolor: item.is_active === false ? alpha(theme.palette.text.secondary, 0.12) : alpha('#059669', 0.12), color: item.is_active === false ? 'text.secondary' : '#059669' }}
                          />
                          <Button size="small" variant="text" startIcon={<EditIcon sx={{ fontSize: 15 }} />} onClick={() => handleEditProject(item)} sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, px: 0.5 }}>
                            Править
                          </Button>
                        </Stack>
                        <Typography variant="caption" sx={{ color: ui.subtleText }}>
                          {item.code || 'Без кода'}
                          {Number(projectObjectCounts[String(item.id)] || 0) > 0 ? ` · Объектов: ${projectObjectCounts[String(item.id)]}` : ''}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              </Grid>
              <Grid item xs={12} md={6}>
                <Stack spacing={1.1}>
                  <Typography sx={{ fontWeight: 800 }}>
                    {editingObjectId ? 'Редактирование объекта' : 'Новый объект'}
                  </Typography>
                  <FormControl fullWidth size="small">
                    <InputLabel id="taxonomy-project-label">Проект</InputLabel>
                    <Select
                      labelId="taxonomy-project-label"
                      label="Проект"
                      value={objectDraft.project_id}
                      onChange={(event) => setObjectDraft((prev) => ({ ...prev, project_id: String(event.target.value || '') }))}
                    >
                      {activeTaskProjects.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField label="Название объекта" size="small" value={objectDraft.name} onChange={(event) => setObjectDraft((prev) => ({ ...prev, name: event.target.value }))} fullWidth />
                  <TextField label="Код" size="small" value={objectDraft.code} onChange={(event) => setObjectDraft((prev) => ({ ...prev, code: event.target.value }))} fullWidth />
                  <TextField label="Описание" size="small" value={objectDraft.description} onChange={(event) => setObjectDraft((prev) => ({ ...prev, description: event.target.value }))} multiline minRows={3} fullWidth />
                  <FormControlLabel
                    control={<Switch checked={objectDraft.is_active !== false} onChange={(event) => setObjectDraft((prev) => ({ ...prev, is_active: event.target.checked }))} />}
                    label="Активный объект"
                  />
                  <Button
                    variant="contained"
                    onClick={() => void handleCreateObject()}
                    disabled={taxonomySaving || !String(objectDraft.project_id || '').trim() || String(objectDraft.name || '').trim().length < 2}
                    sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                  >
                    {editingObjectId ? 'Сохранить объект' : 'Добавить объект'}
                  </Button>
                  {editingObjectId ? (
                    <Button variant="outlined" onClick={resetObjectDraft} disabled={taxonomySaving} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      Отменить редактирование
                    </Button>
                  ) : null}
                  <Stack spacing={0.7}>
                    {taskObjects.map((item) => (
                      <Box key={item.id} sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '12px' }) }}>
                        <Typography sx={{ fontWeight: 800 }}>{item.name}</Typography>
                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mt: 0.45, mb: 0.25 }}>
                          <Chip
                            size="small"
                            label={item.is_active === false ? 'Архив' : 'Активен'}
                            sx={{ height: 22, fontWeight: 800, bgcolor: item.is_active === false ? alpha(theme.palette.text.secondary, 0.12) : alpha('#2563eb', 0.12), color: item.is_active === false ? 'text.secondary' : '#2563eb' }}
                          />
                          <Button size="small" variant="text" startIcon={<EditIcon sx={{ fontSize: 15 }} />} onClick={() => handleEditObject(item)} sx={{ textTransform: 'none', fontWeight: 700, minWidth: 0, px: 0.5 }}>
                            Править
                          </Button>
                        </Stack>
                        <Typography variant="caption" sx={{ color: ui.subtleText }}>
                          {taskProjects.find((project) => String(project.id) === String(item.project_id))?.name || 'Без проекта'}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                </Stack>
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
            <Button onClick={() => setTaxonomyOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Закрыть
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(reviewTask)}
          onClose={() => setReviewTask(null)}
          fullScreen={isMobile}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }), position: { xs: 'sticky', sm: 'static' }, top: 0, zIndex: 2 }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Проверка задачи</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
              Принять результат или вернуть задачу в работу с комментарием.
            </Typography>
          </Box>
          <DialogContent sx={{ px: { xs: 1, sm: 2.2 }, py: { xs: 1, sm: 1.6 } }}>
            <Stack spacing={1.2}>
              <Typography sx={{ fontWeight: 700 }}>{reviewTask?.title || '-'}</Typography>
              <TextField label="Комментарий проверки" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} multiline minRows={3} fullWidth />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
            <Button onClick={() => setReviewTask(null)} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button variant="outlined" color="warning" onClick={() => void handleReviewTask('reject')} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
              Вернуть
            </Button>
            <Button variant="contained" color="success" onClick={() => void handleReviewTask('approve')} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
              Принять
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(submitTask)}
          onClose={() => setSubmitTask(null)}
          fullScreen={isMobile}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }), position: { xs: 'sticky', sm: 'static' }, top: 0, zIndex: 2 }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Сдать работу</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
              Отправьте комментарий и, при необходимости, приложите итоговый файл.
            </Typography>
          </Box>
          <DialogContent sx={{ px: { xs: 1, sm: 2.2 }, py: { xs: 1, sm: 1.6 } }}>
            <Stack spacing={1.2}>
              <Typography sx={{ fontWeight: 700 }}>{submitTask?.title || '-'}</Typography>
              <TextField label="Комментарий к сдаче" value={submitComment} onChange={(event) => setSubmitComment(event.target.value)} multiline minRows={3} fullWidth />
              <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                {submitFile ? submitFile.name : 'Прикрепить файл'}
                <input type="file" hidden onChange={(event) => setSubmitFile(event.target.files?.[0] || null)} />
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: { xs: 1, sm: 2.2 }, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft, position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: ui.pageBg, flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 0.8, sm: 0 }, '& > :not(style)': { m: 0, width: { xs: '100%', sm: 'auto' } } }}>
            <Button onClick={() => { setSubmitTask(null); setSubmitFile(null); }} disabled={submitSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button variant="contained" onClick={handleSubmitTask} disabled={submitSaving} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
              {submitSaving ? 'Отправка...' : 'Сдать'}
            </Button>
          </DialogActions>
        </Dialog>

        {isMobile && canCreateTasks && !detailsOpen && !createOpen ? (
          <IconButton
            data-testid="tasks-create-fab"
            aria-label="Создать задачу"
            onClick={() => setCreateOpen(true)}
            sx={{
              position: 'fixed',
              right: 16,
              bottom: getAppShellMobileFabBottomOffset(),
              width: 58,
              height: 58,
              borderRadius: '999px',
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              boxShadow: '0 18px 40px rgba(37, 99, 235, 0.28)',
              zIndex: 14,
              '&:hover': {
                bgcolor: theme.palette.primary.dark,
              },
            }}
          >
            <AddIcon sx={{ fontSize: 28 }} />
          </IconButton>
        ) : null}
      </PageShell>
    </MainLayout>
  );
}

export default Tasks;
