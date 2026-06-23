import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Avatar,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  Drawer,
  Grid,
  IconButton,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import FlagIcon from '@mui/icons-material/Flag';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PauseIcon from '@mui/icons-material/Pause';
import ThumbUpOffAltIcon from '@mui/icons-material/ThumbUpOffAlt';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import MarkdownRenderer from './MarkdownRenderer';
import OverflowMenu from '../common/OverflowMenu';

export const TASK_DETAIL_TABS = ['comments', 'files', 'history'];

export const normalizeTaskDetailTab = (value) => (
  TASK_DETAIL_TABS.includes(String(value || '').trim().toLowerCase())
    ? String(value || '').trim().toLowerCase()
    : 'comments'
);

const clampTextSx = (lines) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

const renderKvRows = (rows, ui) => (
  <Stack spacing={1}>
    {rows.map((row) => (
      <Box key={row.label}>
        <Typography variant="caption" sx={{ color: ui.subtleText }}>
          {row.label}
        </Typography>
        <Typography sx={{ fontWeight: 700 }}>
          {row.value || '-'}
        </Typography>
      </Box>
    ))}
  </Stack>
);

export function TaskDetailHeader({
  task,
  statusMeta,
  priorityMeta,
  transferLabel,
  isTransferReminder,
  mobileTitle = 'Задача',
  onBack,
  onCopyLink,
  mobile = false,
  actionMenuItems = [],
  onActionMenuSelect,
  ui,
  theme,
}) {
  const priority = priorityMeta;
  const chips = (
    <Stack direction="row" spacing={0.55} sx={{ flexWrap: 'wrap', gap: 0.55 }}>
      <Chip
        size="small"
        label={statusMeta.label}
        sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }}
      />
      {priority?.value !== 'normal' && (
        <Chip
          size="small"
          icon={<FlagIcon sx={{ fontSize: '12px !important', color: `${priority.dotColor} !important` }} />}
          label={priority.label}
          sx={{
            fontWeight: 800,
            bgcolor: alpha(priority.dotColor, 0.12),
            color: priority.dotColor,
            '& .MuiChip-icon': { ml: '2px' },
          }}
        />
      )}
      {isTransferReminder && (
        <Chip
          size="small"
          label={transferLabel}
          sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
        />
      )}
      {task?.is_overdue && (
        <Chip
          size="small"
          label="Просрочено"
          sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }}
        />
      )}
      {task?.has_unread_comments && (
        <Chip
          size="small"
          label="Новый комментарий"
          sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
        />
      )}
      {Number(task?.comments_count || 0) > 0 && (
        <Chip size="small" label={`Комментарии: ${task.comments_count}`} sx={{ fontWeight: 700 }} />
      )}
      {Number(task?.attachments_count || 0) > 0 && (
        <Chip size="small" label={`Файлы: ${task.attachments_count}`} sx={{ fontWeight: 700 }} />
      )}
    </Stack>
  );

  if (mobile) {
    return (
      <Box
        data-testid="task-detail-mobile-header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          px: 1,
          py: 0.95,
          borderBottom: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: alpha(ui.pageBg, 0.98),
          backdropFilter: 'blur(10px)',
        }}
      >
        <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between" sx={{ position: 'relative', minHeight: 44 }}>
          <Button
            variant="text"
            startIcon={<ArrowBackIcon />}
            onClick={onBack}
            sx={{ textTransform: 'none', fontWeight: 800, minWidth: 0, px: 0.5 }}
          >
            Назад
          </Button>
          <Typography
            data-testid="task-detail-mobile-title"
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              maxWidth: '52%',
              color: ui.mutedText,
              fontWeight: 900,
              fontSize: '1.05rem',
              lineHeight: 1.1,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              pointerEvents: 'none',
            }}
          >
            {mobileTitle}
          </Typography>
          {Array.isArray(actionMenuItems) && actionMenuItems.length > 0 ? (
            <Box data-testid="task-detail-mobile-actions">
              <OverflowMenu
                label="Действия задачи"
                size="medium"
                items={actionMenuItems}
                onSelect={onActionMenuSelect}
              />
            </Box>
          ) : null}
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        position: 'sticky',
        top: 0,
        zIndex: 2,
        px: { xs: 1.2, md: 1.5 },
        py: 1.25,
        borderBottom: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: alpha(ui.pageBg, 0.96),
        backdropFilter: 'blur(10px)',
      }}
    >
      <Stack spacing={1}>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={onBack}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', flexShrink: 0 }}
            >
              Назад к доске
            </Button>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, fontSize: { xs: '1.05rem', md: '1.3rem' }, lineHeight: 1.18 }}>
                {task?.title || 'Карточка задачи'}
              </Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.25 }}>
                Полная карточка задачи с обсуждением, файлами и историей статусов.
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={0.8} alignItems="center">
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={onCopyLink}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
            >
              Копировать ссылку
            </Button>
          </Stack>
        </Stack>

        <Stack direction="row" spacing={0.55} sx={{ flexWrap: 'wrap', gap: 0.55 }}>
          <Chip
            size="small"
            label={statusMeta.label}
            sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }}
          />
          {priority?.value !== 'normal' && (
            <Chip
              size="small"
              icon={<FlagIcon sx={{ fontSize: '12px !important', color: `${priority.dotColor} !important` }} />}
              label={priority.label}
              sx={{
                fontWeight: 800,
                bgcolor: alpha(priority.dotColor, 0.12),
                color: priority.dotColor,
                '& .MuiChip-icon': { ml: '2px' },
              }}
            />
          )}
          {isTransferReminder && (
            <Chip
              size="small"
              label={transferLabel}
              sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
            />
          )}
          {task?.is_overdue && (
            <Chip
              size="small"
              label="Просрочено"
              sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }}
            />
          )}
          {task?.has_unread_comments && (
            <Chip
              size="small"
              label="Новый комментарий"
              sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
            />
          )}
          {Number(task?.comments_count || 0) > 0 && (
            <Chip size="small" label={`Комментарии: ${task.comments_count}`} sx={{ fontWeight: 700 }} />
          )}
          {Number(task?.attachments_count || 0) > 0 && (
            <Chip size="small" label={`Файлы: ${task.attachments_count}`} sx={{ fontWeight: 700 }} />
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

export function TaskMobileContentSummary({
  task,
  attachments = [],
  canUploadFiles = false,
  uploadingAttachment = false,
  onUploadAttachment,
  onDownloadAttachment,
  onDownloadReport,
  formatDateTime,
  formatFileSize,
  ui,
  theme,
}) {
  const description = String(task?.description || '').trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const report = task?.latest_report?.file_name
    ? {
      id: `report-${task.latest_report.id || task.latest_report.file_name}`,
      type: 'report',
      file_name: task.latest_report.file_name,
      uploaded_at: task.latest_report.uploaded_at,
      uploaded_by_username: task.latest_report.uploaded_by_username,
      payload: task.latest_report,
    }
    : null;
  const fileItems = [
    ...normalizedAttachments.map((attachment) => ({
      id: `attachment-${attachment.id || attachment.file_name}`,
      type: 'attachment',
      file_name: attachment.file_name || 'file',
      file_size: attachment.file_size,
      uploaded_at: attachment.uploaded_at,
      payload: attachment,
    })),
    ...(report ? [report] : []),
  ];
  const visibleFiles = fileItems.slice(0, 3);
  const hiddenFilesCount = Math.max(fileItems.length - visibleFiles.length, 0);
  const hasFiles = fileItems.length > 0;
  const handleUploadChange = (event) => {
    const file = event.target.files?.[0];
    if (file) onUploadAttachment?.(file);
    event.target.value = '';
  };

  return (
    <Stack spacing={1} data-testid="task-mobile-content">
      <Box
        sx={{
          p: 1.15,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 950, fontSize: '1.12rem', lineHeight: 1.22 }}>
          {task?.title || 'Карточка задачи'}
        </Typography>
      </Box>

      <Box
        data-testid="task-mobile-description"
        sx={{
          p: 1.15,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 850, mb: 0.65 }}>Описание</Typography>
        {description ? (
          <MarkdownRenderer value={description} />
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Описание задачи не заполнено.
          </Typography>
        )}
      </Box>

      {(hasFiles || canUploadFiles) && (
        <Box
          data-testid="task-mobile-files"
          sx={{
            p: 1.05,
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
          }}
        >
          <Stack spacing={0.85}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
              <Typography sx={{ fontWeight: 850 }}>Файлы</Typography>
              {hiddenFilesCount > 0 && (
                <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>
                  ещё {hiddenFilesCount}
                </Typography>
              )}
            </Stack>

            {hasFiles ? (
              <Stack spacing={0.55}>
                {visibleFiles.map((file) => (
                  <Stack
                    key={file.id}
                    data-testid={`task-mobile-file-${file.id}`}
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    sx={{
                      minWidth: 0,
                      p: 0.65,
                      borderRadius: '10px',
                      bgcolor: ui.actionBg,
                    }}
                  >
                    <Avatar sx={{ width: 30, height: 30, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                      <AttachFileIcon sx={{ fontSize: 16 }} />
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: '0.86rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {file.file_name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: ui.subtleText }}>
                        {file.type === 'report' ? 'Отчёт' : formatFileSize?.(file.file_size)} · {formatDateTime?.(file.uploaded_at)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      aria-label={`Скачать ${file.file_name}`}
                      onClick={() => {
                        if (file.type === 'report') {
                          onDownloadReport?.(file.payload);
                          return;
                        }
                        onDownloadAttachment?.(file.payload);
                      }}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                Файлов пока нет.
              </Typography>
            )}

            {canUploadFiles && (
              <Button
                size="small"
                variant={hasFiles ? 'text' : 'outlined'}
                component="label"
                startIcon={<AttachFileIcon />}
                disabled={uploadingAttachment}
                sx={{ alignSelf: hasFiles ? 'flex-start' : 'stretch', textTransform: 'none', fontWeight: 800, borderRadius: '10px' }}
              >
                {uploadingAttachment ? 'Загрузка...' : 'Прикрепить файл'}
                <input type="file" hidden onChange={handleUploadChange} />
              </Button>
            )}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

const getTaskUserLabel = (task, prefix) => (
  task?.[`${prefix}_full_name`]
  || task?.[`${prefix}_username`]
  || '-'
);

const getInitialsFromName = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
};

const getChecklistStats = (task) => {
  const items = Array.isArray(task?.checklist_items) ? task.checklist_items : [];
  const total = Number(task?.checklist_total ?? items.length);
  const done = Number(task?.checklist_done ?? items.filter((item) => Boolean(item?.done)).length);
  return { items, done, total };
};

const getTaskViewCount = (task) => {
  const candidates = [task?.views_count, task?.view_count, task?.watchers_count, task?.seen_count];
  const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) > 0);
  return value == null ? null : Number(value);
};

const getTaskLikeCount = (task) => {
  const candidates = [task?.likes_count, task?.like_count, task?.reactions_count];
  const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) > 0);
  return value == null ? null : Number(value);
};

function TaskMobilePersonRow({ label, name, ui, theme }) {
  const isDark = theme.palette.mode === 'dark';
  const resolvedName = name || '-';
  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minHeight: 58 }}>
      <Avatar
        sx={{
          width: 42,
          height: 42,
          bgcolor: isDark ? '#7bbd22' : alpha(theme.palette.success.main, 0.16),
          color: isDark ? '#fff' : theme.palette.success.dark,
          fontWeight: 900,
        }}
      >
        {getInitialsFromName(resolvedName)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ color: ui.subtleText, fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.15 }}>
          {label}
        </Typography>
        <Typography sx={{ color: ui.textPrimary, fontSize: '1.08rem', fontWeight: 700, lineHeight: 1.22, overflowWrap: 'anywhere' }}>
          {resolvedName}
        </Typography>
      </Box>
    </Stack>
  );
}

function TaskMobileRailButton({
  children,
  icon,
  onClick,
  disabled = false,
  active = false,
  testId,
  ui,
  theme,
}) {
  const primary = theme.palette.primary.main;
  return (
    <Button
      data-testid={testId}
      variant="outlined"
      startIcon={icon}
      onClick={onClick}
      disabled={disabled}
      sx={{
        flex: '0 0 auto',
        minHeight: 42,
        borderRadius: 999,
        px: 1.55,
        textTransform: 'none',
        fontWeight: 900,
        whiteSpace: 'nowrap',
        color: active ? '#fff' : primary,
        bgcolor: active ? primary : 'transparent',
        borderColor: alpha(primary, active ? 0 : 0.72),
        '&:hover': {
          bgcolor: active ? primary : alpha(primary, 0.08),
          borderColor: primary,
        },
        '& .MuiButton-startIcon': { mr: 0.7 },
        '&.Mui-disabled': {
          color: ui.subtleText,
          borderColor: ui.borderSoft,
        },
      }}
    >
      {children}
    </Button>
  );
}

export function TaskMobileDetailScreen({
  task,
  attachments = [],
  canUploadFiles = false,
  uploadingAttachment = false,
  onUploadAttachment,
  onDownloadAttachment,
  onDownloadReport,
  onOpenChecklist,
  taskDiscussionEnabled = false,
  onOpenTaskDiscussion,
  discussionOpening = false,
  formatDateTime,
  formatFileSize,
  ui,
  theme,
  actions,
}) {
  const isDark = theme.palette.mode === 'dark';
  const description = String(task?.description || '').trim();
  const normalizedAttachments = Array.isArray(attachments) ? attachments : [];
  const report = task?.latest_report?.file_name
    ? {
      id: `report-${task.latest_report.id || task.latest_report.file_name}`,
      type: 'report',
      file_name: task.latest_report.file_name,
      uploaded_at: task.latest_report.uploaded_at,
      uploaded_by_username: task.latest_report.uploaded_by_username,
      payload: task.latest_report,
    }
    : null;
  const fileItems = [
    ...normalizedAttachments.map((attachment) => ({
      id: `attachment-${attachment.id || attachment.file_name}`,
      type: 'attachment',
      file_name: attachment.file_name || 'file',
      file_size: attachment.file_size,
      uploaded_at: attachment.uploaded_at,
      payload: attachment,
    })),
    ...(report ? [report] : []),
  ];
  const checklist = getChecklistStats(task);
  const likeCount = getTaskLikeCount(task);
  const viewCount = getTaskViewCount(task);
  const dueText = task?.due_at ? formatDateTime?.(task.due_at) : 'Без срока';
  const cardSx = {
    borderRadius: '22px',
    bgcolor: isDark ? '#101010' : ui.panelSolid,
    border: '1px solid',
    borderColor: isDark ? alpha('#fff', 0.04) : ui.borderSoft,
    boxShadow: isDark ? 'none' : ui.shellShadow,
  };
  const muted = isDark ? alpha('#fff', 0.56) : ui.subtleText;

  const handleUploadChange = (event) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (file) onUploadAttachment?.(file);
  };

  return (
    <Stack
      data-testid="task-mobile-detail-screen"
      spacing={2}
      sx={{
        minHeight: '100%',
        px: 2,
        pt: 3.5,
        pb: 3,
        color: ui.textPrimary,
      }}
    >
      <Box data-testid="task-mobile-content">
        <Typography sx={{ fontWeight: 950, fontSize: '2rem', lineHeight: 1.06, letterSpacing: '-0.04em', mb: 2.1, overflowWrap: 'anywhere' }}>
          {task?.title || 'Задача'}
        </Typography>
        {description ? (
          <Box data-testid="task-mobile-description" sx={{ color: muted, fontSize: '1.2rem', lineHeight: 1.35, mb: 2.6 }}>
            <MarkdownRenderer value={description} />
          </Box>
        ) : (
          <Typography data-testid="task-mobile-description" sx={{ color: muted, fontSize: '1.08rem', mb: 2.6 }}>
            Описание задачи не заполнено.
          </Typography>
        )}

        <Stack spacing={1.1}>
          <TaskMobilePersonRow label="Постановщик" name={getTaskUserLabel(task, 'created_by')} ui={ui} theme={theme} />
          <TaskMobilePersonRow label="Исполнитель" name={getTaskUserLabel(task, 'assignee')} ui={ui} theme={theme} />
          {getTaskUserLabel(task, 'controller') !== '-' ? (
            <TaskMobilePersonRow label="Контролёр" name={getTaskUserLabel(task, 'controller')} ui={ui} theme={theme} />
          ) : null}
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5} sx={{ mt: 2.2, minHeight: 48 }}>
          <Stack direction="row" spacing={1.2} alignItems="center" sx={{ minWidth: 0, color: task?.is_overdue ? theme.palette.error.main : ui.textPrimary }}>
            <CalendarMonthOutlinedIcon sx={{ fontSize: 33, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
              {dueText}
            </Typography>
          </Stack>
          {task?.is_overdue ? (
            <Box
              data-testid="task-mobile-overdue-pill"
              sx={{
                flexShrink: 0,
                px: 1.45,
                py: 0.7,
                borderRadius: 999,
                color: theme.palette.error.light,
                bgcolor: alpha(theme.palette.error.main, isDark ? 0.22 : 0.12),
                fontWeight: 900,
              }}
            >
              Просрочена
            </Box>
          ) : null}
        </Stack>
      </Box>

      <Box
        data-testid="task-mobile-action-rail"
        sx={{
          mx: -2,
          px: 2,
          overflowX: 'auto',
          display: 'flex',
          gap: 1,
          alignItems: 'center',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {actions ? <Box sx={{ flex: '0 0 auto', '& .MuiButton-root': { minHeight: 42 } }}>{actions}</Box> : null}
        <IconButton
          data-testid="task-mobile-pause-action"
          disabled
          sx={{
            flex: '0 0 auto',
            width: 42,
            height: 42,
            border: '1px solid',
            borderColor: isDark ? alpha('#fff', 0.24) : ui.borderSoft,
            color: muted,
          }}
        >
          <PauseIcon />
        </IconButton>
        <TaskMobileRailButton
          testId="task-mobile-files-chip"
          icon={<AttachFileIcon />}
          ui={ui}
          theme={theme}
        >
          {`Файлы: ${fileItems.length}`}
        </TaskMobileRailButton>
        <TaskMobileRailButton
          testId="task-mobile-checklist-chip"
          icon={<ChecklistOutlinedIcon />}
          onClick={onOpenChecklist}
          ui={ui}
          theme={theme}
        >
          Чек-лист
        </TaskMobileRailButton>
        {taskDiscussionEnabled ? (
          <TaskMobileRailButton
            testId="task-mobile-open-chat"
            icon={<ForumOutlinedIcon />}
            onClick={onOpenTaskDiscussion}
            disabled={discussionOpening}
            active
            ui={ui}
            theme={theme}
          >
            {discussionOpening ? 'Открываем...' : 'Чат задачи'}
          </TaskMobileRailButton>
        ) : null}
      </Box>

      {(likeCount != null || viewCount != null) ? (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ color: muted }}>
          {likeCount != null ? (
            <Stack direction="row" spacing={0.45} alignItems="center" sx={{ px: 1.15, py: 0.45, borderRadius: 999, border: '1px solid', borderColor: ui.borderSoft }}>
              <ThumbUpOffAltIcon sx={{ fontSize: 18 }} />
              <Typography sx={{ fontWeight: 800 }}>Нравится</Typography>
              <Typography sx={{ fontWeight: 800 }}>{likeCount}</Typography>
            </Stack>
          ) : <Box />}
          {viewCount != null ? (
            <Stack direction="row" spacing={0.45} alignItems="center">
              <VisibilityOutlinedIcon sx={{ fontSize: 20 }} />
              <Typography sx={{ fontWeight: 800 }}>{viewCount}</Typography>
            </Stack>
          ) : null}
        </Stack>
      ) : null}

      <Box data-testid="task-mobile-files" sx={{ ...cardSx, p: 2 }}>
        <Typography sx={{ color: muted, fontSize: '1rem', fontWeight: 800, mb: 1.1 }}>
          {`Файлы: ${fileItems.length}`}
        </Typography>
        {fileItems.length > 0 ? (
          <Stack direction="row" spacing={1.15} sx={{ overflowX: 'auto', pb: 0.6, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
            {fileItems.map((file) => (
              <Box
                key={file.id}
                data-testid={`task-mobile-file-${file.id}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (file.type === 'report') {
                    onDownloadReport?.(file.payload);
                    return;
                  }
                  onDownloadAttachment?.(file.payload);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    if (file.type === 'report') onDownloadReport?.(file.payload);
                    else onDownloadAttachment?.(file.payload);
                  }
                }}
                sx={{
                  width: 92,
                  flex: '0 0 auto',
                  p: 1,
                  borderRadius: '14px',
                  border: '1px solid',
                  borderColor: ui.borderSoft,
                  bgcolor: isDark ? '#151515' : ui.actionBg,
                  cursor: 'pointer',
                }}
              >
                <Avatar sx={{ width: 46, height: 46, mx: 'auto', mb: 0.8, bgcolor: isDark ? '#eef2f7' : alpha(theme.palette.primary.main, 0.12), color: isDark ? '#111827' : theme.palette.primary.main }}>
                  <AttachFileIcon />
                </Avatar>
                <Typography sx={{ color: muted, fontSize: '0.78rem', fontWeight: 800, textAlign: 'center', lineHeight: 1.15 }} noWrap>
                  {file.file_name}
                </Typography>
                <Typography sx={{ color: muted, fontSize: '0.68rem', textAlign: 'center', mt: 0.3 }} noWrap>
                  {file.type === 'report' ? 'Отчёт' : formatFileSize?.(file.file_size)}
                </Typography>
              </Box>
            ))}
          </Stack>
        ) : null}
        {canUploadFiles ? (
          <Button
            component="label"
            startIcon={<AddIcon />}
            disabled={uploadingAttachment}
            sx={{
              mt: fileItems.length ? 1.2 : 0,
              minHeight: 44,
              px: 0,
              color: muted,
              textTransform: 'none',
              fontWeight: 800,
              fontSize: '1.25rem',
              justifyContent: 'flex-start',
            }}
          >
            {uploadingAttachment ? 'Загрузка...' : 'Добавить файлы'}
            <input type="file" hidden onChange={handleUploadChange} />
          </Button>
        ) : null}
        {!canUploadFiles && fileItems.length === 0 ? (
          <Typography sx={{ color: muted }}>Файлов пока нет.</Typography>
        ) : null}
      </Box>

      <Box
        data-testid="task-mobile-checklist-summary"
        role="button"
        tabIndex={0}
        onClick={onOpenChecklist}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenChecklist?.();
          }
        }}
        sx={{ ...cardSx, p: 2, cursor: 'pointer' }}
      >
        <Typography sx={{ color: muted, fontSize: '1rem', fontWeight: 800, mb: 1.4 }}>
          {`Чек-листы: ${checklist.total}`}
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1.4}>
          <ChecklistOutlinedIcon sx={{ color: theme.palette.primary.main, fontSize: 28 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: '1.15rem', fontWeight: 800 }}>Чек-лист</Typography>
            <Typography sx={{ color: muted, fontSize: '1rem', fontWeight: 700, mt: 0.35 }}>
              {`${checklist.done}/${checklist.total} выполнено`}
            </Typography>
          </Box>
          <ExpandMoreIcon sx={{ transform: 'rotate(-90deg)', color: muted }} />
        </Stack>
      </Box>
    </Stack>
  );
}

export function TaskMobileChecklistScreen({
  task,
  canUpdate = false,
  onToggleItem,
  onAddItem,
  ui,
  theme,
}) {
  const [adding, setAdding] = useState(false);
  const [draftText, setDraftText] = useState('');
  const isDark = theme.palette.mode === 'dark';
  const checklist = getChecklistStats(task);
  const muted = isDark ? alpha('#fff', 0.56) : ui.subtleText;
  const dividerColor = isDark ? alpha('#fff', 0.12) : ui.borderSoft;
  const canSaveDraft = canUpdate && String(draftText || '').trim().length > 0;

  const saveDraft = () => {
    if (!canSaveDraft) return;
    onAddItem?.(draftText.trim());
    setDraftText('');
    setAdding(false);
  };

  return (
    <Stack
      data-testid="task-mobile-checklist-screen"
      sx={{
        minHeight: '100%',
        px: 2,
        pt: 3.5,
        pb: 3,
        color: ui.textPrimary,
      }}
    >
      <Typography sx={{ fontWeight: 950, fontSize: '2rem', lineHeight: 1.06, letterSpacing: '-0.04em' }}>
        Чек-лист
      </Typography>
      <Typography data-testid="task-mobile-checklist-progress" sx={{ color: muted, fontSize: '1.2rem', fontWeight: 800, mt: 1.1, mb: 3.4 }}>
        {`${checklist.done}/${checklist.total} выполнено`}
      </Typography>

      <Stack data-testid="task-mobile-checklist-items" spacing={0}>
        {checklist.items.map((item, index) => {
          const itemId = String(item?.id || '');
          return (
            <Stack
              key={itemId || `${item?.text || 'item'}-${index}`}
              direction="row"
              alignItems="center"
              spacing={1.35}
              sx={{
                minHeight: 68,
                borderBottom: index < checklist.items.length - 1 ? '1px solid' : 'none',
                borderColor: dividerColor,
              }}
            >
              <Checkbox
                checked={Boolean(item?.done)}
                disabled={!canUpdate}
                onChange={(event) => onToggleItem?.(itemId, event.target.checked)}
                inputProps={{ 'aria-label': `Отметить пункт ${index + 1}` }}
                sx={{
                  p: 0,
                  color: muted,
                  '& .MuiSvgIcon-root': { fontSize: 34 },
                }}
              />
              <Typography
                sx={{
                  fontSize: '1.25rem',
                  fontWeight: 850,
                  lineHeight: 1.18,
                  color: item?.done ? muted : ui.textPrimary,
                  textDecoration: item?.done ? 'line-through' : 'none',
                  overflowWrap: 'anywhere',
                }}
              >
                {item?.text || `Пункт ${index + 1}`}
              </Typography>
            </Stack>
          );
        })}
      </Stack>

      {adding ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveDraft();
              if (event.key === 'Escape') {
                setAdding(false);
                setDraftText('');
              }
            }}
            placeholder="Название пункта"
            inputProps={{ 'data-testid': 'task-mobile-checklist-new-input' }}
          />
          <Button
            variant="contained"
            disabled={!canSaveDraft}
            onClick={saveDraft}
            sx={{ minHeight: 40, textTransform: 'none', fontWeight: 850, borderRadius: 999 }}
          >
            Добавить
          </Button>
        </Stack>
      ) : (
        <Button
          data-testid="task-mobile-checklist-add"
          startIcon={<AddIcon />}
          disabled={!canUpdate}
          onClick={() => setAdding(true)}
          sx={{
            alignSelf: 'flex-start',
            mt: 2.6,
            minHeight: 44,
            px: 0,
            color: muted,
            textTransform: 'none',
            fontWeight: 850,
            fontSize: '1.35rem',
          }}
        >
          Добавить пункт
        </Button>
      )}
    </Stack>
  );
}

export function TaskPrimaryActions({
  task,
  canOpenTransferActUpload,
  canStartTask,
  canSubmitTask,
  canReviewTask,
  canEditTask,
  canDeleteTask,
  onOpenTransferActReminder,
  onStartTask,
  onOpenSubmitTask,
  onOpenReviewTask,
  onOpenEditTask,
  onDeleteTask,
  onCopyLink,
  compactMobile = false,
  mobileRail = false,
}) {
  const showSecondaryActions = !compactMobile && (canEditTask || canDeleteTask || onCopyLink);

  if (compactMobile) {
    const primaryAction = (() => {
      if (canOpenTransferActUpload) {
        return {
          label: 'Загрузить акт',
          variant: 'contained',
          color: 'primary',
          onClick: () => onOpenTransferActReminder(task),
        };
      }
      if (canStartTask) {
        return {
          label: 'Начать',
          variant: 'outlined',
          color: 'primary',
          onClick: () => onStartTask(task.id),
        };
      }
      if (canSubmitTask) {
        return {
          label: 'Сдать',
          variant: 'contained',
          color: 'primary',
          onClick: () => onOpenSubmitTask(task),
        };
      }
      if (canReviewTask) {
        return {
          label: 'Проверить',
          variant: 'contained',
          color: 'secondary',
          onClick: () => onOpenReviewTask(task),
        };
      }
      return null;
    })();

    if (!primaryAction) return null;

    return (
      <Button
        fullWidth={!mobileRail}
        variant={primaryAction.variant}
        color={primaryAction.color}
        onClick={primaryAction.onClick}
        sx={{
          textTransform: 'none',
          fontWeight: 900,
          borderRadius: mobileRail ? 999 : '10px',
          boxShadow: 'none',
          minHeight: mobileRail ? 42 : undefined,
          px: mobileRail ? 2.2 : undefined,
          whiteSpace: 'nowrap',
        }}
      >
        {primaryAction.label}
      </Button>
    );
  }

  return (
    <Stack spacing={0.8}>
      {canOpenTransferActUpload && (
        <Button
          fullWidth
          variant="contained"
          onClick={() => onOpenTransferActReminder(task)}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
        >
          Загрузить подписанный акт
        </Button>
      )}
      {canStartTask && (
        <Button
          fullWidth
          variant="outlined"
          onClick={() => onStartTask(task.id)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          В работу
        </Button>
      )}
      {canSubmitTask && (
        <Button
          fullWidth
          variant="contained"
          onClick={() => onOpenSubmitTask(task)}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
        >
          Сдать работу
        </Button>
      )}
      {canReviewTask && (
        <Button
          fullWidth
          variant="contained"
          color="secondary"
          onClick={() => onOpenReviewTask(task)}
          sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
        >
          Проверить
        </Button>
      )}

      {showSecondaryActions && <Divider />}

      {!compactMobile && canEditTask && (
        <Button
          fullWidth
          variant="outlined"
          onClick={() => onOpenEditTask(task)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          Редактировать
        </Button>
      )}
      {!compactMobile && canDeleteTask && (
        <Button
          fullWidth
          color="error"
          variant="outlined"
          onClick={() => onDeleteTask(task)}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          Удалить
        </Button>
      )}
      {!compactMobile && onCopyLink && (
        <Button
          fullWidth
          variant="text"
          startIcon={<ContentCopyIcon />}
          onClick={onCopyLink}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          Копировать ссылку
        </Button>
      )}
    </Stack>
  );
}

export function TaskContextSidebar({
  task,
  ui,
  theme,
  statusMeta,
  priorityMeta,
  transferLabel,
  isTransferReminder,
  formatDateTime,
  actionState,
  actions,
  mobile = false,
}) {
  const summaryRows = [
    { label: 'Постановщик', value: task?.created_by_full_name || task?.created_by_username || '-' },
    { label: 'Исполнитель', value: task?.assignee_full_name || task?.assignee_username || '-' },
    { label: 'Контролёр', value: task?.controller_full_name || task?.controller_username || '-' },
    { label: 'Проверивший', value: task?.reviewer_full_name || '-' },
    { label: 'Проект', value: task?.project_name || 'Без проекта' },
    { label: 'Объект', value: task?.object_name || 'Без объекта' },
  ];
  const timelineRows = [
    { label: 'Дата постановки задачи', value: task?.protocol_date ? formatDateTime(task.protocol_date) : '-' },
    { label: 'Срок', value: task?.due_at ? formatDateTime(task.due_at) : 'Без срока' },
    { label: 'Создано', value: formatDateTime(task?.created_at) },
    { label: 'Обновлено', value: formatDateTime(task?.updated_at || task?.created_at) },
    { label: 'Сдано', value: formatDateTime(task?.submitted_at) },
    { label: 'Проверено', value: formatDateTime(task?.reviewed_at) },
    { label: 'Завершено', value: formatDateTime(task?.completed_at) },
  ];

  if (mobile) {
    const isPassive = Boolean(actionState?.passive);
    const nextActionLabel = actionState?.stepLabel || 'Открыть детали';
    const actionHint = actionState?.hint || 'Посмотрите описание, чек-лист и обсуждение ниже.';
    const sectionLabel = isPassive ? 'Статус' : 'Что сделать';

    return (
      <Stack spacing={1} sx={{ alignSelf: 'stretch' }}>
        <Box
          data-testid={isPassive ? 'task-context-mobile-status' : 'task-context-mobile-action'}
          sx={{
            p: 0.9,
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
          }}
        >
          <Stack spacing={0.65}>
            <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {sectionLabel}
            </Typography>
            <Typography sx={{ fontWeight: 950, fontSize: '0.98rem', lineHeight: 1.18 }}>
              {nextActionLabel}
            </Typography>
            <Typography variant="body2" sx={{ color: ui.mutedText, lineHeight: 1.35 }}>
              {actionHint}
            </Typography>
            {!isPassive && actions ? (
              <Box sx={{ pt: 0.15 }}>
                {actions}
              </Box>
            ) : null}
          </Stack>
        </Box>

        <Accordion
          defaultExpanded={false}
          disableGutters
          data-testid="task-context-mobile-context"
          sx={{
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 800 }}>Контекст задачи</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }} />
              {priorityMeta?.value !== 'normal' && (
                <Chip
                  size="small"
                  label={priorityMeta.label}
                  sx={{ fontWeight: 800, bgcolor: alpha(priorityMeta.dotColor, 0.12), color: priorityMeta.dotColor }}
                />
              )}
              {isTransferReminder && (
                <Chip size="small" label={transferLabel} sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />
              )}
            </Stack>
            {renderKvRows(summaryRows, ui)}
          </AccordionDetails>
        </Accordion>

        <Accordion
          defaultExpanded={false}
          disableGutters
          data-testid="task-context-mobile-timeline"
          sx={{
            borderRadius: '14px',
            border: '1px solid',
            borderColor: ui.borderSoft,
            bgcolor: ui.panelSolid,
            boxShadow: ui.shellShadow,
            '&:before': { display: 'none' },
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography sx={{ fontWeight: 800 }}>Сроки и состояние</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            {renderKvRows(timelineRows, ui)}
          </AccordionDetails>
        </Accordion>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.1} sx={{ position: { lg: 'sticky' }, top: { lg: 16 }, alignSelf: 'start' }}>
      <Box
        sx={{
          p: 1.2,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Действия</Typography>
        {actions}
      </Box>

      <Box
        sx={{
          p: 1.2,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Контекст задачи</Typography>
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }} />
          {priorityMeta?.value !== 'normal' && (
            <Chip
              size="small"
              label={priorityMeta.label}
              sx={{ fontWeight: 800, bgcolor: alpha(priorityMeta.dotColor, 0.12), color: priorityMeta.dotColor }}
            />
          )}
        </Stack>
        {renderKvRows(summaryRows, ui)}
      </Box>

      <Box
        sx={{
          p: 1.2,
          borderRadius: '14px',
          border: '1px solid',
          borderColor: ui.borderSoft,
          bgcolor: ui.panelSolid,
          boxShadow: ui.shellShadow,
        }}
      >
        <Typography sx={{ fontWeight: 800, mb: 0.8 }}>Сроки и состояние</Typography>
        {renderKvRows(timelineRows, ui)}
      </Box>

      {isTransferReminder && (
        <Box
          sx={{
            p: 1.2,
            borderRadius: '14px',
            border: '1px solid',
            borderColor: alpha('#2563eb', 0.18),
            bgcolor: 'rgba(37,99,235,0.06)',
            boxShadow: ui.shellShadow,
          }}
        >
          <Typography sx={{ fontWeight: 800, color: '#2563eb', mb: 0.45 }}>
            Напоминание по акту
          </Typography>
          <Typography variant="body2" sx={{ color: ui.mutedText, mb: 0.7 }}>
            Задача живёт до загрузки всех подписанных актов и закрывается автоматически после последнего commit.
          </Typography>
          <Chip
            size="small"
            label={transferLabel}
            sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }}
          />
        </Box>
      )}
    </Stack>
  );
}

export function TaskActivityTabs({
  activeTab,
  onTabChange,
  comments,
  attachments,
  statusLog,
  commentBody,
  onCommentChange,
  onAddComment,
  commentSaving,
  canUploadFiles,
  onUploadAttachment,
  uploadingAttachment,
  onDownloadAttachment,
  formatDateTime,
  formatFileSize,
  getInitials,
  statusMeta,
  ui,
  theme,
  mobile = false,
  hideFilesTab = false,
  taskDiscussionEnabled = false,
  onOpenTaskDiscussion,
  discussionOpening = false,
}) {
  const commentsRef = useRef(null);
  const effectiveActiveTab = hideFilesTab && activeTab === 'files' ? 'comments' : activeTab;

  useEffect(() => {
    if (effectiveActiveTab !== 'comments' || !commentsRef.current) return;
    commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
  }, [effectiveActiveTab, comments]);

  return (
    <Box
      sx={{
        borderRadius: '16px',
        border: '1px solid',
        borderColor: ui.borderSoft,
        bgcolor: ui.panelSolid,
        boxShadow: ui.shellShadow,
        overflow: 'hidden',
      }}
    >
      <Box sx={{ px: 1.2, pt: 1.05, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        <Tabs
          value={effectiveActiveTab}
          onChange={(_, value) => onTabChange(value)}
          variant="scrollable"
          allowScrollButtonsMobile
          sx={{
            minHeight: 40,
            '& .MuiTab-root': { textTransform: 'none', fontWeight: 700, minHeight: 40, fontSize: '0.84rem' },
            '& .MuiTabs-indicator': { borderRadius: '2px', height: 3 },
          }}
        >
          <Tab value="comments" label={`Комментарии (${comments.length})`} />
          {!hideFilesTab && <Tab value="files" label={`Файлы (${attachments.length})`} />}
          <Tab value="history" label={`История (${statusLog.length})`} />
        </Tabs>
      </Box>

      <Box sx={{ px: 1.2, py: 1.2 }}>
        {effectiveActiveTab === 'comments' && (
          <Stack spacing={1}>
            {taskDiscussionEnabled ? (
              <Box
                sx={{
                  p: 1,
                  borderRadius: '12px',
                  border: '1px solid',
                  borderColor: ui.borderSoft,
                  bgcolor: alpha(theme.palette.primary.main, 0.05),
                }}
              >
                <Typography sx={{ fontWeight: 800, mb: 0.45 }}>
                  Обсуждение в корпоративном чате
                </Typography>
                <Typography variant="body2" sx={{ color: ui.mutedText, mb: 1 }}>
                  Новые сообщения по задаче отправляются в чат участников задачи.
                </Typography>
                <Button
                  variant="contained"
                  startIcon={<ForumOutlinedIcon />}
                  onClick={() => onOpenTaskDiscussion?.()}
                  disabled={discussionOpening}
                  sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                >
                  {discussionOpening ? 'Открываем чат…' : 'Открыть чат'}
                </Button>
              </Box>
            ) : null}

            {comments.length > 0 ? (
              <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>
                {taskDiscussionEnabled ? 'Архив комментариев' : 'Комментарии'}
              </Typography>
            ) : null}

            <Box ref={commentsRef} sx={{ maxHeight: mobile ? 'none' : 380, overflowY: mobile ? 'visible' : 'auto', pr: 0.4 }}>
              {comments.length === 0 ? (
                <Typography variant="body2" sx={{ color: ui.mutedText }}>
                  {taskDiscussionEnabled ? 'Архивных комментариев пока нет.' : 'Комментариев пока нет.'}
                </Typography>
              ) : (
                <List disablePadding dense>
                  {comments.map((item) => (
                    <ListItem key={item.id} disableGutters sx={{ alignItems: 'flex-start', py: 0.65 }}>
                      <ListItemAvatar sx={{ minWidth: 38 }}>
                        <Avatar
                          sx={{
                            width: 28,
                            height: 28,
                            bgcolor: alpha(theme.palette.primary.main, 0.14),
                            color: theme.palette.primary.main,
                            fontSize: '0.68rem',
                          }}
                        >
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

            {!taskDiscussionEnabled ? (
              <>
                <Divider />

                <Stack spacing={0.8}>
                  <TextField
                    label="Новый комментарий"
                    value={commentBody}
                    onChange={(event) => onCommentChange(event.target.value)}
                    multiline
                    minRows={3}
                    fullWidth
                  />
                  <Stack direction="row" justifyContent="flex-end">
                    <Button
                      variant="contained"
                      onClick={() => onAddComment()}
                      disabled={commentSaving || String(commentBody || '').trim().length === 0}
                      sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none', width: { xs: '100%', sm: 'auto' } }}
                    >
                      {commentSaving ? 'Сохранение...' : 'Добавить комментарий'}
                    </Button>
                  </Stack>
                </Stack>
              </>
            ) : null}
          </Stack>
        )}

        {!hideFilesTab && effectiveActiveTab === 'files' && (
          <Stack spacing={1}>
            {attachments.length === 0 ? (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                Вложений пока нет.
              </Typography>
            ) : (
              <List disablePadding dense>
                {attachments.map((attachment) => (
                  <ListItem
                    key={attachment.id}
                    disableGutters
                    secondaryAction={(
                      <IconButton size="small" onClick={() => onDownloadAttachment(attachment)}>
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    )}
                  >
                    <ListItemAvatar sx={{ minWidth: 38 }}>
                      <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                        <AttachFileIcon sx={{ fontSize: 15 }} />
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={attachment.file_name || 'file'}
                      secondary={`${formatFileSize(attachment.file_size)} · ${formatDateTime(attachment.uploaded_at)}`}
                    />
                  </ListItem>
                ))}
              </List>
            )}

            {canUploadFiles && (
              <Button
                size="small"
                variant="outlined"
                component="label"
                startIcon={<AttachFileIcon />}
                disabled={uploadingAttachment}
                sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 700, borderRadius: '10px', width: { xs: '100%', sm: 'auto' } }}
              >
                {uploadingAttachment ? 'Загрузка...' : 'Прикрепить файл'}
                <input
                  type="file"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) onUploadAttachment(file);
                    event.target.value = '';
                  }}
                />
              </Button>
            )}
          </Stack>
        )}

        {effectiveActiveTab === 'history' && (
          <Stack spacing={0.95}>
            {statusLog.length === 0 ? (
              <Typography variant="body2" sx={{ color: ui.mutedText }}>
                Переходы статусов пока не зафиксированы.
              </Typography>
            ) : (
              statusLog.map((item, index) => (
                <Stack key={item.id || `${item.changed_at}-${index}`} direction="row" spacing={1}>
                  <Box sx={{ width: 16, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '999px', bgcolor: statusMeta(item.new_status).color, mt: 0.4 }} />
                    {index < statusLog.length - 1 && (
                      <Box sx={{ width: 2, flex: 1, bgcolor: ui.borderSoft, minHeight: 18, borderRadius: '999px' }} />
                    )}
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
              ))
            )}
          </Stack>
        )}
      </Box>
    </Box>
  );
}

export function TaskPreviewDrawer({
  open,
  onClose,
  loading,
  task,
  mobile = false,
  ui,
  theme,
  paperSx,
  statusMeta,
  priorityMeta,
  transferLabel,
  isTransferReminder,
  canOpenTransferActUpload,
  onOpenTransferActReminder,
  onOpenInTasks,
  onDownloadReport,
  formatDateTime,
  latestCommentPreview,
  taskDiscussionEnabled = false,
  onOpenTaskDiscussion,
  discussionOpening = false,
}) {
  const priority = priorityMeta;
  const latestReportComment = String(task?.latest_report?.comment || '').trim();
  const descriptionPreview = String(task?.description || '').trim();
  const nextStepText = canOpenTransferActUpload
    ? 'Загрузите подписанный акт, чтобы закрыть напоминание и убрать задачу из очереди.'
    : task?.status === 'review'
      ? 'Откройте полную карточку, чтобы проверить результат, комментарии и историю статусов.'
      : task?.status === 'new'
        ? 'Откройте полную карточку и возьмите задачу в работу, если готовы её принять.'
        : task?.status === 'in_progress'
          ? 'Продолжите работу в полной карточке: там доступны обсуждение, файлы и история.'
          : 'Откройте полную карточку, чтобы посмотреть полный контекст и зафиксированный результат.';

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: mobile ? '100%' : { xs: '100%', sm: 460, lg: 520 },
          maxWidth: '100%',
          borderLeft: mobile ? 'none' : '1px solid',
          borderRadius: mobile ? 0 : undefined,
          display: 'flex',
          flexDirection: 'column',
          ...paperSx,
        },
      }}
    >
      <Box data-testid={mobile ? 'task-preview-mobile-header' : undefined} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: ui.borderSoft }}>
        {mobile ? (
          <Stack spacing={0.9}>
            <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
              <IconButton onClick={onClose} size="small" sx={{ mt: -0.2, ml: -0.35 }} aria-label="Назад к центру управления">
                <ArrowBackIcon fontSize="small" />
              </IconButton>
              <Box data-testid="task-preview-mobile-actions">
                {task?.id ? (
                  <OverflowMenu
                    items={[{ key: 'open', label: 'Открыть в задачах', icon: <OpenInNewIcon fontSize="small" /> }]}
                    onSelect={(key) => {
                      if (key === 'open') onOpenInTasks?.();
                    }}
                    label="Действия задачи"
                  />
                ) : null}
              </Box>
            </Stack>
            <Typography sx={{ fontWeight: 900, fontSize: '1.02rem', lineHeight: 1.22 }}>
              {task?.title || 'Быстрый просмотр задачи'}
            </Typography>
          </Stack>
        ) : (
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontWeight: 900, fontSize: '1.05rem', lineHeight: 1.2 }}>
                {task?.title || 'Быстрый просмотр задачи'}
              </Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mt: 0.3, ...clampTextSx(6) }}>
                Ключевые детали и следующее действие без полного перехода в рабочую карточку.
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.8}>
              {task?.id && taskDiscussionEnabled && (
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<ForumOutlinedIcon />}
                  onClick={() => onOpenTaskDiscussion?.()}
                  disabled={discussionOpening}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', boxShadow: 'none' }}
                >
                  {discussionOpening ? 'Открытие...' : 'Чат по задаче'}
                </Button>
              )}
              {task?.id && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<OpenInNewIcon />}
                  onClick={onOpenInTasks}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
                >
                  Открыть в задачах
                </Button>
              )}
              <Button onClick={onClose} sx={{ textTransform: 'none', fontWeight: 700 }}>
                Закрыть
              </Button>
            </Stack>
          </Stack>
        )}
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5 }}>
        {loading ? (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Загрузка карточки задачи...
          </Typography>
        ) : task ? (
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={0.55} sx={{ flexWrap: 'wrap', gap: 0.55 }}>
              <Chip size="small" label={statusMeta.label} sx={{ fontWeight: 800, bgcolor: statusMeta.bg, color: statusMeta.color }} />
              {priority?.value !== 'normal' && (
                <Chip
                  size="small"
                  label={priority.label}
                  sx={{ fontWeight: 800, bgcolor: alpha(priority.dotColor, 0.12), color: priority.dotColor }}
                />
              )}
              {isTransferReminder && (
                <Chip size="small" label={transferLabel} sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />
              )}
              {task?.is_overdue && (
                <Chip size="small" label="Просрочено" sx={{ fontWeight: 800, bgcolor: 'rgba(220,38,38,0.12)', color: '#dc2626' }} />
              )}
              {task?.has_unread_comments && (
                <Chip size="small" label="Новый комментарий" sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />
              )}
              {Number(task?.comments_count || 0) > 0 && (
                <Chip size="small" label={`Комментарии: ${task.comments_count}`} sx={{ fontWeight: 700 }} />
              )}
              {Number(task?.attachments_count || 0) > 0 && (
                <Chip size="small" label={`Файлы: ${task.attachments_count}`} sx={{ fontWeight: 700 }} />
              )}
            </Stack>

            <Box sx={{ p: 1.2, borderRadius: '14px', border: '1px solid', borderColor: alpha('#2563eb', 0.14), bgcolor: isTransferReminder ? 'rgba(37,99,235,0.06)' : ui.panelSolid }}>
              <Typography sx={{ fontWeight: 800, mb: 0.35, color: isTransferReminder ? '#2563eb' : 'text.primary' }}>
                Что делать сейчас
              </Typography>
              <Typography variant="body2" sx={{ color: ui.mutedText, mb: canOpenTransferActUpload ? 0.9 : 0 }}>
                {nextStepText}
              </Typography>
              {canOpenTransferActUpload && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => onOpenTransferActReminder(task)}
                  sx={{ alignSelf: 'flex-start', textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none' }}
                >
                  Загрузить подписанный акт
                </Button>
              )}
            </Box>

            <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
              <Typography sx={{ fontWeight: 800, mb: 0.75 }}>Контекст</Typography>
              <Grid container spacing={1}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Исполнитель</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{task?.assignee_full_name || task?.assignee_username || '-'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Контролёр</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{task?.controller_full_name || task?.controller_username || '-'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Срок</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{task?.due_at ? formatDateTime(task.due_at) : 'Без срока'}</Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" sx={{ color: ui.subtleText }}>Обновлено</Typography>
                  <Typography sx={{ fontWeight: 700 }}>{formatDateTime(task?.updated_at || task?.created_at)}</Typography>
                </Grid>
              </Grid>
            </Box>

            {descriptionPreview && (
              <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
                <Typography sx={{ fontWeight: 800, mb: 0.45 }}>Описание</Typography>
                <MarkdownRenderer value={descriptionPreview} />
              </Box>
            )}

            {task?.latest_report && (
              <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Box>
                    <Typography sx={{ fontWeight: 800 }}>Последний отчёт</Typography>
                    <Typography variant="caption" sx={{ color: ui.subtleText }}>
                      {formatDateTime(task.latest_report.uploaded_at)} · {task.latest_report.uploaded_by_username || '-'}
                    </Typography>
                  </Box>
                  {task.latest_report.file_name && (
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<DownloadIcon />}
                      onClick={() => onDownloadReport(task.latest_report)}
                      sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
                    >
                      Скачать
                    </Button>
                  )}
                </Stack>
                {latestReportComment && (
                  <Box sx={{ mt: 0.7 }}>
                    <MarkdownRenderer value={latestReportComment} />
                  </Box>
                )}
              </Box>
            )}

            {latestCommentPreview && (
              <Box sx={{ p: 1.15, borderRadius: '14px', border: '1px solid', borderColor: ui.borderSoft, bgcolor: ui.panelSolid }}>
                <Stack direction="row" spacing={0.8} alignItems="flex-start">
                  <Avatar sx={{ width: 28, height: 28, bgcolor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.primary.main }}>
                    <ModeCommentOutlinedIcon sx={{ fontSize: 16 }} />
                  </Avatar>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800, mb: 0.25 }}>Последний комментарий</Typography>
                    <Typography variant="body2" sx={{ color: ui.mutedText, ...clampTextSx(4) }}>
                      {latestCommentPreview}
                    </Typography>
                  </Box>
                </Stack>
              </Box>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: ui.mutedText }}>
            Карточка задачи недоступна.
          </Typography>
        )}
      </Box>
    </Drawer>
  );
}
