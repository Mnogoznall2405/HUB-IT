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
  DialogTitle,
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
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CampaignIcon from '@mui/icons-material/Campaign';
import AssignmentIcon from '@mui/icons-material/Assignment';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import NotificationsIcon from '@mui/icons-material/Notifications';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import FlagIcon from '@mui/icons-material/Flag';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import RefreshIcon from '@mui/icons-material/Refresh';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import { hubAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useNotification } from '../contexts/NotificationContext';
import { useLocation, useNavigate } from 'react-router-dom';
import MarkdownRenderer from '../components/hub/MarkdownRenderer';
import MarkdownEditor from '../components/hub/MarkdownEditor';
import { buildOfficeUiTokens, getOfficeDialogPaperSx, getOfficeEmptyStateSx, getOfficeHeaderBandSx, getOfficeMetricBlockSx, getOfficePanelSx, getOfficeSubtlePanelSx } from '../theme/officeUiTokens';

const DASHBOARD_ANNOUNCEMENTS_LIMIT = 120;
const DASHBOARD_TASKS_LIMIT = 80;

const announcementPriorityMeta = (priority) => {
  const value = String(priority || '').toLowerCase();
  if (value === 'high') return { label: 'Высокий', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
  if (value === 'low') return { label: 'Низкий', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
  return { label: 'Обычный', color: '#d97706', bg: 'rgba(217,119,6,0.14)' };
};

const taskStatusMeta = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'new') return { label: 'Новое', color: '#2563eb', bg: 'rgba(37,99,235,0.14)' };
  if (value === 'in_progress') return { label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.16)' };
  if (value === 'review') return { label: 'На проверке', color: '#7c3aed', bg: 'rgba(124,58,237,0.14)' };
  if (value === 'done') return { label: 'Готово', color: '#059669', bg: 'rgba(5,150,105,0.14)' };
  return { label: value || '-', color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
};

const fmtDateTime = (value) => {
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

const fmtShortDate = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
};

const fmtFileSize = (bytes) => {
  const size = Number(bytes || 0);
  if (size <= 0) return '-';
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
  return `${(size / (1024 * 1024)).toFixed(1)} МБ`;
};

const initials = (name) => {
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

const toDateTimeInput = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - (parsed.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
};

const fromDateTimeInput = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const emptyAnnouncementForm = {
  title: '',
  preview: '',
  body: '',
  priority: 'normal',
  audience_scope: 'all',
  audience_roles: [],
  audience_user_ids: [],
  requires_ack: false,
  is_pinned: false,
  pinned_until: '',
  published_from: '',
  expires_at: '',
  is_active: true,
};

const normalizeAnnouncementForm = (item) => ({
  title: item?.title || '',
  preview: item?.preview || '',
  body: item?.body || '',
  priority: item?.priority || 'normal',
  audience_scope: item?.audience_scope || 'all',
  audience_roles: Array.isArray(item?.audience_roles) ? item.audience_roles : [],
  audience_user_ids: Array.isArray(item?.audience_user_ids) ? item.audience_user_ids.map((value) => Number(value)) : [],
  requires_ack: Boolean(item?.requires_ack),
  is_pinned: Boolean(item?.is_pinned),
  pinned_until: toDateTimeInput(item?.pinned_until),
  published_from: toDateTimeInput(item?.published_from),
  expires_at: toDateTimeInput(item?.expires_at),
  is_active: item?.is_active !== false,
});

const readDashboardFilters = (search = '') => {
  const params = new URLSearchParams(search || '');
  return {
    q: String(params.get('notes_q') || ''),
    priority: String(params.get('notes_priority') || ''),
    unreadOnly: params.get('notes_unread') === '1',
    ackOnly: params.get('notes_ack') === '1',
    pinnedOnly: params.get('notes_pinned') === '1',
    hasAttachments: params.get('notes_files') === '1',
    myTargetedOnly: params.get('notes_targeted') === '1',
  };
};

function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const { user, hasPermission } = useAuth();
  const { notifyApiError, notifySuccess } = useNotification();
  const canWriteAnn = hasPermission('announcements.write');
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';
  const initialFilters = readDashboardFilters(location.search);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dashboardPayload, setDashboardPayload] = useState({
    announcements: { items: [], total: 0, unread_total: 0, ack_pending_total: 0 },
    my_tasks: { items: [], total: 0 },
    unread_counts: {},
    summary: {},
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [q, setQ] = useState(initialFilters.q);
  const [priority, setPriority] = useState(initialFilters.priority);
  const [unreadOnly, setUnreadOnly] = useState(initialFilters.unreadOnly);
  const [ackOnly, setAckOnly] = useState(initialFilters.ackOnly);
  const [pinnedOnly, setPinnedOnly] = useState(initialFilters.pinnedOnly);
  const [hasAttachments, setHasAttachments] = useState(initialFilters.hasAttachments);
  const [myTargetedOnly, setMyTargetedOnly] = useState(initialFilters.myTargetedOnly);
  const [recipientsCatalog, setRecipientsCatalog] = useState({ users: [], roles: [] });
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [announcementLoading, setAnnouncementLoading] = useState(false);
  const [announcementDetails, setAnnouncementDetails] = useState(null);
  const [readsOpen, setReadsOpen] = useState(false);
  const [readsLoading, setReadsLoading] = useState(false);
  const [readsPayload, setReadsPayload] = useState({ items: [], summary: {} });
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaving, setCreateSaving] = useState(false);
  const [createPayload, setCreatePayload] = useState({ ...emptyAnnouncementForm });
  const [createFiles, setCreateFiles] = useState([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editPayload, setEditPayload] = useState({ ...emptyAnnouncementForm });
  const [editId, setEditId] = useState('');
  const [taskOpen, setTaskOpen] = useState(false);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskDetails, setTaskDetails] = useState(null);
  const [taskComments, setTaskComments] = useState([]);
  const [taskStatusLog, setTaskStatusLog] = useState([]);
  const [taskCommentBody, setTaskCommentBody] = useState('');
  const [taskCommentSaving, setTaskCommentSaving] = useState(false);
  const searchInputRef = useRef(null);
  const taskCommentsRef = useRef(null);

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

  const selectedAnnouncementId = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('announcement') || '').trim();
  }, [location.search]);

  const selectedTaskId = useMemo(() => {
    const params = new URLSearchParams(location.search || '');
    return String(params.get('task') || '').trim();
  }, [location.search]);

  const loadRecipients = useCallback(async () => {
    if (!canWriteAnn) return;
    try {
      const payload = await hubAPI.getAnnouncementRecipients();
      setRecipientsCatalog({
        users: Array.isArray(payload?.users) ? payload.users : [],
        roles: Array.isArray(payload?.roles) ? payload.roles : [],
      });
    } catch {
      setRecipientsCatalog({ users: [], roles: [] });
    }
  }, [canWriteAnn]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await hubAPI.getDashboard({
        announcements_limit: DASHBOARD_ANNOUNCEMENTS_LIMIT,
        tasks_limit: DASHBOARD_TASKS_LIMIT,
      });
      setDashboardPayload(payload || {
        announcements: { items: [], total: 0, unread_total: 0, ack_pending_total: 0 },
        my_tasks: { items: [], total: 0 },
        unread_counts: {},
        summary: {},
      });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки центра управления');
    } finally {
      setLoading(false);
    }
  }, []);

  const transformMd = useCallback(async (text, context) => {
    try {
      return await hubAPI.transformMarkdown({ text, context });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка');
      throw err;
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    void loadRecipients();
  }, [loadRecipients]);

  useEffect(() => {
    const next = readDashboardFilters(location.search);
    setQ((prev) => (prev === next.q ? prev : next.q));
    setPriority((prev) => (prev === next.priority ? prev : next.priority));
    setUnreadOnly((prev) => (prev === next.unreadOnly ? prev : next.unreadOnly));
    setAckOnly((prev) => (prev === next.ackOnly ? prev : next.ackOnly));
    setPinnedOnly((prev) => (prev === next.pinnedOnly ? prev : next.pinnedOnly));
    setHasAttachments((prev) => (prev === next.hasAttachments ? prev : next.hasAttachments));
    setMyTargetedOnly((prev) => (prev === next.myTargetedOnly ? prev : next.myTargetedOnly));
  }, [location.search]);

  useEffect(() => {
    updateSearch((params) => {
      if (q) params.set('notes_q', q);
      else params.delete('notes_q');
      if (priority) params.set('notes_priority', priority);
      else params.delete('notes_priority');
      if (unreadOnly) params.set('notes_unread', '1');
      else params.delete('notes_unread');
      if (ackOnly) params.set('notes_ack', '1');
      else params.delete('notes_ack');
      if (pinnedOnly) params.set('notes_pinned', '1');
      else params.delete('notes_pinned');
      if (hasAttachments) params.set('notes_files', '1');
      else params.delete('notes_files');
      if (myTargetedOnly) params.set('notes_targeted', '1');
      else params.delete('notes_targeted');
    });
  }, [ackOnly, hasAttachments, myTargetedOnly, pinnedOnly, priority, q, unreadOnly, updateSearch]);

  const announcementItems = useMemo(() => (
    Array.isArray(dashboardPayload?.announcements?.items) ? dashboardPayload.announcements.items : []
  ), [dashboardPayload]);

  const taskItems = useMemo(() => (
    Array.isArray(dashboardPayload?.my_tasks?.items) ? dashboardPayload.my_tasks.items : []
  ), [dashboardPayload]);

  const unreadCounts = useMemo(() => (dashboardPayload?.unread_counts || {}), [dashboardPayload]);
  const summary = useMemo(() => (dashboardPayload?.summary || {}), [dashboardPayload]);

  const patchAnnouncementItem = useCallback((announcementId, patch) => {
    const targetId = String(announcementId || '').trim();
    if (!targetId) return;
    setDashboardPayload((prev) => ({
      ...(prev || {}),
      announcements: {
        ...(prev?.announcements || {}),
        items: Array.isArray(prev?.announcements?.items)
          ? prev.announcements.items.map((item) => (
            String(item?.id || '') === targetId ? { ...item, ...(patch || {}) } : item
          ))
          : [],
      },
    }));
  }, []);

  const patchTaskItem = useCallback((taskId, patch) => {
    const targetId = String(taskId || '').trim();
    if (!targetId) return;
    setDashboardPayload((prev) => ({
      ...(prev || {}),
      my_tasks: {
        ...(prev?.my_tasks || {}),
        items: Array.isArray(prev?.my_tasks?.items)
          ? prev.my_tasks.items.map((item) => (
            String(item?.id || '') === targetId ? { ...item, ...(patch || {}) } : item
          ))
          : [],
      },
    }));
  }, []);

  const filteredAnnouncements = useMemo(() => {
    const query = String(q || '').trim().toLowerCase();
    return announcementItems.filter((item) => {
      const haystack = [
        item?.title,
        item?.preview,
        item?.recipients_summary,
        item?.author_full_name,
      ].join(' ').toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (priority && String(item?.priority || '').toLowerCase() !== priority) return false;
      if (unreadOnly && !item?.is_unread) return false;
      if (ackOnly && !item?.is_ack_pending) return false;
      if (pinnedOnly && !item?.is_pinned_active) return false;
      if (hasAttachments && Number(item?.attachments_count || 0) <= 0) return false;
      if (myTargetedOnly && !(item?.audience_scope !== 'all' && (item?.is_targeted_to_viewer || Number(item?.author_user_id) === Number(user?.id)))) return false;
      return true;
    });
  }, [ackOnly, announcementItems, hasAttachments, myTargetedOnly, pinnedOnly, priority, q, unreadOnly, user?.id]);

  const announcementSections = useMemo(() => ([
    { key: 'ack', title: 'Требуют подтверждения', empty: 'Нет заметок, которые нужно подтвердить.', items: filteredAnnouncements.filter((item) => item?.is_ack_pending) },
    { key: 'new', title: 'Новые и обновленные', empty: 'Нет новых или обновлённых заметок.', items: filteredAnnouncements.filter((item) => item?.is_unread) },
    { key: 'pinned', title: 'Закреплённые', empty: 'Нет закреплённых заметок.', items: filteredAnnouncements.filter((item) => item?.is_pinned_active) },
    { key: 'all', title: 'Все заметки', empty: 'По текущим фильтрам заметки не найдены.', items: filteredAnnouncements },
  ]), [filteredAnnouncements]);

  const reviewQueue = useMemo(() => taskItems.filter((task) => {
    if (String(task?.status || '').toLowerCase() !== 'review') return false;
    return isAdmin
      || Number(task?.created_by_user_id) === Number(user?.id)
      || Number(task?.controller_user_id) === Number(user?.id);
  }), [isAdmin, taskItems, user?.id]);

  const reviewIds = useMemo(() => new Set(reviewQueue.map((item) => String(item?.id || ''))), [reviewQueue]);
  const overdueQueue = useMemo(() => taskItems.filter((task) => task?.is_overdue && !reviewIds.has(String(task?.id || ''))), [reviewIds, taskItems]);
  const overdueIds = useMemo(() => new Set(overdueQueue.map((item) => String(item?.id || ''))), [overdueQueue]);
  const commentQueue = useMemo(() => taskItems.filter((task) => task?.has_unread_comments && !reviewIds.has(String(task?.id || '')) && !overdueIds.has(String(task?.id || ''))), [overdueIds, reviewIds, taskItems]);
  const commentIds = useMemo(() => new Set(commentQueue.map((item) => String(item?.id || ''))), [commentQueue]);
  const otherQueue = useMemo(() => taskItems.filter((task) => !reviewIds.has(String(task?.id || '')) && !overdueIds.has(String(task?.id || '')) && !commentIds.has(String(task?.id || ''))), [commentIds, overdueIds, reviewIds, taskItems]);

  const actionStrip = useMemo(() => ([
    { key: 'ack', label: 'Нужно подтвердить', value: Number(summary?.announcements_ack_pending || unreadCounts?.announcements_ack_pending || 0), color: '#2563eb', bg: 'rgba(37,99,235,0.12)', icon: <CheckCircleOutlineIcon sx={{ fontSize: 18 }} /> },
    { key: 'notes', label: 'Новые и обновленные', value: Number(summary?.announcements_attention || unreadCounts?.announcements_unread || 0), color: '#7c3aed', bg: 'rgba(124,58,237,0.12)', icon: <CampaignIcon sx={{ fontSize: 18 }} /> },
    { key: 'review', label: 'К проверке', value: Number(summary?.tasks_review_required || unreadCounts?.tasks_review_required || 0), color: '#d97706', bg: 'rgba(217,119,6,0.14)', icon: <TaskAltIcon sx={{ fontSize: 18 }} /> },
    { key: 'overdue', label: 'Просрочено', value: Number(summary?.tasks_overdue || unreadCounts?.tasks_overdue || 0), color: '#dc2626', bg: 'rgba(220,38,38,0.12)', icon: <WarningAmberIcon sx={{ fontSize: 18 }} /> },
    { key: 'comments', label: 'Новые комментарии', value: Number(summary?.tasks_with_unread_comments || unreadCounts?.tasks_with_unread_comments || 0), color: '#059669', bg: 'rgba(5,150,105,0.12)', icon: <ModeCommentOutlinedIcon sx={{ fontSize: 18 }} /> },
  ]), [summary, unreadCounts]);

  const resetFilters = useCallback(() => {
    setQ('');
    setPriority('');
    setUnreadOnly(false);
    setAckOnly(false);
    setPinnedOnly(false);
    setHasAttachments(false);
    setMyTargetedOnly(false);
  }, []);

  const downloadBlob = useCallback((response, fileName) => {
    const blob = new Blob([response.data], { type: response?.headers?.['content-type'] || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'file';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, []);

  const downloadAnnouncementAttachment = useCallback(async (announcementId, attachment) => {
    try {
      const response = await hubAPI.downloadAnnouncementAttachment(announcementId, attachment.id);
      downloadBlob(response, attachment?.file_name || 'attachment');
      notifySuccess(`Вложение ${attachment?.file_name || 'file'} скачано.`, { source: 'hub' });
    } catch (err) {
      notifyApiError(err, 'Не удалось скачать вложение заметки.', { source: 'hub' });
    }
  }, [downloadBlob, notifyApiError, notifySuccess]);

  const downloadTaskAttachment = useCallback(async (taskId, attachment) => {
    try {
      const response = await hubAPI.downloadTaskAttachment({ taskId, attachmentId: attachment.id });
      downloadBlob(response, attachment?.file_name || 'attachment');
      notifySuccess(`Вложение ${attachment?.file_name || 'file'} скачано.`, { source: 'tasks' });
    } catch (err) {
      notifyApiError(err, 'Не удалось скачать вложение задачи.', { source: 'tasks' });
    }
  }, [downloadBlob, notifyApiError, notifySuccess]);

  const downloadTaskReport = useCallback(async (report) => {
    if (!report?.id || !report?.file_name) return;
    try {
      const response = await hubAPI.downloadTaskReport(report.id);
      downloadBlob(response, report.file_name);
      notifySuccess(`Отчёт ${report.file_name} скачан.`, { source: 'tasks' });
    } catch (err) {
      notifyApiError(err, 'Не удалось скачать отчёт по задаче.', { source: 'tasks' });
    }
  }, [downloadBlob, notifyApiError, notifySuccess]);

  const closeAnnouncementDetails = useCallback(() => {
    setAnnouncementOpen(false);
    setAnnouncementDetails(null);
    setReadsOpen(false);
    updateSearch((params) => {
      params.delete('announcement');
    });
  }, [updateSearch]);

  const openAnnouncementDetails = useCallback((item) => {
    const id = String(item?.id || '').trim();
    if (!id) return;
    setAnnouncementLoading(true);
    setAnnouncementDetails(null);
    updateSearch((params) => {
      params.set('announcement', id);
      params.delete('task');
    }, { replace: false });
  }, [updateSearch]);

  const loadAnnouncementDetails = useCallback(async (announcementId) => {
    const normalizedId = String(announcementId || '').trim();
    if (!normalizedId) return;
    setAnnouncementLoading(true);
    try {
      let item = await hubAPI.getAnnouncement(normalizedId);
      if (item?.is_unread) {
        try {
          await hubAPI.markAnnouncementRead(normalizedId);
          item = {
            ...item,
            is_unread: false,
            is_updated: false,
            unread: 0,
            seen_version: item.version,
          };
          patchAnnouncementItem(normalizedId, {
            is_unread: false,
            is_updated: false,
            unread: 0,
            seen_version: item.version,
          });
          window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
          void loadDashboard();
        } catch { }
      }
      setAnnouncementDetails(item || null);
    } catch (err) {
      setAnnouncementDetails(null);
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки заметки');
    } finally {
      setAnnouncementLoading(false);
    }
  }, [loadDashboard, patchAnnouncementItem]);

  useEffect(() => {
    if (!selectedAnnouncementId) {
      setAnnouncementOpen(false);
      setAnnouncementDetails(null);
      return;
    }
    setAnnouncementOpen(true);
    void loadAnnouncementDetails(selectedAnnouncementId);
  }, [loadAnnouncementDetails, selectedAnnouncementId]);

  const loadAnnouncementReads = useCallback(async (announcementId) => {
    const normalizedId = String(announcementId || '').trim();
    if (!normalizedId) return;
    setReadsOpen(true);
    setReadsLoading(true);
    try {
      const payload = await hubAPI.getAnnouncementReads(normalizedId);
      setReadsPayload({
        items: Array.isArray(payload?.items) ? payload.items : [],
        summary: payload?.summary || {},
      });
    } catch (err) {
      notifyApiError(err, 'Не удалось загрузить статусы ознакомления.', { source: 'hub' });
      setReadsPayload({ items: [], summary: {} });
    } finally {
      setReadsLoading(false);
    }
  }, [notifyApiError]);

  const handleAckAnnouncement = useCallback(async () => {
    const announcementId = String(announcementDetails?.id || '').trim();
    if (!announcementId) return;
    try {
      const payload = await hubAPI.acknowledgeAnnouncement(announcementId);
      setAnnouncementDetails(payload || null);
      patchAnnouncementItem(announcementId, {
        is_ack_pending: false,
        acknowledged_at: payload?.acknowledged_at || null,
        acknowledged_version: payload?.acknowledged_version || payload?.version || 0,
        is_unread: false,
        is_updated: false,
      });
      void loadDashboard();
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
      notifySuccess('Ознакомление подтверждено.', { source: 'hub' });
    } catch (err) {
      notifyApiError(err, 'Не удалось подтвердить ознакомление.', { source: 'hub' });
    }
  }, [announcementDetails, loadDashboard, notifyApiError, notifySuccess, patchAnnouncementItem]);

  const openCreateAnnouncement = useCallback(() => {
    setCreatePayload({ ...emptyAnnouncementForm });
    setCreateFiles([]);
    setCreateOpen(true);
  }, []);

  const openEditAnnouncement = useCallback(async (item) => {
    if (!item?.id) return;
    try {
      const source = typeof item?.body === 'string' ? item : await hubAPI.getAnnouncement(item.id);
      setEditId(String(source.id));
      setEditPayload(normalizeAnnouncementForm(source));
      setEditOpen(true);
    } catch (err) {
      notifyApiError(err, 'Не удалось загрузить заметку для редактирования.', { source: 'hub' });
    }
  }, [notifyApiError]);

  const buildAnnouncementSubmitPayload = useCallback((draft) => ({
    title: String(draft?.title || '').trim(),
    preview: String(draft?.preview || '').trim(),
    body: String(draft?.body || '').trim(),
    priority: draft?.priority || 'normal',
    audience_scope: draft?.audience_scope || 'all',
    audience_roles: Array.isArray(draft?.audience_roles) ? draft.audience_roles : [],
    audience_user_ids: Array.isArray(draft?.audience_user_ids) ? draft.audience_user_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0) : [],
    requires_ack: Boolean(draft?.requires_ack),
    is_pinned: Boolean(draft?.is_pinned),
    pinned_until: fromDateTimeInput(draft?.pinned_until),
    published_from: fromDateTimeInput(draft?.published_from),
    expires_at: fromDateTimeInput(draft?.expires_at),
    is_active: draft?.is_active !== false,
  }), []);

  const handleCreateAnnouncement = useCallback(async () => {
    const title = String(createPayload?.title || '').trim();
    if (title.length < 3) return;
    setCreateSaving(true);
    try {
      const created = await hubAPI.createAnnouncement(buildAnnouncementSubmitPayload(createPayload), createFiles);
      setCreateOpen(false);
      setCreatePayload({ ...emptyAnnouncementForm });
      setCreateFiles([]);
      await loadDashboard();
      notifySuccess(`Заметка "${title}" создана.`, { source: 'hub' });
      if (created?.id) {
        updateSearch((params) => {
          params.set('announcement', created.id);
          params.delete('task');
        }, { replace: false });
      }
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      notifyApiError(err, 'Не удалось создать заметку.', { source: 'hub' });
    } finally {
      setCreateSaving(false);
    }
  }, [buildAnnouncementSubmitPayload, createFiles, createPayload, loadDashboard, notifyApiError, notifySuccess, updateSearch]);

  const handleSaveAnnouncement = useCallback(async () => {
    const title = String(editPayload?.title || '').trim();
    if (!editId || title.length < 3) return;
    setEditSaving(true);
    try {
      const updated = await hubAPI.updateAnnouncement(editId, buildAnnouncementSubmitPayload(editPayload));
      setEditOpen(false);
      await loadDashboard();
      if (String(announcementDetails?.id || '') === String(editId)) {
        setAnnouncementDetails(updated || null);
      }
      notifySuccess(`Заметка "${title}" обновлена.`, { source: 'hub' });
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      notifyApiError(err, 'Не удалось обновить заметку.', { source: 'hub' });
    } finally {
      setEditSaving(false);
    }
  }, [announcementDetails?.id, buildAnnouncementSubmitPayload, editId, editPayload, loadDashboard, notifyApiError, notifySuccess]);

  const handleArchiveAnnouncement = useCallback(async (item) => {
    const announcementId = String(item?.id || '').trim();
    if (!announcementId) return;
    try {
      await hubAPI.updateAnnouncement(announcementId, { is_active: false });
      if (String(selectedAnnouncementId || '') === announcementId) {
        closeAnnouncementDetails();
      }
      await loadDashboard();
      notifySuccess('Заметка снята с публикации.', { source: 'hub' });
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      notifyApiError(err, 'Не удалось архивировать заметку.', { source: 'hub' });
    }
  }, [closeAnnouncementDetails, loadDashboard, notifyApiError, notifySuccess, selectedAnnouncementId]);

  const handleDeleteAnnouncement = useCallback(async (item) => {
    if (!item?.id || !window.confirm(`Удалить "${item?.title || 'заметку'}"?`)) return;
    try {
      await hubAPI.deleteAnnouncement(item.id);
      if (String(selectedAnnouncementId || '') === String(item.id)) {
        closeAnnouncementDetails();
      }
      await loadDashboard();
      notifySuccess(`Заметка "${item?.title || 'без названия'}" удалена.`, { source: 'hub' });
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (err) {
      notifyApiError(err, 'Не удалось удалить заметку.', { source: 'hub' });
    }
  }, [closeAnnouncementDetails, loadDashboard, notifyApiError, notifySuccess, selectedAnnouncementId]);

  const closeTaskDetails = useCallback(() => {
    setTaskOpen(false);
    setTaskDetails(null);
    setTaskComments([]);
    setTaskStatusLog([]);
    setTaskCommentBody('');
    updateSearch((params) => {
      params.delete('task');
    });
  }, [updateSearch]);

  const openTaskDetails = useCallback((task) => {
    const id = String(task?.id || '').trim();
    if (!id) return;
    setTaskLoading(true);
    setTaskDetails(null);
    setTaskComments([]);
    setTaskStatusLog([]);
    updateSearch((params) => {
      params.set('task', id);
      params.delete('announcement');
    }, { replace: false });
  }, [updateSearch]);

  const loadTaskDetails = useCallback(async (taskId) => {
    const normalizedId = String(taskId || '').trim();
    if (!normalizedId) return;
    setTaskLoading(true);
    try {
      const task = await hubAPI.getTask(normalizedId);
      const [commentsResult, statusResult] = await Promise.allSettled([
        hubAPI.getTaskComments(normalizedId),
        hubAPI.getTaskStatusLog(normalizedId),
      ]);
      let nextTask = task || null;
      setTaskComments(
        commentsResult.status === 'fulfilled' && Array.isArray(commentsResult.value?.items)
          ? commentsResult.value.items
          : []
      );
      setTaskStatusLog(
        statusResult.status === 'fulfilled' && Array.isArray(statusResult.value?.items)
          ? statusResult.value.items
          : []
      );
      if (task?.has_unread_comments) {
        try {
          await hubAPI.markTaskCommentsSeen(normalizedId);
          nextTask = { ...task, has_unread_comments: false };
          patchTaskItem(normalizedId, { has_unread_comments: false });
          window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
          void loadDashboard();
        } catch { }
      }
      setTaskDetails(nextTask);
    } catch (err) {
      setTaskDetails(null);
      setTaskComments([]);
      setTaskStatusLog([]);
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки задачи');
    } finally {
      setTaskLoading(false);
    }
  }, [loadDashboard, patchTaskItem]);

  useEffect(() => {
    if (!selectedTaskId) {
      setTaskOpen(false);
      setTaskDetails(null);
      setTaskComments([]);
      setTaskStatusLog([]);
      return;
    }
    setTaskOpen(true);
    void loadTaskDetails(selectedTaskId);
  }, [loadTaskDetails, selectedTaskId]);

  useEffect(() => {
    if (!taskCommentsRef.current) return;
    taskCommentsRef.current.scrollTop = taskCommentsRef.current.scrollHeight;
  }, [taskComments]);

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
        if (readsOpen) {
          setReadsOpen(false);
          return;
        }
        if (announcementOpen) {
          closeAnnouncementDetails();
          return;
        }
        if (taskOpen) {
          closeTaskDetails();
        }
        return;
      }

      if (isTyping) return;

      if (canWriteAnn && String(event.key || '').toLowerCase() === 'n') {
        event.preventDefault();
        openCreateAnnouncement();
        return;
      }

      if (event.key === '/' || String(event.key || '').toLowerCase() === 'f') {
        event.preventDefault();
        setFiltersOpen(true);
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus?.();
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    announcementOpen,
    canWriteAnn,
    closeAnnouncementDetails,
    closeTaskDetails,
    createOpen,
    editOpen,
    openCreateAnnouncement,
    readsOpen,
    taskOpen,
  ]);

  const handleAddTaskComment = useCallback(async () => {
    const taskId = String(taskDetails?.id || '').trim();
    const body = String(taskCommentBody || '').trim();
    if (!taskId || !body) return;
    setTaskCommentSaving(true);
    try {
      await hubAPI.addTaskComment(taskId, body);
      setTaskCommentBody('');
      await loadTaskDetails(taskId);
      await loadDashboard();
      notifySuccess('Комментарий добавлен.', { source: 'tasks' });
    } catch (err) {
      notifyApiError(err, 'Не удалось добавить комментарий.', { source: 'tasks' });
    } finally {
      setTaskCommentSaving(false);
    }
  }, [loadDashboard, loadTaskDetails, notifyApiError, notifySuccess, taskCommentBody, taskDetails?.id]);

  const renderAnnouncementCard = useCallback((item) => {
    const priorityMeta = announcementPriorityMeta(item?.priority);
    const canManage = Boolean(item?.can_manage) && canWriteAnn;
    return (
      <Card
        key={item.id}
        onClick={() => openAnnouncementDetails(item)}
        sx={{
          p: 1.4,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          boxShadow: ui.shellShadow,
          bgcolor: ui.panelSolid,
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
        <Stack direction="row" justifyContent="space-between" spacing={1}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem', lineHeight: 1.3, minWidth: 0, flex: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {item?.title || '-'}
          </Typography>
          {canManage && (
            <Stack direction="row" spacing={0.3}>
              <Tooltip title="Редактировать">
                <IconButton size="small" onClick={(event) => { event.stopPropagation(); openEditAnnouncement(item); }}>
                  <EditOutlinedIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Снять с публикации">
                <IconButton size="small" onClick={(event) => { event.stopPropagation(); void handleArchiveAnnouncement(item); }}>
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Stack>
        <Stack direction="row" spacing={0.45} sx={{ mt: 0.8, flexWrap: 'wrap', gap: 0.4 }}>
          <Chip size="small" label={priorityMeta.label} sx={{ height: 20, fontSize: '0.64rem', fontWeight: 700, bgcolor: priorityMeta.bg, color: priorityMeta.color, border: 'none' }} />
          {item?.is_updated && <Chip size="small" label="Обновлено" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(124,58,237,0.14)', color: '#7c3aed', border: 'none' }} />}
          {!item?.is_updated && item?.is_unread && <Chip size="small" label="Новое" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(37,99,235,0.14)', color: '#2563eb', border: 'none' }} />}
          {item?.requires_ack && <Chip size="small" label="Требует подтверждения" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(5,150,105,0.14)', color: '#059669', border: 'none' }} />}
          {item?.is_pinned_active && <Chip size="small" icon={<PushPinOutlinedIcon sx={{ fontSize: '12px !important' }} />} label="Закреплено" sx={{ height: 20, fontSize: '0.62rem', fontWeight: 800, bgcolor: ui.actionBg, color: ui.mutedText, border: 'none', '& .MuiChip-icon': { ml: '2px' } }} />}
          {Number(item?.attachments_count || 0) > 0 && <Chip size="small" icon={<AttachFileIcon sx={{ fontSize: '11px !important' }} />} label={item.attachments_count} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: ui.actionBg, color: ui.mutedText, border: 'none', '& .MuiChip-icon': { ml: '2px' } }} />}
          {item?.expires_at && <Chip size="small" icon={<AccessTimeIcon sx={{ fontSize: '11px !important' }} />} label={`До ${fmtShortDate(item.expires_at)}`} sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, bgcolor: 'rgba(217,119,6,0.12)', color: '#d97706', border: 'none', '& .MuiChip-icon': { ml: '2px' } }} />}
        </Stack>
        <Typography sx={{ mt: 0.75, color: ui.mutedText, fontSize: '0.78rem', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: 54 }}>
          {item?.preview || '-'}
        </Typography>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
          <Stack direction="row" spacing={0.8} alignItems="center" sx={{ minWidth: 0 }}>
            <Avatar sx={{ width: 24, height: 24, fontSize: '0.64rem', bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
              {initials(item?.author_full_name || item?.author_username)}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="caption" sx={{ display: 'block', color: ui.subtleText, lineHeight: 1 }}>
                {item?.recipients_summary || 'Без аудитории'}
              </Typography>
              <Typography variant="caption" sx={{ color: ui.mutedText, fontWeight: 700, display: 'block', maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item?.author_full_name || item?.author_username || '-'}
              </Typography>
            </Box>
          </Stack>
          <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 600 }}>
            {fmtShortDate(item?.updated_at || item?.published_at)}
          </Typography>
        </Stack>
      </Card>
    );
  }, [canWriteAnn, handleArchiveAnnouncement, openAnnouncementDetails, openEditAnnouncement, ui.actionBg, ui.actionHover, ui.borderSoft, ui.dialogShadow, ui.mutedText, ui.panelSolid, ui.selectedBorder, ui.shellShadow, ui.subtleText]);

  const renderTaskCard = useCallback((task) => {
    const status = taskStatusMeta(task?.status);
    const latestComment = getTaskCommentPreview(task);
    return (
      <Card
        key={task.id}
        onClick={() => openTaskDetails(task)}
        sx={{
          p: 1.2,
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
        <Typography sx={{ fontWeight: 800, fontSize: '0.84rem', lineHeight: 1.3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {task?.title || '-'}
        </Typography>
        <Stack direction="row" spacing={0.45} sx={{ mt: 0.65, flexWrap: 'wrap', gap: 0.35 }}>
          <Chip size="small" label={status.label} sx={{ height: 19, fontSize: '0.62rem', fontWeight: 700, bgcolor: status.bg, color: status.color, border: 'none' }} />
          {task?.is_overdue && <Chip size="small" label="Просрочено" sx={{ height: 19, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626', border: 'none' }} />}
          {task?.has_unread_comments && <Chip size="small" label="Новый комментарий" sx={{ height: 19, fontSize: '0.62rem', fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb', border: 'none' }} />}
          {Number(task?.attachments_count || 0) > 0 && <Chip size="small" icon={<AttachFileIcon sx={{ fontSize: '11px !important' }} />} label={task.attachments_count} sx={{ height: 19, fontSize: '0.62rem', fontWeight: 700, bgcolor: ui.actionBg, color: ui.mutedText, border: 'none', '& .MuiChip-icon': { ml: '2px' } }} />}
        </Stack>
        {latestComment && (
          <Typography sx={{ mt: 0.65, fontSize: '0.72rem', lineHeight: 1.35, color: task?.has_unread_comments ? 'text.primary' : ui.mutedText, fontWeight: task?.has_unread_comments ? 700 : 500, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {latestComment}
          </Typography>
        )}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.85 }}>
          <Typography variant="caption" sx={{ color: ui.subtleText }}>
            {task?.assignee_full_name || task?.assignee_username || '-'}
          </Typography>
          <Typography variant="caption" sx={{ color: task?.is_overdue ? '#dc2626' : ui.subtleText, fontWeight: 700 }}>
            {task?.due_at ? fmtShortDate(task.due_at) : 'Без срока'}
          </Typography>
        </Stack>
      </Card>
    );
  }, [openTaskDetails, ui.actionBg, ui.actionHover, ui.borderSoft, ui.dialogShadow, ui.mutedText, ui.panelSolid, ui.selectedBorder, ui.shellShadow, ui.subtleText]);

  const taskQueues = useMemo(() => ([
    { key: 'review', title: 'К проверке', empty: 'Нет задач, ожидающих проверки.', items: reviewQueue },
    { key: 'overdue', title: 'Просроченные', empty: 'Просроченных задач нет.', items: overdueQueue },
    { key: 'comments', title: 'С новыми комментариями', empty: 'Новых комментариев нет.', items: commentQueue },
    { key: 'other', title: 'Остальные', empty: 'Открытых задач нет.', items: otherQueue },
  ]), [commentQueue, otherQueue, overdueQueue, reviewQueue]);

  const activeFilterCount = useMemo(() => [
    q,
    priority,
    unreadOnly,
    ackOnly,
    pinnedOnly,
    hasAttachments,
    myTargetedOnly,
  ].filter(Boolean).length, [ackOnly, hasAttachments, myTargetedOnly, pinnedOnly, priority, q, unreadOnly]);

  const renderAnnouncementEditorFields = (draft, setDraft, { filesEnabled = false, files = [], onFilesChange = null } = {}) => {
    const selectedUsersLabel = (Array.isArray(draft?.audience_user_ids) ? draft.audience_user_ids : [])
      .map((value) => recipientsCatalog.users.find((item) => Number(item.id) === Number(value)))
      .filter(Boolean)
      .map((item) => item.full_name || item.username)
      .join(', ');
    const selectedRolesLabel = (Array.isArray(draft?.audience_roles) ? draft.audience_roles : [])
      .map((value) => recipientsCatalog.roles.find((item) => item.value === value))
      .filter(Boolean)
      .map((item) => item.label)
      .join(', ');

    return (
      <Stack spacing={1.5}>
        <TextField
          label="Заголовок"
          value={draft.title}
          onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
          fullWidth
          required
        />

        <TextField
          label="Короткое описание"
          value={draft.preview}
          onChange={(event) => setDraft((prev) => ({ ...prev, preview: event.target.value }))}
          fullWidth
          multiline
          minRows={2}
          placeholder="Краткое превью для карточки"
        />

        <MarkdownEditor
          label="Текст заметки"
          value={draft.body}
          onChange={(value) => setDraft((prev) => ({ ...prev, body: value }))}
          minRows={10}
          placeholder="Опишите сообщение, инструкции или изменения..."
          enableAiTransform={canWriteAnn}
          transformContext="announcement"
          onAiTransform={transformMd}
          visualVariant="taskDialog"
        />

        <Grid container spacing={1.2}>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel id="announcement-priority-label">Приоритет</InputLabel>
              <Select
                labelId="announcement-priority-label"
                label="Приоритет"
                value={draft.priority}
                onChange={(event) => setDraft((prev) => ({ ...prev, priority: event.target.value }))}
              >
                <MenuItem value="low">Низкий</MenuItem>
                <MenuItem value="normal">Обычный</MenuItem>
                <MenuItem value="high">Высокий</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <FormControl fullWidth size="small">
              <InputLabel id="announcement-scope-label">Аудитория</InputLabel>
              <Select
                labelId="announcement-scope-label"
                label="Аудитория"
                value={draft.audience_scope}
                onChange={(event) => setDraft((prev) => ({
                  ...prev,
                  audience_scope: event.target.value,
                  audience_roles: event.target.value === 'roles' ? prev.audience_roles : [],
                  audience_user_ids: event.target.value === 'users' ? prev.audience_user_ids : [],
                }))}
              >
                <MenuItem value="all">Все пользователи</MenuItem>
                <MenuItem value="roles">По ролям</MenuItem>
                <MenuItem value="users">Конкретные пользователи</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              size="small"
              label="Дата публикации"
              type="datetime-local"
              value={draft.published_from}
              onChange={(event) => setDraft((prev) => ({ ...prev, published_from: event.target.value }))}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>

          {draft.audience_scope === 'roles' && (
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel id="announcement-roles-label">Роли</InputLabel>
                <Select
                  multiple
                  labelId="announcement-roles-label"
                  label="Роли"
                  value={Array.isArray(draft.audience_roles) ? draft.audience_roles : []}
                  onChange={(event) => {
                    const nextValue = Array.isArray(event.target.value)
                      ? event.target.value
                      : String(event.target.value || '').split(',');
                    setDraft((prev) => ({ ...prev, audience_roles: nextValue.map((value) => String(value)).filter(Boolean) }));
                  }}
                  renderValue={() => selectedRolesLabel || 'Выберите роли'}
                >
                  {recipientsCatalog.roles.map((item) => (
                    <MenuItem key={item.value} value={item.value}>
                      <Checkbox checked={(draft.audience_roles || []).includes(item.value)} />
                      <ListItemText primary={item.label} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {draft.audience_scope === 'users' && (
            <Grid item xs={12}>
              <FormControl fullWidth size="small">
                <InputLabel id="announcement-users-label">Пользователи</InputLabel>
                <Select
                  multiple
                  labelId="announcement-users-label"
                  label="Пользователи"
                  value={Array.isArray(draft.audience_user_ids) ? draft.audience_user_ids : []}
                  onChange={(event) => {
                    const nextValue = Array.isArray(event.target.value)
                      ? event.target.value
                      : String(event.target.value || '').split(',');
                    setDraft((prev) => ({
                      ...prev,
                      audience_user_ids: nextValue
                        .map((value) => Number(value))
                        .filter((value) => Number.isInteger(value) && value > 0),
                    }));
                  }}
                  renderValue={() => selectedUsersLabel || 'Выберите пользователей'}
                >
                  {recipientsCatalog.users.map((item) => (
                    <MenuItem key={item.id} value={item.id}>
                      <Checkbox checked={(draft.audience_user_ids || []).some((value) => Number(value) === Number(item.id))} />
                      <ListItemText primary={item.full_name || item.username} secondary={item.username} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          <Grid item xs={12} md={6}>
            <TextField
              size="small"
              label="Закрепить до"
              type="datetime-local"
              value={draft.pinned_until}
              onChange={(event) => setDraft((prev) => ({ ...prev, pinned_until: event.target.value }))}
              fullWidth
              disabled={!draft.is_pinned}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField
              size="small"
              label="Скрыть после"
              type="datetime-local"
              value={draft.expires_at}
              onChange={(event) => setDraft((prev) => ({ ...prev, expires_at: event.target.value }))}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
        </Grid>

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8}>
          <FormControlLabel
            control={<Checkbox checked={Boolean(draft.requires_ack)} onChange={(event) => setDraft((prev) => ({ ...prev, requires_ack: event.target.checked }))} />}
            label="Требовать подтверждение"
          />
          <FormControlLabel
            control={<Checkbox checked={Boolean(draft.is_pinned)} onChange={(event) => setDraft((prev) => ({ ...prev, is_pinned: event.target.checked }))} />}
            label="Закрепить"
          />
          <FormControlLabel
            control={<Checkbox checked={draft.is_active !== false} onChange={(event) => setDraft((prev) => ({ ...prev, is_active: event.target.checked }))} />}
            label="Активна в ленте"
          />
        </Stack>

        {filesEnabled && (
          <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 1.2, borderRadius: '12px', bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.10 : 0.04) }) }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1}>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>Вложения</Typography>
                <Typography variant="caption" sx={{ color: ui.subtleText }}>
                  Документы и файлы для заметки.
                </Typography>
              </Box>
              <Button component="label" variant="outlined" startIcon={<AttachFileIcon />} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                Добавить файлы
                <input
                  hidden
                  type="file"
                  multiple
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files || []);
                    onFilesChange?.(selectedFiles);
                    event.target.value = '';
                  }}
                />
              </Button>
            </Stack>
            {files.length > 0 && (
              <Stack direction="row" spacing={0.6} sx={{ mt: 1, flexWrap: 'wrap', gap: 0.6 }}>
                {files.map((file) => (
                  <Chip key={`${file.name}-${file.size}`} label={file.name} size="small" />
                ))}
              </Stack>
            )}
          </Box>
        )}
      </Stack>
    );
  };

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

          <Box sx={{ mb: 1, flexShrink: 0 }}>
            <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }) }}>
              <Stack spacing={0.9}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.9}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Avatar sx={{ width: 36, height: 36, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                      <NotificationsIcon />
                    </Avatar>
                    <Box>
                      <Typography sx={{ fontWeight: 900, fontSize: '0.98rem', lineHeight: 1.1 }}>Центр управления</Typography>
                      <Typography variant="caption" sx={{ color: ui.mutedText, display: 'block', mt: 0.2 }}>
                        Оперативная лента заметок и рабочая очередь задач в одном экране.
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                    <Button size="small" variant="outlined" startIcon={<RefreshIcon />} onClick={() => void loadDashboard()} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      Обновить
                    </Button>
                    {canWriteAnn && (
                      <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openCreateAnnouncement} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                        Новая заметка
                      </Button>
                    )}
                  </Stack>
                </Stack>

                <Grid container spacing={0.8}>
                  {actionStrip.map((item) => (
                    <Grid item xs={6} md={2.4} key={item.key}>
                      <Box sx={{ ...getOfficeMetricBlockSx(ui, item.color, { p: 0.8, minHeight: 66, bgcolor: alpha(item.color, theme.palette.mode === 'dark' ? 0.10 : 0.06) }) }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={0.6}>
                          <Box sx={{ color: item.color }}>{item.icon}</Box>
                          <Typography sx={{ fontWeight: 900, color: item.color, fontSize: '1rem', lineHeight: 1 }}>
                            {item.value}
                          </Typography>
                        </Stack>
                        <Typography sx={{ mt: 0.55, fontWeight: 800, fontSize: '0.72rem', lineHeight: 1.2 }}>{item.label}</Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>

                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                  <Button size="small" variant="text" startIcon={<FilterListIcon />} onClick={() => setFiltersOpen((prev) => !prev)} sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 800, py: 0.25 }}>
                    {filtersOpen ? 'Свернуть фильтры' : `Развернуть фильтры${activeFilterCount ? ` (${activeFilterCount})` : ''}`}
                  </Button>
                  <Typography variant="caption" sx={{ color: ui.subtleText, alignSelf: 'center', lineHeight: 1.2 }}>
                    Горячие клавиши: `N` создать заметку, `/` или `F` открыть поиск, `Esc` закрыть окно.
                  </Typography>
                </Stack>

                {filtersOpen && (
                  <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1, borderRadius: '14px' }) }}>
                    <Grid container spacing={1.1}>
                      <Grid item xs={12} md={4}>
                        <TextField
                          fullWidth
                          size="small"
                          label="Поиск по заметкам"
                          value={q}
                          inputRef={searchInputRef}
                          onChange={(event) => setQ(event.target.value)}
                          placeholder="Заголовок, текст, автор..."
                          InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, color: ui.subtleText, mr: 0.8 }} /> }}
                        />
                      </Grid>
                      <Grid item xs={12} sm={6} md={2}>
                        <FormControl fullWidth size="small">
                          <InputLabel id="dashboard-priority-filter-label">Приоритет</InputLabel>
                          <Select labelId="dashboard-priority-filter-label" label="Приоритет" value={priority} onChange={(event) => setPriority(event.target.value)}>
                            <MenuItem value="">Все</MenuItem>
                            <MenuItem value="high">Высокий</MenuItem>
                            <MenuItem value="normal">Обычный</MenuItem>
                            <MenuItem value="low">Низкий</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid item xs={12} sm={6} md={2}><FormControlLabel control={<Checkbox checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />} label="Непрочитанные" /></Grid>
                      <Grid item xs={12} sm={6} md={2}><FormControlLabel control={<Checkbox checked={ackOnly} onChange={(event) => setAckOnly(event.target.checked)} />} label="Нужно подтвердить" /></Grid>
                      <Grid item xs={12} sm={6} md={2}><FormControlLabel control={<Checkbox checked={pinnedOnly} onChange={(event) => setPinnedOnly(event.target.checked)} />} label="Закреплённые" /></Grid>
                      <Grid item xs={12} sm={6} md={3}><FormControlLabel control={<Checkbox checked={hasAttachments} onChange={(event) => setHasAttachments(event.target.checked)} />} label="С файлами" /></Grid>
                      <Grid item xs={12} sm={6} md={3}><FormControlLabel control={<Checkbox checked={myTargetedOnly} onChange={(event) => setMyTargetedOnly(event.target.checked)} />} label="Мои адресные" /></Grid>
                      <Grid item xs={12} md={6} sx={{ display: 'flex', justifyContent: { xs: 'stretch', md: 'flex-end' } }}>
                        <Button variant="outlined" onClick={resetFilters} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', minWidth: 160 }}>
                          Сбросить фильтры
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>
                )}
              </Stack>
            </Card>
          </Box>

          <Grid container spacing={1.2} alignItems="stretch" sx={{ flex: 1, minHeight: 0, height: 0, overflow: 'hidden' }}>
            <Grid item xs={12} lg={8} sx={{ display: 'flex', minHeight: 0, height: '100%' }}>
              <Box sx={{ flex: 1, height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: 0.3 }}>
                <Stack spacing={1}>
                {loading && announcementItems.length === 0 ? (
                  <Card sx={{ ...getOfficePanelSx(ui, { p: 1.2, borderRadius: '16px' }) }}>
                    <Stack spacing={1}>
                      {[0, 1, 2, 3].map((item) => <Skeleton key={item} variant="rounded" height={112} sx={{ borderRadius: '14px' }} />)}
                    </Stack>
                  </Card>
                ) : announcementSections.map((section) => (
                  <Card key={section.key} sx={{ ...getOfficePanelSx(ui, { p: 1.2, borderRadius: '16px' }) }}>
                    <Stack spacing={1}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Stack direction="row" spacing={0.8} alignItems="center">
                          <CampaignIcon sx={{ fontSize: 18, color: theme.palette.primary.main }} />
                          <Typography sx={{ fontWeight: 900 }}>{section.title}</Typography>
                        </Stack>
                        <Chip size="small" label={section.items.length} sx={{ fontWeight: 800 }} />
                      </Stack>
                      {section.items.length === 0 ? (
                        <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 1.6 }) }}>
                          <Typography sx={{ fontWeight: 700, mb: 0.4 }}>{section.empty}</Typography>
                          <Typography variant="body2" sx={{ color: ui.mutedText }}>
                            {section.key === 'all' && canWriteAnn
                              ? 'Создайте новую заметку или ослабьте фильтры, чтобы увидеть больше сообщений.'
                              : 'Когда появятся подходящие элементы, они окажутся в этой секции.'}
                          </Typography>
                          {section.key === 'all' && canWriteAnn && (
                            <Button sx={{ mt: 1, textTransform: 'none', fontWeight: 800, borderRadius: '10px' }} variant="contained" startIcon={<AddIcon />} onClick={openCreateAnnouncement}>
                              Создать заметку
                            </Button>
                          )}
                        </Box>
                      ) : (
                        <Stack spacing={0.8}>{section.items.map((item) => renderAnnouncementCard(item))}</Stack>
                      )}
                    </Stack>
                  </Card>
                ))}
                </Stack>
              </Box>
            </Grid>

            <Grid item xs={12} lg={4} sx={{ display: 'flex', minHeight: 0, height: '100%' }}>
              <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }) }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Stack direction="row" spacing={0.8} alignItems="center">
                    <AssignmentIcon sx={{ fontSize: 18, color: theme.palette.primary.main }} />
                    <Typography sx={{ fontWeight: 900 }}>Очередь задач</Typography>
                  </Stack>
                  <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => navigate('/tasks')} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                    Все задачи
                  </Button>
                </Stack>

                {loading && taskItems.length === 0 ? (
                  <Stack spacing={0.8}>
                    {[0, 1, 2, 3].map((item) => <Skeleton key={item} variant="rounded" height={98} sx={{ borderRadius: '14px' }} />)}
                  </Stack>
                ) : taskQueues.every((section) => section.items.length === 0) ? (
                  <Box sx={{ ...getOfficeEmptyStateSx(ui, { p: 1.6 }) }}>
                    <Typography sx={{ fontWeight: 800, mb: 0.4 }}>Открытых задач сейчас нет.</Typography>
                    <Typography variant="body2" sx={{ color: ui.mutedText }}>
                      Здесь показываются задачи к проверке, просроченные и с новыми комментариями.
                    </Typography>
                  </Box>
                ) : (
                  <Box sx={{ flex: 1, height: '100%', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pr: 0.2 }}>
                    <Stack spacing={1}>
                      {taskQueues.map((section) => (
                        <Box key={section.key}>
                          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.7 }}>
                            <Typography sx={{ fontWeight: 800, fontSize: '0.88rem' }}>{section.title}</Typography>
                            <Chip size="small" label={section.items.length} sx={{ fontWeight: 800 }} />
                          </Stack>
                          {section.items.length === 0 ? (
                            <Typography variant="body2" sx={{ color: ui.subtleText, mb: 0.6 }}>{section.empty}</Typography>
                          ) : (
                            <Stack spacing={0.7}>{section.items.map((task) => renderTaskCard(task))}</Stack>
                          )}
                        </Box>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Card>
            </Grid>
          </Grid>

          <Dialog
            open={announcementOpen}
            onClose={closeAnnouncementDetails}
            fullWidth
            maxWidth="md"
            PaperProps={{
              sx: getOfficeDialogPaperSx(ui),
            }}
          >
            <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }) }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 900, fontSize: '1.1rem', lineHeight: 1.2 }}>
                    {announcementDetails?.title || 'Просмотр заметки'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
                    {announcementDetails?.preview || 'Подробный просмотр заметки, подтверждений и вложений.'}
                  </Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                  {announcementDetails?.id && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<VisibilityIcon />}
                      onClick={() => void loadAnnouncementReads(announcementDetails.id)}
                      disabled={!announcementDetails?.can_manage}
                      sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
                    >
                      Кто прочитал
                    </Button>
                  )}
                  <Button onClick={closeAnnouncementDetails} sx={{ textTransform: 'none', fontWeight: 700 }}>
                    Закрыть
                  </Button>
                </Stack>
              </Stack>
            </Box>
            <DialogContent sx={{ px: 2.2, py: 1.6 }}>
              {announcementLoading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
              {announcementDetails ? (
                <Stack spacing={1.4}>
                  <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', gap: 0.6 }}>
                    <Chip size="small" label={announcementPriorityMeta(announcementDetails.priority).label} sx={{ fontWeight: 800, bgcolor: announcementPriorityMeta(announcementDetails.priority).bg, color: announcementPriorityMeta(announcementDetails.priority).color }} />
                    {announcementDetails.is_updated && <Chip size="small" label="Обновлено" sx={{ fontWeight: 800, bgcolor: 'rgba(124,58,237,0.14)', color: '#7c3aed' }} />}
                    {!announcementDetails.is_updated && announcementDetails.is_unread && <Chip size="small" label="Новое" sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.14)', color: '#2563eb' }} />}
                    {announcementDetails.requires_ack && <Chip size="small" label="Требует подтверждения" sx={{ fontWeight: 800, bgcolor: 'rgba(5,150,105,0.14)', color: '#059669' }} />}
                    {announcementDetails.is_ack_pending && <Chip size="small" label="Ожидает подтверждения" sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }} />}
                    {announcementDetails.is_pinned_active && <Chip size="small" icon={<PushPinOutlinedIcon sx={{ fontSize: '12px !important' }} />} label="Закреплено" sx={{ fontWeight: 800 }} />}
                    {announcementDetails.is_scheduled && <Chip size="small" label="Запланирована" sx={{ fontWeight: 800, bgcolor: 'rgba(217,119,6,0.12)', color: '#d97706' }} />}
                  </Stack>

                  <Grid container spacing={1.2}>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>Автор</Typography>
                      <Typography sx={{ fontWeight: 700 }}>{announcementDetails.author_full_name || announcementDetails.author_username || '-'}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>Аудитория</Typography>
                      <Typography sx={{ fontWeight: 700 }}>{announcementDetails.recipients_summary || 'Всем'}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>Версия</Typography>
                      <Typography sx={{ fontWeight: 700 }}>v{announcementDetails.version || 1}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>Опубликована</Typography>
                      <Typography sx={{ fontWeight: 700 }}>{fmtDateTime(announcementDetails.published_at)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>Обновлена</Typography>
                      <Typography sx={{ fontWeight: 700 }}>{fmtDateTime(announcementDetails.updated_at)}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>Подтверждение</Typography>
                      <Typography sx={{ fontWeight: 700 }}>{announcementDetails.acknowledged_at ? fmtDateTime(announcementDetails.acknowledged_at) : 'Нет'}</Typography>
                    </Grid>
                  </Grid>

                  <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.4, borderRadius: '14px' }) }}>
                    {announcementDetails.body ? (
                      <MarkdownRenderer value={announcementDetails.body} />
                    ) : (
                      <Typography variant="body2" sx={{ color: ui.mutedText }}>
                        Полный текст заметки не заполнен.
                      </Typography>
                    )}
                  </Box>

                  {Array.isArray(announcementDetails.attachments) && announcementDetails.attachments.length > 0 && (
                    <Box sx={{ ...getOfficePanelSx(ui, { p: 1.2, borderRadius: '14px', boxShadow: 'none' }) }}>
                      <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Вложения</Typography>
                      <List disablePadding dense>
                        {announcementDetails.attachments.map((attachment) => (
                          <ListItem
                            key={attachment.id}
                            disableGutters
                            secondaryAction={<IconButton size="small" onClick={() => void downloadAnnouncementAttachment(announcementDetails.id, attachment)}><DownloadIcon fontSize="small" /></IconButton>}
                          >
                            <ListItemAvatar sx={{ minWidth: 36 }}>
                              <Avatar sx={{ width: 24, height: 24, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                                <AttachFileIcon sx={{ fontSize: 14 }} />
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText primary={attachment.file_name || 'file'} secondary={`${fmtFileSize(attachment.file_size)} · ${fmtDateTime(attachment.uploaded_at)}`} />
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: ui.mutedText }}>
                  {announcementLoading ? 'Загрузка заметки...' : 'Заметка недоступна.'}
                </Typography>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} sx={{ width: '100%', justifyContent: 'space-between' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                  {announcementDetails?.is_ack_pending && (
                    <Button variant="contained" startIcon={<TaskAltIcon />} onClick={handleAckAnnouncement} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}>
                      Подтвердить ознакомление
                    </Button>
                  )}
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                  {announcementDetails?.can_manage && canWriteAnn && (
                    <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => void openEditAnnouncement(announcementDetails)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      Редактировать
                    </Button>
                  )}
                  {announcementDetails?.can_manage && canWriteAnn && (
                    <Button variant="outlined" color="warning" onClick={() => void handleArchiveAnnouncement(announcementDetails)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      Снять с публикации
                    </Button>
                  )}
                  {announcementDetails?.id && isAdmin && (
                    <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => void handleDeleteAnnouncement(announcementDetails)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                      Удалить
                    </Button>
                  )}
                </Stack>
              </Stack>
            </DialogActions>
          </Dialog>

          <Dialog
            open={readsOpen}
            onClose={() => setReadsOpen(false)}
            fullWidth
            maxWidth="sm"
            PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
          >
            <DialogTitle sx={{ fontWeight: 900 }}>Статусы ознакомления</DialogTitle>
            <DialogContent dividers>
              {readsLoading ? (
                <LinearProgress sx={{ borderRadius: 999 }} />
              ) : (
                <Stack spacing={1.2}>
                  <Grid container spacing={1}>
                    <Grid item xs={6}><Card sx={{ ...getOfficePanelSx(ui, { p: 1, borderRadius: '12px', boxShadow: 'none' }) }}><Typography variant="caption" sx={{ color: ui.subtleText }}>Получателей</Typography><Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>{readsPayload?.summary?.recipients_total || 0}</Typography></Card></Grid>
                    <Grid item xs={6}><Card sx={{ ...getOfficePanelSx(ui, { p: 1, borderRadius: '12px', boxShadow: 'none' }) }}><Typography variant="caption" sx={{ color: ui.subtleText }}>Прочитали</Typography><Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>{readsPayload?.summary?.seen_total || 0}</Typography></Card></Grid>
                    <Grid item xs={6}><Card sx={{ ...getOfficePanelSx(ui, { p: 1, borderRadius: '12px', boxShadow: 'none' }) }}><Typography variant="caption" sx={{ color: ui.subtleText }}>Подтвердили</Typography><Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>{readsPayload?.summary?.ack_total || 0}</Typography></Card></Grid>
                    <Grid item xs={6}><Card sx={{ ...getOfficePanelSx(ui, { p: 1, borderRadius: '12px', boxShadow: 'none' }) }}><Typography variant="caption" sx={{ color: ui.subtleText }}>Ожидают</Typography><Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>{readsPayload?.summary?.pending_ack_total || 0}</Typography></Card></Grid>
                  </Grid>
                  <List disablePadding>
                    {readsPayload.items.map((item) => (
                      <ListItem key={item.user_id} disableGutters sx={{ py: 0.8 }}>
                        <ListItemAvatar sx={{ minWidth: 40 }}>
                          <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                            {initials(item.full_name || item.username)}
                          </Avatar>
                        </ListItemAvatar>
                        <ListItemText
                          primary={item.full_name || item.username}
                          secondary={`${item.has_seen_current_version ? `Прочитал: ${fmtDateTime(item.read_at)}` : 'Не открывал'}${announcementDetails?.requires_ack ? ` · ${item.has_acknowledged_current_version ? `Подтвердил: ${fmtDateTime(item.acknowledged_at)}` : 'Подтверждение не получено'}` : ''}`}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Stack>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setReadsOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>Закрыть</Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={createOpen}
            onClose={() => setCreateOpen(false)}
            fullWidth
            maxWidth="md"
            PaperProps={{ sx: getOfficeDialogPaperSx(ui) }}
          >
            <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 2.2, py: 1.7 }) }}>
              <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Новая заметка</Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
                Создайте адресное сообщение, закрепите его или запросите подтверждение ознакомления.
              </Typography>
            </Box>
            <DialogContent sx={{ px: 2.2, py: 1.6 }}>
              {renderAnnouncementEditorFields(createPayload, setCreatePayload, {
                filesEnabled: true,
                files: createFiles,
                onFilesChange: setCreateFiles,
              })}
            </DialogContent>
            <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
              <Button onClick={() => setCreateOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>Отмена</Button>
              <Button
                variant="contained"
                onClick={() => void handleCreateAnnouncement()}
                disabled={createSaving || String(createPayload?.title || '').trim().length < 3}
                sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
              >
                {createSaving ? 'Сохранение...' : 'Создать заметку'}
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
              <Typography sx={{ fontWeight: 900, fontSize: '1.05rem' }}>Редактирование заметки</Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
                Любое обновление создаёт новую версию и снова делает заметку новой для получателей.
              </Typography>
            </Box>
            <DialogContent sx={{ px: 2.2, py: 1.6 }}>
              {renderAnnouncementEditorFields(editPayload, setEditPayload)}
            </DialogContent>
            <DialogActions sx={{ px: 2.2, py: 1.4, borderTop: '1px solid', borderColor: ui.borderSoft }}>
              <Button onClick={() => setEditOpen(false)} sx={{ textTransform: 'none', fontWeight: 700 }}>Отмена</Button>
              <Button
                variant="contained"
                onClick={() => void handleSaveAnnouncement()}
                disabled={editSaving || String(editPayload?.title || '').trim().length < 3}
                sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
              >
                {editSaving ? 'Сохранение...' : 'Сохранить изменения'}
              </Button>
            </DialogActions>
          </Dialog>

        <Drawer
          anchor="right"
          open={taskOpen}
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
                    {taskDetails?.title || 'Быстрый просмотр задачи'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.35 }}>
                    Комментарии, история и вложения без перехода на отдельную страницу.
                  </Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8}>
                  {taskDetails?.id && (
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<OpenInNewIcon />}
                      onClick={() => navigate(`/tasks?task=${encodeURIComponent(taskDetails.id)}`)}
                      sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
                    >
                      Открыть в задачах
                    </Button>
                  )}
                  <Button onClick={closeTaskDetails} sx={{ textTransform: 'none', fontWeight: 700 }}>
                    Закрыть
                  </Button>
                </Stack>
              </Stack>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.6 }}>
              {taskLoading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
              {taskDetails ? (
                <Stack spacing={1.5}>
                  <Stack direction="row" spacing={0.6} sx={{ flexWrap: 'wrap', gap: 0.6 }}>
                    <Chip size="small" label={taskStatusMeta(taskDetails.status).label} sx={{ fontWeight: 800, bgcolor: taskStatusMeta(taskDetails.status).bg, color: taskStatusMeta(taskDetails.status).color }} />
                    {taskDetails.is_overdue && <Chip size="small" label="Просрочено" sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }} />}
                    {taskDetails.has_unread_comments && <Chip size="small" label="Новый комментарий" sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />}
                    {Number(taskDetails.comments_count || 0) > 0 && <Chip size="small" label={`Комментарии: ${taskDetails.comments_count}`} sx={{ fontWeight: 700 }} />}
                    {Number(taskDetails.attachments_count || 0) > 0 && <Chip size="small" label={`Файлы: ${taskDetails.attachments_count}`} sx={{ fontWeight: 700 }} />}
                  </Stack>

                  <Grid container spacing={1.1}>
                    <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Постановщик</Typography><Typography sx={{ fontWeight: 700 }}>{taskDetails.created_by_full_name || taskDetails.created_by_username || '-'}</Typography></Grid>
                    <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Исполнитель</Typography><Typography sx={{ fontWeight: 700 }}>{taskDetails.assignee_full_name || taskDetails.assignee_username || '-'}</Typography></Grid>
                    <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Контролёр</Typography><Typography sx={{ fontWeight: 700 }}>{taskDetails.controller_full_name || taskDetails.controller_username || '-'}</Typography></Grid>
                    <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Срок</Typography><Typography sx={{ fontWeight: 700 }}>{taskDetails.due_at ? fmtDateTime(taskDetails.due_at) : 'Без срока'}</Typography></Grid>
                    <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Сдано</Typography><Typography sx={{ fontWeight: 700 }}>{fmtDateTime(taskDetails.submitted_at)}</Typography></Grid>
                    <Grid item xs={12} sm={6}><Typography variant="caption" sx={{ color: ui.subtleText }}>Проверено</Typography><Typography sx={{ fontWeight: 700 }}>{fmtDateTime(taskDetails.reviewed_at)}</Typography></Grid>
                  </Grid>

                  {taskDetails.latest_report && (
                    <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.2, borderRadius: '14px' }) }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                        <Box>
                          <Typography sx={{ fontWeight: 800 }}>Последний отчёт</Typography>
                          <Typography variant="caption" sx={{ color: ui.subtleText }}>
                            {fmtDateTime(taskDetails.latest_report.uploaded_at)} · {taskDetails.latest_report.uploaded_by_username || '-'}
                          </Typography>
                        </Box>
                        {taskDetails.latest_report.file_name && (
                          <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={() => void downloadTaskReport(taskDetails.latest_report)} sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}>
                            Скачать
                          </Button>
                        )}
                      </Stack>
                      {taskDetails.latest_report.comment && (
                        <Typography variant="body2" sx={{ mt: 0.8, whiteSpace: 'pre-wrap' }}>
                          {taskDetails.latest_report.comment}
                        </Typography>
                      )}
                    </Box>
                  )}

                  <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 1.3, borderRadius: '14px' }) }}>
                    {String(taskDetails.description || '').trim() ? (
                      <MarkdownRenderer value={taskDetails.description} />
                    ) : (
                      <Typography variant="body2" sx={{ color: ui.mutedText }}>
                        Описание задачи не заполнено.
                      </Typography>
                    )}
                  </Box>

                  {Array.isArray(taskDetails.attachments) && taskDetails.attachments.length > 0 && (
                    <Box sx={{ ...getOfficePanelSx(ui, { p: 1.2, borderRadius: '14px', boxShadow: 'none' }) }}>
                      <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Файлы задачи</Typography>
                      <List disablePadding dense>
                        {taskDetails.attachments.map((attachment) => (
                          <ListItem
                            key={attachment.id}
                            disableGutters
                            secondaryAction={<IconButton size="small" onClick={() => void downloadTaskAttachment(taskDetails.id, attachment)}><DownloadIcon fontSize="small" /></IconButton>}
                          >
                            <ListItemAvatar sx={{ minWidth: 36 }}>
                              <Avatar sx={{ width: 24, height: 24, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                                <AttachFileIcon sx={{ fontSize: 14 }} />
                              </Avatar>
                            </ListItemAvatar>
                            <ListItemText primary={attachment.file_name || 'file'} secondary={`${fmtFileSize(attachment.file_size)} · ${fmtDateTime(attachment.uploaded_at)}`} />
                          </ListItem>
                        ))}
                      </List>
                    </Box>
                  )}

                  <Box sx={{ ...getOfficePanelSx(ui, { borderRadius: '14px', overflow: 'hidden', boxShadow: 'none' }) }}>
                    <Box sx={{ ...getOfficeHeaderBandSx(ui, { px: 1.2, py: 1 }) }}>
                      <Typography sx={{ fontWeight: 800 }}>Обсуждение</Typography>
                    </Box>
                    <Box ref={taskCommentsRef} sx={{ maxHeight: 280, overflowY: 'auto', px: 1.2, py: 0.8 }}>
                      {taskComments.length === 0 ? (
                        <Typography variant="body2" sx={{ color: ui.mutedText, py: 0.8 }}>
                          Комментариев пока нет.
                        </Typography>
                      ) : (
                        <List disablePadding dense>
                          {taskComments.map((item) => (
                            <ListItem key={item.id} disableGutters sx={{ alignItems: 'flex-start', py: 0.6 }}>
                              <ListItemAvatar sx={{ minWidth: 36 }}>
                                <Avatar sx={{ width: 24, height: 24, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main, fontSize: '0.62rem' }}>
                                  {initials(item.full_name || item.username)}
                                </Avatar>
                              </ListItemAvatar>
                              <ListItemText
                                primary={item.full_name || item.username || '-'}
                                secondary={(
                                  <>
                                    <Typography component="span" variant="caption" sx={{ display: 'block', color: ui.subtleText, mb: 0.25 }}>
                                      {fmtDateTime(item.created_at)}
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
                        <TextField label="Новый комментарий" value={taskCommentBody} onChange={(event) => setTaskCommentBody(event.target.value)} multiline minRows={3} fullWidth />
                        <Stack direction="row" justifyContent="flex-end">
                          <Button
                            variant="contained"
                            onClick={() => void handleAddTaskComment()}
                            disabled={taskCommentSaving || String(taskCommentBody || '').trim().length === 0}
                            sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                          >
                            {taskCommentSaving ? 'Сохранение...' : 'Добавить комментарий'}
                          </Button>
                        </Stack>
                      </Stack>
                    </Box>
                  </Box>

                  <Box sx={{ ...getOfficePanelSx(ui, { p: 1.2, borderRadius: '14px', boxShadow: 'none' }) }}>
                    <Typography sx={{ fontWeight: 800, mb: 1 }}>История статусов</Typography>
                    {taskStatusLog.length === 0 ? (
                      <Typography variant="body2" sx={{ color: ui.mutedText }}>
                        Переходы статусов пока не зафиксированы.
                      </Typography>
                    ) : (
                      <Stack spacing={0.9}>
                        {taskStatusLog.map((item, index) => (
                          <Stack key={item.id || `${item.changed_at}-${index}`} direction="row" spacing={1}>
                            <Box sx={{ width: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                              <Box sx={{ width: 10, height: 10, borderRadius: '999px', bgcolor: taskStatusMeta(item.new_status).color, mt: 0.4 }} />
                              {index < taskStatusLog.length - 1 && <Box sx={{ width: 2, flex: 1, bgcolor: ui.border, minHeight: 18, borderRadius: '999px' }} />}
                            </Box>
                            <Box sx={{ flex: 1, pb: 0.4 }}>
                              <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
                                {`${item.old_status ? taskStatusMeta(item.old_status).label : 'Создано'} -> ${taskStatusMeta(item.new_status).label}`}
                              </Typography>
                              <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                {item.changed_by_username || '-'} · {fmtDateTime(item.changed_at)}
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
                  {taskLoading ? 'Загрузка задачи...' : 'Карточка задачи недоступна.'}
                </Typography>
              )}
            </Box>
          </Drawer>
        </Box>
      </PageShell>
    </MainLayout>
  );
}

export default Dashboard;
