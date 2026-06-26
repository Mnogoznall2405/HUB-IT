import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import { hubAPI } from '../../api/client';
import { departmentsAPI } from '../../api/departments';
import {
  canOpenTransferActUpload,
  getTransferActReminderLabel,
  getTransferActUploadUrl,
  isTransferActUploadTask,
} from '../../lib/hubTaskIntegrations';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';
import MarkdownRenderer from './MarkdownRenderer';
import TaskChecklist from './TaskChecklist';
import { TaskEditDialog, TaskReopenDialog, TaskReviewDialog, TaskSubmitDialog } from './TaskActionDialogs';

const EMPTY_REFERENCES = {
  assignees: [],
  controllers: [],
  departments: [],
  projects: [],
  objects: [],
};

export const taskWorkspaceStatusMeta = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'new') return { label: 'Новое', color: '#2563eb', bg: 'rgba(37,99,235,0.14)' };
  if (value === 'in_progress') return { label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.14)' };
  if (value === 'review') return { label: 'На проверке', color: '#7c3aed', bg: 'rgba(124,58,237,0.14)' };
  if (value === 'done') return { label: 'Готово', color: '#059669', bg: 'rgba(5,150,105,0.14)' };
  return { label: value || '-', color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
};

export const taskWorkspacePriorityMeta = (priority) => {
  const value = String(priority || '').toLowerCase();
  if (value === 'urgent') return { label: 'Срочный', color: '#dc2626' };
  if (value === 'high') return { label: 'Высокий', color: '#d97706' };
  if (value === 'low') return { label: 'Низкий', color: '#64748b' };
  return { label: 'Обычный', color: '#2563eb' };
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

const formatFileSize = (value) => {
  const bytes = Number(value || 0);
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
};

const userLabel = (task, prefix) => (
  task?.[`${prefix}_full_name`]
  || task?.[`${prefix}_username`]
  || '-'
);

const downloadResponse = (response, fallbackName) => {
  const blob = response?.data instanceof Blob ? response.data : new Blob([response?.data || response]);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fallbackName || 'file';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

function DetailRow({ label, value, accent = false, ui }) {
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <Typography variant="body2" sx={{ width: 126, flexShrink: 0, color: ui.subtleText }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ minWidth: 0, fontWeight: accent ? 800 : 600, overflowWrap: 'anywhere' }}>
        {value || '-'}
      </Typography>
    </Stack>
  );
}

