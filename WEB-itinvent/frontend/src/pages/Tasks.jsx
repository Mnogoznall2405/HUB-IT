import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
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
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
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
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { hubAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useLocation, useNavigate } from 'react-router-dom';
import MarkdownRenderer from '../components/hub/MarkdownRenderer';
import MarkdownEditor from '../components/hub/MarkdownEditor';
import { buildOfficeUiTokens, getOfficeDialogPaperSx, getOfficeEmptyStateSx, getOfficeHeaderBandSx, getOfficeMetricBlockSx, getOfficePanelSx, getOfficeSubtlePanelSx } from '../theme/officeUiTokens';

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

const readTaskFilters = (search = '') => {
  const params = new URLSearchParams(search || '');
  return {
    viewMode: String(params.get('task_view') || ''),
    q: String(params.get('task_q') || ''),
    status: String(params.get('task_status') || ''),
    dueState: String(params.get('task_due') || ''),
    assigneeFilter: String(params.get('task_assignee') || ''),
    controllerFilter: String(params.get('task_controller') || ''),
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

function Tasks() {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const canWriteTasks = hasPermission('tasks.write');
  const canReviewTasks = hasPermission('tasks.review');
  const canUseCreatorTab = true;
  const canUseControllerTab = canReviewTasks;
  const initialFilters = readTaskFilters(location.search);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tasksPayload, setTasksPayload] = useState({ items: [], total: 0 });

  const [viewMode, setViewMode] = useState(() => initialFilters.viewMode || (isAdmin ? 'all' : 'assignee'));
  const [q, setQ] = useState(initialFilters.q);
  const [debouncedQ, setDebouncedQ] = useState(initialFilters.q);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [dueState, setDueState] = useState(initialFilters.dueState);
  const [assigneeFilter, setAssigneeFilter] = useState(initialFilters.assigneeFilter);
  const [controllerFilter, setControllerFilter] = useState(initialFilters.controllerFilter);
  const [hasAttachments, setHasAttachments] = useState(initialFilters.hasAttachments);
  const [unreadCommentsOnly, setUnreadCommentsOnly] = useState(initialFilters.unreadCommentsOnly);
  const [focusMode, setFocusMode] = useState(initialFilters.focusMode || 'all');
  const [showFilters, setShowFilters] = useState(false);

  const [assignees, setAssignees] = useState([]);
  const [controllers, setControllers] = useState([]);

  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsTask, setDetailsTask] = useState(null);
  const [detailsComments, setDetailsComments] = useState([]);
  const [detailsStatusLog, setDetailsStatusLog] = useState([]);
  const [detailsCommentBody, setDetailsCommentBody] = useState('');
  const [detailsCommentSaving, setDetailsCommentSaving] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createData, setCreateData] = useState({
    title: '',
    description: '',
    assignee_user_ids: [],
    controller_user_id: '',
    due_at: '',
    priority: 'normal',
  });

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
    priority: 'normal',
    assignee_user_id: '',
    controller_user_id: '',
  });

  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const searchInputRef = useRef(null);
  const detailsCommentsRef = useRef(null);

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

  const detailsOpen = Boolean(selectedTaskId);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(String(q || '').trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const next = readTaskFilters(location.search);
    const fallbackView = isAdmin ? 'all' : 'assignee';
    let nextView = next.viewMode || fallbackView;
    if (nextView === 'all' && !isAdmin) nextView = fallbackView;
    if (nextView === 'controller' && !canUseControllerTab) nextView = fallbackView;
    if (!['all', 'assignee', 'creator', 'controller'].includes(nextView)) nextView = fallbackView;

    setViewMode((prev) => (prev === nextView ? prev : nextView));
    setQ((prev) => (prev === next.q ? prev : next.q));
    setStatusFilter((prev) => (prev === next.status ? prev : next.status));
    setDueState((prev) => (prev === next.dueState ? prev : next.dueState));
    setAssigneeFilter((prev) => (prev === next.assigneeFilter ? prev : next.assigneeFilter));
    setControllerFilter((prev) => (prev === next.controllerFilter ? prev : next.controllerFilter));
    setHasAttachments((prev) => (prev === next.hasAttachments ? prev : next.hasAttachments));
    setUnreadCommentsOnly((prev) => (prev === next.unreadCommentsOnly ? prev : next.unreadCommentsOnly));
    setFocusMode((prev) => (prev === (next.focusMode || 'all') ? prev : (next.focusMode || 'all')));
  }, [location.search, isAdmin, canUseControllerTab]);

  useEffect(() => {
    updateSearch((params) => {
      if (viewMode && !(viewMode === 'assignee' && !isAdmin)) params.set('task_view', viewMode);
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
      if (hasAttachments) params.set('task_files', '1');
      else params.delete('task_files');
      if (unreadCommentsOnly) params.set('task_unread_comments', '1');
      else params.delete('task_unread_comments');
      if (focusMode && focusMode !== 'all') params.set('task_focus', focusMode);
      else params.delete('task_focus');
    });
  }, [
    assigneeFilter,
    controllerFilter,
    dueState,
    focusMode,
    hasAttachments,
    isAdmin,
    q,
    statusFilter,
    unreadCommentsOnly,
    updateSearch,
    viewMode,
  ]);

  const loadTaskUsers = useCallback(async () => {
    try {
      const [assigneesPayload, controllersPayload] = await Promise.all([
        hubAPI.getAssignees(),
        hubAPI.getControllers(),
      ]);
      setAssignees(Array.isArray(assigneesPayload?.items) ? assigneesPayload.items : []);
      setControllers(Array.isArray(controllersPayload?.items) ? controllersPayload.items : []);
    } catch {
      setAssignees([]);
      setControllers([]);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const scope = viewMode === 'all' ? 'all' : 'my';
      const roleScope = viewMode === 'all' ? 'both' : viewMode;
      const response = await hubAPI.getTasks({
        scope,
        role_scope: roleScope,
        status: statusFilter || undefined,
        q: debouncedQ || undefined,
        due_state: dueState || undefined,
        has_attachments: hasAttachments || undefined,
        assignee_user_id: isAdmin && viewMode === 'all' && assigneeFilter ? Number(assigneeFilter) : undefined,
        sort_by: 'status',
        sort_dir: 'asc',
        limit: 500,
      });
      setTasksPayload(response || { items: [], total: 0 });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки задач');
    } finally {
      setLoading(false);
    }
  }, [assigneeFilter, debouncedQ, dueState, hasAttachments, isAdmin, statusFilter, viewMode]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    void loadTaskUsers();
  }, [loadTaskUsers]);

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
    if (!task) return isAdmin ? 'all' : 'assignee';
    if (isAdmin) return 'all';
    if (canUseControllerTab && Number(task?.controller_user_id) === Number(user?.id)) return 'controller';
    if (canUseCreatorTab && Number(task?.created_by_user_id) === Number(user?.id)) return 'creator';
    return 'assignee';
  }, [canUseControllerTab, canUseCreatorTab, isAdmin, user?.id]);

  const loadTaskDetails = useCallback(async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId) return;
    setDetailsLoading(true);
    try {
      const task = await hubAPI.getTask(normalizedId);
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
      setDetailsTask(null);
      setDetailsComments([]);
      setDetailsStatusLog([]);
      setDetailsCommentBody('');
      return;
    }
    void loadTaskDetails(selectedTaskId);
  }, [loadTaskDetails, selectedTaskId]);

  useEffect(() => {
    if (!detailsCommentsRef.current) return;
    detailsCommentsRef.current.scrollTop = detailsCommentsRef.current.scrollHeight;
  }, [detailsComments]);

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
    hasAttachments,
    unreadCommentsOnly,
    focusMode !== 'all',
  ].filter(Boolean).length, [
    assigneeFilter,
    controllerFilter,
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
    setHasAttachments(false);
    setUnreadCommentsOnly(false);
    setFocusMode('all');
  }, []);

  const closeTaskDetails = useCallback(() => {
    setDetailsTask(null);
    setDetailsComments([]);
    setDetailsStatusLog([]);
    setDetailsCommentBody('');
    updateSearch((params) => {
      params.delete('task');
    });
  }, [updateSearch]);

  const openTaskDetails = useCallback((task) => {
    const id = String(task?.id || '').trim();
    if (!id) return;
    setDetailsLoading(true);
    setDetailsTask(null);
    setDetailsComments([]);
    setDetailsStatusLog([]);
    updateSearch((params) => {
      params.set('task', id);
    }, { replace: false });
  }, [updateSearch]);

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

  const refreshTasksAndDetails = useCallback(async (taskId = '') => {
    await loadTasks();
    if (taskId) {
      await loadTaskDetails(taskId);
    }
  }, [loadTaskDetails, loadTasks]);

  const handleCreateTask = async () => {
    const assigneeIds = Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : [];
    const controllerUserId = Number(createData.controller_user_id || 0);
    if (String(createData.title || '').trim().length < 3 || assigneeIds.length === 0 || controllerUserId <= 0) return;
    setCreateSaving(true);
    try {
      await hubAPI.createTask({
        title: String(createData.title || '').trim(),
        description: String(createData.description || '').trim(),
        assignee_user_ids: assigneeIds.map(Number).filter(Number.isInteger),
        controller_user_id: controllerUserId,
        due_at: String(createData.due_at || '').trim() || null,
        priority: createData.priority || 'normal',
      });
      setCreateOpen(false);
      setCreateData({
        title: '',
        description: '',
        assignee_user_ids: [],
        controller_user_id: '',
        due_at: '',
        priority: 'normal',
      });
      await loadTasks();
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка создания задачи');
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
    setEditData({
      id: String(task?.id || ''),
      title: task?.title || '',
      description: task?.description || '',
      due_at: toDateTimeInput(task?.due_at),
      priority: task?.priority || 'normal',
      assignee_user_id: String(task?.assignee_user_id || ''),
      controller_user_id: String(task?.controller_user_id || ''),
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
        description: String(editData.description || '').trim(),
        due_at: String(editData.due_at || '').trim() || null,
        priority: editData.priority || 'normal',
        assignee_user_id: Number(editData.assignee_user_id || 0) || null,
        controller_user_id: Number(editData.controller_user_id || 0) || null,
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

  const handleCopyTaskLink = useCallback(async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId || !navigator?.clipboard?.writeText) return;
    const url = new URL('/tasks', window.location.origin);
    url.searchParams.set('task', normalizedId);
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch {
      // ignore clipboard failures
    }
  }, []);

  const canDeleteTask = useCallback((task) => {
    if (!task?.id) return false;
    if (isAdmin) return true;
    return Number(task?.created_by_user_id) === Number(user?.id);
  }, [isAdmin, user?.id]);

  const canEditTask = useCallback((task) => {
    if (!task?.id) return false;
    if (isAdmin) return true;
    return Number(task?.created_by_user_id) === Number(user?.id);
  }, [isAdmin, user?.id]);

  const canReviewTask = useCallback((task) => {
    if (!task?.id || String(task?.status || '').toLowerCase() !== 'review') return false;
    if (isAdmin) return true;
    return Number(task?.created_by_user_id) === Number(user?.id)
      || (canReviewTasks && Number(task?.controller_user_id) === Number(user?.id));
  }, [canReviewTasks, isAdmin, user?.id]);

  const canStartTask = useCallback((task) => (
    Number(task?.assignee_user_id) === Number(user?.id)
    && String(task?.status || '').toLowerCase() === 'new'
  ), [user?.id]);

  const canSubmitTask = useCallback((task) => (
    Number(task?.assignee_user_id) === Number(user?.id)
    && ['new', 'in_progress'].includes(String(task?.status || '').toLowerCase())
  ), [user?.id]);

  const canUploadFiles = useCallback((task) => {
    if (!task?.id || String(task?.status || '').toLowerCase() === 'done') return false;
    if (isAdmin) return true;
    const actorId = Number(user?.id);
    return actorId > 0 && (
      Number(task?.assignee_user_id) === actorId
      || Number(task?.created_by_user_id) === actorId
      || Number(task?.controller_user_id) === actorId
    );
  }, [isAdmin, user?.id]);

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

      if (canWriteTasks && String(event.key || '').toLowerCase() === 'n') {
        event.preventDefault();
        setCreateOpen(true);
        return;
      }

      if (event.key === '/' || String(event.key || '').toLowerCase() === 'f') {
        event.preventDefault();
        setShowFilters(true);
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus?.();
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canWriteTasks, closeTaskDetails, createOpen, detailsOpen, editOpen, reviewTask, submitTask]);

  const renderTaskCard = useCallback((task, column) => {
    const latestComment = getTaskCommentPreview(task);
    const canEdit = canEditTask(task);
    const attachCount = Number(task?.attachments_count || 0);

    return (
      <Card
        key={task.id}
        className="task-card"
        onClick={() => openTaskDetails(task)}
        sx={{
          p: 1.15,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
          cursor: 'pointer',
          transition: 'border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease, background-color 0.16s ease',
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
              fontSize: '0.83rem',
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
  }, [canEditTask, handleCopyTaskLink, openEditTask, openTaskDetails, theme.palette.mode, ui.actionBg, ui.actionHover, ui.borderSoft, ui.dialogShadow, ui.mutedText, ui.panelSolid, ui.selectedBorder, ui.shellShadow, ui.subtleText]);

  return (
    <MainLayout>
      <PageShell fullHeight sx={{ bgcolor: ui.pageBg }}>
        <Box
          sx={{
            px: { xs: 1, md: 1.25 },
            py: 1,
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

          <Card sx={{ ...getOfficePanelSx(ui, { mb: 1, p: 1.05, borderRadius: '16px', flexShrink: 0 }) }}>
            <Stack spacing={0.9}>
              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.9}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Avatar sx={{ width: 36, height: 36, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                    <AssignmentIcon />
                  </Avatar>
                  <Box>
                    <Typography sx={{ fontWeight: 900, fontSize: '0.98rem', lineHeight: 1.1 }}>Задачи</Typography>
                    <Typography variant="caption" sx={{ color: ui.mutedText, display: 'block', mt: 0.2 }}>
                      Единая рабочая доска: исполнение, контроль, проверка и обсуждение в одном экране.
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                  <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => void loadTasks()} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                    Обновить
                  </Button>
                  {canWriteTasks && (
                    <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                      Новая задача
                    </Button>
                  )}
                </Stack>
              </Stack>

              <Grid container spacing={0.8}>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ ...getOfficeMetricBlockSx(ui, '#2563eb', { p: 0.8, minHeight: 66 }) }}>
                    <Typography sx={{ fontWeight: 900, color: '#2563eb', fontSize: '0.98rem', lineHeight: 1 }}>{openTasksCount}</Typography>
                    <Typography sx={{ mt: 0.4, fontWeight: 800, fontSize: '0.72rem' }}>Открыто сейчас</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ ...getOfficeMetricBlockSx(ui, '#7c3aed', { p: 0.8, minHeight: 66 }) }}>
                    <Typography sx={{ fontWeight: 900, color: '#7c3aed', fontSize: '0.98rem', lineHeight: 1 }}>{focusCounts.review}</Typography>
                    <Typography sx={{ mt: 0.4, fontWeight: 800, fontSize: '0.72rem' }}>Ждут проверки</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ ...getOfficeMetricBlockSx(ui, '#dc2626', { p: 0.8, minHeight: 66 }) }}>
                    <Typography sx={{ fontWeight: 900, color: '#dc2626', fontSize: '0.98rem', lineHeight: 1 }}>{focusCounts.overdue}</Typography>
                    <Typography sx={{ mt: 0.4, fontWeight: 800, fontSize: '0.72rem' }}>Просрочено</Typography>
                  </Box>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Box sx={{ ...getOfficeMetricBlockSx(ui, '#059669', { p: 0.8, minHeight: 66 }) }}>
                    <Typography sx={{ fontWeight: 900, color: '#059669', fontSize: '0.98rem', lineHeight: 1 }}>{focusCounts.comments}</Typography>
                    <Typography sx={{ mt: 0.4, fontWeight: 800, fontSize: '0.72rem' }}>Новые комментарии</Typography>
                  </Box>
                </Grid>
              </Grid>

              <Box sx={{ ...getOfficeSubtlePanelSx(ui, { borderRadius: '12px', px: 0.5 }) }}>
                <Tabs
                  value={viewMode}
                  onChange={(_, value) => setViewMode(value)}
                  variant="scrollable"
                  allowScrollButtonsMobile
                  sx={{
                    minHeight: 40,
                    '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, minHeight: 40, fontSize: '0.84rem' },
                    '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
                  }}
                >
                  {isAdmin && <Tab value="all" label="Все" />}
                  <Tab value="assignee" label="Исполняю" />
                  {canUseCreatorTab && <Tab value="creator" label="Созданные" />}
                  {canUseControllerTab && <Tab value="controller" label="На контроле" />}
                </Tabs>
              </Box>

              <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                  {focusOptions.map((option) => (
                    <Chip
                      key={option.value}
                      clickable
                      label={`${option.label}: ${focusCounts[option.value] || 0}`}
                      onClick={() => setFocusMode(option.value)}
                      sx={{
                        height: 24,
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
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                  <Button size="small" variant="text" startIcon={<FilterListIcon />} onClick={() => setShowFilters((prev) => !prev)} sx={{ textTransform: 'none', fontWeight: 800, py: 0.25 }}>
                    {showFilters ? 'Свернуть фильтры' : `Развернуть фильтры${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
                  </Button>
                  <Typography variant="caption" sx={{ color: ui.subtleText, lineHeight: 1.2 }}>
                    Горячие клавиши: `N` создать задачу, `/` или `F` открыть поиск, `Esc` закрыть окно.
                  </Typography>
                </Stack>
              </Stack>

              {showFilters && (
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
                      <FormControl fullWidth size="small">
                        <InputLabel id="tasks-assignee-filter-label">Исполнитель</InputLabel>
                        <Select labelId="tasks-assignee-filter-label" label="Исполнитель" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
                          <MenuItem value="">Все</MenuItem>
                          {assignees.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.full_name || item.username}</MenuItem>)}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} sm={6} md={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel id="tasks-controller-filter-label">Контролёр</InputLabel>
                        <Select labelId="tasks-controller-filter-label" label="Контролёр" value={controllerFilter} onChange={(event) => setControllerFilter(event.target.value)}>
                          <MenuItem value="">Все</MenuItem>
                          {controllers.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.full_name || item.username}</MenuItem>)}
                        </Select>
                      </FormControl>
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

          <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <Box
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
          </Box>
        </Box>

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

        <Dialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          fullWidth
          maxWidth="md"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }) }}>
            <Stack direction="row" alignItems="center" spacing={1.2}>
              <Avatar sx={{ width: 38, height: 38, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                <AddIcon />
              </Avatar>
              <Box>
                <Typography sx={{ fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.1 }}>Создать задачу</Typography>
                <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.2 }}>
                  Одна форма для постановки, контроля и дальнейшей сдачи.
                </Typography>
              </Box>
            </Stack>
          </Box>

          <DialogContent sx={{ px: 2.2, py: 1.7 }}>
            <Stack spacing={1.5}>
              <TextField
                label="Заголовок"
                value={createData.title}
                onChange={(event) => setCreateData((prev) => ({ ...prev, title: event.target.value }))}
                fullWidth
                required
                error={createData.title.length > 0 && createData.title.trim().length < 3}
                helperText={createData.title.length > 0 && createData.title.trim().length < 3 ? 'Минимум 3 символа' : ' '}
              />

              <MarkdownEditor
                label="Описание"
                value={createData.description}
                onChange={(value) => setCreateData((prev) => ({ ...prev, description: value }))}
                minRows={6}
                placeholder="Опишите задачу, критерии готовности и ожидания по результату."
                enableAiTransform
                transformContext="task"
                onAiTransform={transformTaskMarkdown}
                visualVariant="taskDialog"
              />

              <Grid container spacing={1.2}>
                <Grid item xs={12} md={7}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="create-assignees-label">Исполнители</InputLabel>
                    <Select
                      labelId="create-assignees-label"
                      label="Исполнители"
                      multiple
                      value={Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids : []}
                      onChange={(event) => setCreateData((prev) => ({ ...prev, assignee_user_ids: Array.isArray(event.target.value) ? event.target.value : [] }))}
                      renderValue={(selected) => {
                        const ids = Array.isArray(selected) ? selected : [];
                        if (ids.length === 0) {
                          return <Typography sx={{ color: ui.subtleText }}>Выберите исполнителей</Typography>;
                        }
                        return ids
                          .map((value) => assignees.find((item) => String(item.id) === String(value)))
                          .filter(Boolean)
                          .map((item) => item.full_name || item.username)
                          .join(', ');
                      }}
                    >
                      {assignees.map((item) => (
                        <MenuItem key={item.id} value={String(item.id)}>
                          <Checkbox checked={Array.isArray(createData.assignee_user_ids) && createData.assignee_user_ids.includes(String(item.id))} />
                          <Typography>{item.full_name || item.username}</Typography>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={5}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="create-controller-label">Контролёр</InputLabel>
                    <Select
                      labelId="create-controller-label"
                      label="Контролёр"
                      value={String(createData.controller_user_id || '')}
                      onChange={(event) => setCreateData((prev) => ({ ...prev, controller_user_id: String(event.target.value || '') }))}
                    >
                      {controllers.map((item) => (
                        <MenuItem key={item.id} value={String(item.id)}>
                          {item.full_name || item.username}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="Срок" type="datetime-local" value={createData.due_at} onChange={(event) => setCreateData((prev) => ({ ...prev, due_at: event.target.value }))} InputLabelProps={{ shrink: true }} fullWidth size="small" />
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="create-priority-label">Приоритет</InputLabel>
                    <Select labelId="create-priority-label" label="Приоритет" value={createData.priority} onChange={(event) => setCreateData((prev) => ({ ...prev, priority: event.target.value }))}>
                      {priorityOptions.map((item) => <MenuItem key={item.value} value={item.value}>{item.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
              </Grid>
            </Stack>
          </DialogContent>

          <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
            <Button onClick={() => setCreateOpen(false)} disabled={createSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button
              variant="contained"
              onClick={handleCreateTask}
              disabled={createSaving || String(createData.title || '').trim().length < 3 || createData.assignee_user_ids.length === 0 || Number(createData.controller_user_id || 0) <= 0}
              sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
            >
              {createSaving ? 'Создание...' : `Создать${(Array.isArray(createData.assignee_user_ids) ? createData.assignee_user_ids.length : 0) > 1 ? ` (${createData.assignee_user_ids.length})` : ''}`}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          fullWidth
          maxWidth="md"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }) }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Редактирование задачи</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
              Автор и администратор могут менять состав участников, срок, приоритет и описание.
            </Typography>
          </Box>

          <DialogContent sx={{ px: 2.2, py: 1.6 }}>
            <Stack spacing={1.5}>
              <TextField label="Заголовок" value={editData.title} onChange={(event) => setEditData((prev) => ({ ...prev, title: event.target.value }))} fullWidth required />

              <MarkdownEditor
                label="Описание"
                value={editData.description}
                onChange={(value) => setEditData((prev) => ({ ...prev, description: value }))}
                minRows={6}
                enableAiTransform
                transformContext="task"
                onAiTransform={transformTaskMarkdown}
                visualVariant="taskDialog"
              />

              <Grid container spacing={1.2}>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-assignee-label">Исполнитель</InputLabel>
                    <Select labelId="edit-assignee-label" label="Исполнитель" value={editData.assignee_user_id} onChange={(event) => setEditData((prev) => ({ ...prev, assignee_user_id: String(event.target.value || '') }))}>
                      {assignees.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.full_name || item.username}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={12} md={6}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="edit-controller-label">Контролёр</InputLabel>
                    <Select labelId="edit-controller-label" label="Контролёр" value={editData.controller_user_id} onChange={(event) => setEditData((prev) => ({ ...prev, controller_user_id: String(event.target.value || '') }))}>
                      {controllers.map((item) => <MenuItem key={item.id} value={String(item.id)}>{item.full_name || item.username}</MenuItem>)}
                    </Select>
                  </FormControl>
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

          <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
            <Button onClick={() => setEditOpen(false)} disabled={editSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button variant="contained" onClick={handleSaveEdit} disabled={editSaving || String(editData.title || '').trim().length < 3} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
              {editSaving ? 'Сохранение...' : 'Сохранить изменения'}
            </Button>
          </DialogActions>
        </Dialog>

        <Dialog
          open={Boolean(reviewTask)}
          onClose={() => setReviewTask(null)}
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }) }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Проверка задачи</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
              Принять результат или вернуть задачу в работу с комментарием.
            </Typography>
          </Box>
          <DialogContent sx={{ px: 2.2, py: 1.6 }}>
            <Stack spacing={1.2}>
              <Typography sx={{ fontWeight: 700 }}>{reviewTask?.title || '-'}</Typography>
              <TextField label="Комментарий проверки" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} multiline minRows={3} fullWidth />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
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
          fullWidth
          maxWidth="sm"
          PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
        >
          <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }) }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Сдать работу</Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
              Отправьте комментарий и, при необходимости, приложите итоговый файл.
            </Typography>
          </Box>
          <DialogContent sx={{ px: 2.2, py: 1.6 }}>
            <Stack spacing={1.2}>
              <Typography sx={{ fontWeight: 700 }}>{submitTask?.title || '-'}</Typography>
              <TextField label="Комментарий к сдаче" value={submitComment} onChange={(event) => setSubmitComment(event.target.value)} multiline minRows={3} fullWidth />
              <Button component="label" size="small" variant="outlined" startIcon={<AttachFileIcon />} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                {submitFile ? submitFile.name : 'Прикрепить файл'}
                <input type="file" hidden onChange={(event) => setSubmitFile(event.target.files?.[0] || null)} />
              </Button>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
            <Button onClick={() => { setSubmitTask(null); setSubmitFile(null); }} disabled={submitSaving} sx={{ textTransform: 'none', fontWeight: 700 }}>
              Отмена
            </Button>
            <Button variant="contained" onClick={handleSubmitTask} disabled={submitSaving} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
              {submitSaving ? 'Отправка...' : 'Сдать'}
            </Button>
          </DialogActions>
        </Dialog>
      </PageShell>
    </MainLayout>
  );
}

export default Tasks;