function TaskWorkspacePanel({
  taskId,
  onClose,
  onOpenInTasks,
  onNavigate,
  onTaskUpdated,
}) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const normalizedTaskId = String(taskId || '').trim();
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [updatingChecklistItemId, setUpdatingChecklistItemId] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [references, setReferences] = useState(EMPTY_REFERENCES);
  const [referencesLoading, setReferencesLoading] = useState(false);
  const loadRequestIdRef = useRef(0);
  const onTaskUpdatedRef = useRef(onTaskUpdated);

  useEffect(() => {
    onTaskUpdatedRef.current = onTaskUpdated;
  }, [onTaskUpdated]);

  const loadTask = useCallback(async ({ quiet = false, notify = false } = {}) => {
    if (!normalizedTaskId) return null;
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const nextTask = await hubAPI.getTask(normalizedTaskId);
      if (loadRequestIdRef.current !== requestId) return null;
      setTask(nextTask || null);
      if (notify && nextTask) onTaskUpdatedRef.current?.(nextTask);
      return nextTask || null;
    } catch (requestError) {
      if (loadRequestIdRef.current !== requestId) return null;
      setTask(null);
      setError(requestError?.response?.data?.detail || requestError?.message || 'Не удалось загрузить карточку задачи.');
      return null;
    } finally {
      if (!quiet && loadRequestIdRef.current === requestId) setLoading(false);
    }
  }, [normalizedTaskId]);

  useEffect(() => {
    setTask(null);
    setEditOpen(false);
    setSubmitOpen(false);
    setReviewOpen(false);
    setReferences(EMPTY_REFERENCES);
    if (normalizedTaskId) void loadTask();
  }, [loadTask, normalizedTaskId]);

  const runAction = useCallback(async (key, action) => {
    if (!task?.id || busyAction) return;
    setBusyAction(key);
    setError('');
    try {
      await action();
      await loadTask({ quiet: true, notify: true });
      window.dispatchEvent(new CustomEvent('hub-refresh-notifications'));
    } catch (actionError) {
      setError(actionError?.response?.data?.detail || actionError?.message || 'Не удалось выполнить действие с задачей.');
    } finally {
      setBusyAction('');
    }
  }, [busyAction, loadTask, task?.id]);

  const loadEditReferences = useCallback(async () => {
    if (referencesLoading) return;
    setReferencesLoading(true);
    setError('');
    try {
      const results = await Promise.allSettled([
        hubAPI.getControllers(),
        departmentsAPI.list(),
        hubAPI.getTaskProjects({ include_inactive: true }),
        hubAPI.getTaskObjects({ include_inactive: true }),
      ]);
      if (results.every((result) => result.status === 'rejected')) {
        throw results[0].reason || new Error('Reference data is unavailable');
      }
      const items = (index) => (
        results[index].status === 'fulfilled' && Array.isArray(results[index].value?.items)
          ? results[index].value.items
          : []
      );
      setReferences({
        assignees: [],
        controllers: items(0),
        departments: items(1),
        projects: items(2),
        objects: items(3),
      });
      setEditOpen(true);
    } catch (requestError) {
      setError(requestError?.message || 'Не удалось загрузить данные для редактирования.');
    } finally {
      setReferencesLoading(false);
    }
  }, [referencesLoading]);

  const handleToggleChecklist = useCallback(async (itemId, done) => {
    if (!task?.id || !itemId || updatingChecklistItemId) return;
    const nextItems = (Array.isArray(task.checklist_items) ? task.checklist_items : []).map((item) => (
      String(item?.id || '') === String(itemId) ? { ...item, done: Boolean(done) } : item
    ));
    setUpdatingChecklistItemId(itemId);
    setError('');
    try {
      await hubAPI.updateTask(task.id, { checklist_items: nextItems });
      await loadTask({ quiet: true, notify: true });
    } catch (actionError) {
      setError(actionError?.response?.data?.detail || actionError?.message || 'Не удалось обновить чек-лист.');
    } finally {
      setUpdatingChecklistItemId('');
    }
  }, [loadTask, task, updatingChecklistItemId]);

  const handleUploadAttachment = useCallback(async (file) => {
    if (!file || !task?.id) return;
    await runAction('upload', () => hubAPI.uploadTaskAttachment({ taskId: task.id, file }));
  }, [runAction, task?.id]);

  const handleDownloadAttachment = useCallback(async (attachment) => {
    if (!task?.id || !attachment?.id) return;
    setBusyAction(`download-${attachment.id}`);
    setError('');
    try {
      const response = await hubAPI.downloadTaskAttachment({ taskId: task.id, attachmentId: attachment.id });
      downloadResponse(response, attachment.file_name || 'attachment');
    } catch (actionError) {
      setError(actionError?.response?.data?.detail || actionError?.message || 'Не удалось скачать файл.');
    } finally {
      setBusyAction('');
    }
  }, [task?.id]);

  const handleCopyLink = useCallback(async () => {
    if (!task?.id || !navigator?.clipboard?.writeText) return;
    const url = new URL('/tasks', window.location.origin);
    url.searchParams.set('task', task.id);
    try {
      await navigator.clipboard.writeText(url.toString());
    } catch (clipboardError) {
      setError(clipboardError?.message || 'Не удалось скопировать ссылку.');
    }
  }, [task?.id]);

  const capabilities = task?.capabilities || {};
  const status = taskWorkspaceStatusMeta(task?.status);
  const priority = taskWorkspacePriorityMeta(task?.priority);
  const attachments = Array.isArray(task?.attachments) ? task.attachments : [];
  const transferReminder = isTransferActUploadTask(task);
  const hasPrimaryAction = capabilities.can_start || capabilities.can_submit || capabilities.can_review || capabilities.can_reopen || canOpenTransferActUpload(task);

  const openTransferUpload = () => {
    const href = getTransferActUploadUrl(task);
    if (href) onNavigate?.(href);
  };

  return (
    <Box
      data-testid="task-workspace-panel"
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: ui.pageBg,
        color: ui.textPrimary,
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1.25,
          borderBottom: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <Avatar sx={{ width: 38, height: 38, bgcolor: alpha(theme.palette.primary.main, 0.12), color: theme.palette.primary.main }}>
            <TaskAltRoundedIcon fontSize="small" />
          </Avatar>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.2, overflowWrap: 'anywhere' }}>
              {task?.title || (loading ? 'Загрузка задачи...' : 'Карточка задачи')}
            </Typography>
            {task ? (
              <Stack direction="row" spacing={0.55} sx={{ mt: 0.7, flexWrap: 'wrap', gap: 0.55 }}>
                <Chip size="small" label={status.label} sx={{ fontWeight: 800, bgcolor: status.bg, color: status.color }} />
                {String(task.priority || 'normal') !== 'normal' ? (
                  <Chip size="small" label={priority.label} sx={{ fontWeight: 800, bgcolor: alpha(priority.color, 0.12), color: priority.color }} />
                ) : null}
                {transferReminder ? (
                  <Chip size="small" label={getTransferActReminderLabel(task)} sx={{ fontWeight: 800, bgcolor: alpha('#2563eb', 0.12), color: '#2563eb' }} />
                ) : null}
              </Stack>
            ) : null}
          </Box>
          <Stack direction="row" spacing={0.1}>
            <Tooltip title="Обновить">
              <span>
                <IconButton size="small" onClick={() => void loadTask()} disabled={loading} sx={{ width: { xs: 44, sm: 'auto' }, height: { xs: 44, sm: 'auto' } }}>
                  <RefreshRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Открыть в задачах">
              <span>
                <IconButton size="small" onClick={() => task?.id && onOpenInTasks?.(task.id)} disabled={!task?.id} sx={{ width: { xs: 44, sm: 'auto' }, height: { xs: 44, sm: 'auto' } }}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Закрыть карточку">
              <IconButton size="small" onClick={onClose} sx={{ width: { xs: 44, sm: 'auto' }, height: { xs: 44, sm: 'auto' } }}>
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>

      {loading ? <LinearProgress /> : null}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, py: 1.35 }}>
        {error ? <Alert severity="error" sx={{ mb: 1.2 }}>{error}</Alert> : null}
        {!loading && !task && !error ? (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>Карточка задачи недоступна.</Typography>
        ) : null}
        {task ? (
          <Stack spacing={1.15}>
            <Box sx={{ p: 1.25, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.75 }}>
                <Typography sx={{ fontWeight: 900 }}>Описание</Typography>
                {capabilities.can_edit ? (
                  <Button
                    size="small"
                    startIcon={referencesLoading ? <CircularProgress size={14} /> : <EditOutlinedIcon fontSize="small" />}
                    onClick={() => void loadEditReferences()}
                    disabled={referencesLoading}
                    sx={{ textTransform: 'none', fontWeight: 700 }}
                  >
                    Изменить
                  </Button>
                ) : null}
              </Stack>
              {String(task.description || '').trim() ? (
                <MarkdownRenderer value={task.description} />
              ) : (
                <Typography variant="body2" sx={{ color: ui.mutedText }}>Описание задачи не заполнено.</Typography>
              )}
            </Box>

            <Box sx={{ p: 1.25, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
              <Stack spacing={0.9}>
                <DetailRow label="Постановщик" value={userLabel(task, 'created_by')} ui={ui} />
                <DetailRow label="Исполнитель" value={userLabel(task, 'assignee')} ui={ui} />
                <DetailRow label="Контролёр" value={userLabel(task, 'controller')} ui={ui} />
                <Divider />
                <DetailRow label="Крайний срок" value={task.due_at ? formatDateTime(task.due_at) : 'Без срока'} accent ui={ui} />
                <DetailRow label="Статус" value={status.label} accent ui={ui} />
                <DetailRow label="Дата создания" value={formatDateTime(task.created_at)} ui={ui} />
                <DetailRow label="Проект" value={task.project_name || 'Без проекта'} ui={ui} />
                <DetailRow label="Объект" value={task.object_name || 'Без объекта'} ui={ui} />
              </Stack>
            </Box>

            <Box
              data-testid="task-workspace-files"
              sx={{ p: 1.25, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: attachments.length ? 0.8 : 0 }}>
                <Stack direction="row" spacing={0.7} alignItems="center">
                  <AttachFileIcon sx={{ fontSize: 19, color: theme.palette.primary.main }} />
                  <Typography sx={{ fontWeight: 900 }}>Файлы: {attachments.length}</Typography>
                </Stack>
                {capabilities.can_upload_files ? (
                  <Button component="label" size="small" disabled={busyAction === 'upload'} sx={{ minWidth: 0 }}>
                    {busyAction === 'upload' ? 'Загрузка...' : 'Добавить'}
                    <input type="file" hidden onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      event.target.value = '';
                      void handleUploadAttachment(file);
                    }} />
                  </Button>
                ) : null}
              </Stack>
              {attachments.length ? (
                <Stack spacing={0.55}>
                  {attachments.map((attachment) => (
                    <Stack
                      key={attachment.id}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={{ p: 0.8, borderRadius: '10px', bgcolor: ui.panelBg }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>{attachment.file_name || 'file'}</Typography>
                        <Typography variant="caption" sx={{ color: ui.subtleText }}>
                          {[formatFileSize(attachment.file_size), formatDateTime(attachment.uploaded_at)].filter(Boolean).join(' · ')}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        aria-label={`Скачать ${attachment.file_name || 'файл'}`}
                        disabled={busyAction === `download-${attachment.id}`}
                        onClick={() => void handleDownloadAttachment(attachment)}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" sx={{ color: ui.mutedText }}>Файлов пока нет.</Typography>
              )}
            </Box>

            <TaskChecklist
              task={task}
              canUpdate={Boolean(capabilities.can_update_checklist)}
              updatingItemId={updatingChecklistItemId}
              onToggle={(itemId, done) => void handleToggleChecklist(itemId, done)}
              ui={ui}
            />
          </Stack>
        ) : null}
      </Box>

      {task ? (
        <Box
          data-testid="task-workspace-actions"
          sx={{
            px: 1.5,
            py: 1.15,
            borderTop: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: `0 -10px 30px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.18 : 0.06)}`,
          }}
        >
          <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.8 }}>
            {canOpenTransferActUpload(task) ? (
              <Button variant="contained" onClick={openTransferUpload} sx={{ fontWeight: 800, boxShadow: 'none' }}>Загрузить акт</Button>
            ) : null}
            {capabilities.can_start ? (
              <Button variant="contained" onClick={() => void runAction('start', () => hubAPI.startTask(task.id))} disabled={Boolean(busyAction)} sx={{ fontWeight: 800, boxShadow: 'none' }}>
                {busyAction === 'start' ? 'Запуск...' : 'Начать'}
              </Button>
            ) : null}
            {capabilities.can_submit ? (
              <Button variant="contained" onClick={() => setSubmitOpen(true)} disabled={Boolean(busyAction)} sx={{ fontWeight: 800, boxShadow: 'none' }}>
                Сдать
              </Button>
            ) : null}
            {capabilities.can_review ? (
              <Button variant="contained" color="secondary" onClick={() => setReviewOpen(true)} disabled={Boolean(busyAction)} sx={{ fontWeight: 800, boxShadow: 'none' }}>
                Проверить
              </Button>
            ) : null}
            {capabilities.can_reopen ? (
              <Button variant="outlined" onClick={() => setReopenOpen(true)} disabled={Boolean(busyAction)} sx={{ fontWeight: 800, boxShadow: 'none' }}>
                Вернуть в работу
              </Button>
            ) : null}
            {!hasPrimaryAction && capabilities.can_edit ? (
              <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => void loadEditReferences()} disabled={referencesLoading}>
                Изменить
              </Button>
            ) : null}
            <Box sx={{ flex: 1 }} />
            <Tooltip title="Копировать ссылку">
              <IconButton onClick={() => void handleCopyLink()}><ContentCopyIcon fontSize="small" /></IconButton>
            </Tooltip>
          </Stack>
        </Box>
      ) : null}

      <TaskEditDialog
        open={editOpen}
        task={task}
        references={references}
        referencesLoading={referencesLoading}
        saving={busyAction === 'edit'}
        onClose={() => setEditOpen(false)}
        onSave={(payload) => void runAction('edit', async () => {
          await hubAPI.updateTask(task.id, payload);
          setEditOpen(false);
        })}
        ui={ui}
      />
      <TaskReviewDialog
        open={reviewOpen}
        task={task}
        saving={busyAction === 'review'}
        onClose={() => setReviewOpen(false)}
        onSubmit={(decision, comment) => void runAction('review', async () => {
          await hubAPI.reviewTask(task.id, { decision, comment });
          setReviewOpen(false);
        })}
        ui={ui}
      />
      <TaskSubmitDialog
        open={submitOpen}
        task={task}
        saving={busyAction === 'submit'}
        onClose={() => setSubmitOpen(false)}
        onSubmit={({ comment, file }) => void runAction('submit', async () => {
          await hubAPI.submitTask({ taskId: task.id, comment, file });
          setSubmitOpen(false);
        })}
        ui={ui}
      />
      <TaskReopenDialog
        open={reopenOpen}
        task={task}
        saving={busyAction === 'reopen'}
        onClose={() => setReopenOpen(false)}
        onSubmit={({ due_at: dueAt }) => void runAction('reopen', async () => {
          await hubAPI.reopenTask(task.id, { due_at: dueAt });
          setReopenOpen(false);
        })}
        ui={ui}
      />
    </Box>
  );
}

export default memo(TaskWorkspacePanel);
