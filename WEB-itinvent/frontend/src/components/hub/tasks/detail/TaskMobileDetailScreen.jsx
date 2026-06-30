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
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import FlagIcon from '@mui/icons-material/Flag';
import LocalFireDepartmentOutlinedIcon from '@mui/icons-material/LocalFireDepartmentOutlined';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ThumbUpOffAltIcon from '@mui/icons-material/ThumbUpOffAlt';
import MarkdownRenderer from '../../MarkdownRenderer';
import OverflowMenu from '../../../common/OverflowMenu';
import {
  TASK_DETAIL_TABS,
  getDefaultTaskDetailTab,
  getTaskCommentsTabLabel,
  getTaskUnreadBadgeLabel,
  normalizeTaskDetailTab,
} from '../../../../lib/taskNavigation';

export {
  TASK_DETAIL_TABS,
  getDefaultTaskDetailTab,
  normalizeTaskDetailTab,
} from '../../../../lib/taskNavigation';
import {
  clampTextSx,
  renderKvRows,
  formatTaskObserversSummary,
  renderObserverBlock,
  getTaskUserLabel,
  getChecklistStats,
  getTaskViewCount,
  getTaskLikeCount,
  formatMobileDueText,
  TaskMobilePersonRow,
  TaskMobileRailButton,
} from './taskDetailShared';

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
  const shouldShowFilesCard = fileItems.length > 0;
  const shouldShowChecklistCard = checklist.total > 0;
  const likeCount = getTaskLikeCount(task);
  const viewCount = getTaskViewCount(task);
  const dueText = formatMobileDueText(task?.due_at, formatDateTime);
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
      spacing={1.75}
      sx={{
        minHeight: '100%',
        px: 2,
        pt: 1.9,
        pb: taskDiscussionEnabled ? 11 : 3,
        color: ui.textPrimary,
      }}
    >
      <Box data-testid="task-mobile-content">
        <Typography sx={{ fontWeight: 900, fontSize: '1.45rem', lineHeight: 1.08, letterSpacing: '-0.035em', mb: 1.35, overflowWrap: 'anywhere' }}>
          {task?.title || 'Задача'}
        </Typography>
        {description ? (
          <Box data-testid="task-mobile-description" sx={{ color: muted, fontSize: '0.92rem', lineHeight: 1.3, mb: 1.85 }}>
            <MarkdownRenderer value={description} />
          </Box>
        ) : (
          <Typography data-testid="task-mobile-description" sx={{ color: muted, fontSize: '0.92rem', mb: 1.85 }}>
            Описание задачи не заполнено.
          </Typography>
        )}

        <Stack spacing={0.75}>
          <TaskMobilePersonRow label="Постановщик" name={getTaskUserLabel(task, 'created_by')} ui={ui} theme={theme} />
          <TaskMobilePersonRow label="Исполнитель" name={getTaskUserLabel(task, 'assignee')} ui={ui} theme={theme} />
          {getTaskUserLabel(task, 'controller') !== '-' ? (
            <TaskMobilePersonRow label="Контролёр" name={getTaskUserLabel(task, 'controller')} ui={ui} theme={theme} />
          ) : null}
          {formatTaskObserversSummary(task) ? (
            <TaskMobilePersonRow label="Наблюдатели" name={formatTaskObserversSummary(task)} ui={ui} theme={theme} />
          ) : null}
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.25} sx={{ mt: 1.65, minHeight: 42 }}>
          <Stack direction="row" spacing={1.05} alignItems="center" sx={{ minWidth: 0, color: task?.is_overdue ? theme.palette.error.main : ui.textPrimary }}>
            <CalendarMonthOutlinedIcon sx={{ fontSize: 27, flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.96rem', fontWeight: 800, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
              {dueText}
            </Typography>
          </Stack>
          {task?.is_overdue ? (
            <Box
              data-testid="task-mobile-overdue-pill"
              sx={{
                flexShrink: 0,
                px: 1.2,
                py: 0.55,
                borderRadius: 999,
                color: theme.palette.error.light,
                bgcolor: alpha(theme.palette.error.main, isDark ? 0.22 : 0.12),
                fontWeight: 850,
                fontSize: '0.8rem',
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
          gap: 0.85,
          alignItems: 'center',
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {actions ? <Box sx={{ flex: '0 0 auto', '& .MuiButton-root': { minHeight: 40 } }}>{actions}</Box> : null}
        <TaskMobileRailButton
          testId="task-mobile-files-chip"
          icon={<AttachFileIcon sx={{ fontSize: 22 }} />}
          disabled={fileItems.length === 0}
          onClick={() => {
            if (typeof document !== 'undefined') {
              document.querySelector('[data-testid="task-mobile-files"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }}
          ui={ui}
          theme={theme}
        >
          {`Файлы: ${fileItems.length}`}
        </TaskMobileRailButton>
        <TaskMobileRailButton
          testId="task-mobile-checklist-chip"
          icon={<ChecklistOutlinedIcon sx={{ fontSize: 22 }} />}
          onClick={onOpenChecklist}
          ui={ui}
          theme={theme}
        >
          Чек-лист
        </TaskMobileRailButton>
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

      {shouldShowFilesCard ? (
        <Box data-testid="task-mobile-files" sx={{ ...cardSx, p: 2 }}>
          <Typography sx={{ color: muted, fontSize: '0.82rem', fontWeight: 800, mb: 1 }}>
            {`Файлы: ${fileItems.length}`}
          </Typography>
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
                  width: 84,
                  flex: '0 0 auto',
                  p: 1,
                  borderRadius: '14px',
                  border: '1px solid',
                  borderColor: ui.borderSoft,
                  bgcolor: isDark ? '#151515' : ui.actionBg,
                  cursor: 'pointer',
                }}
              >
                <Avatar sx={{ width: 42, height: 42, mx: 'auto', mb: 0.75, bgcolor: isDark ? '#eef2f7' : alpha(theme.palette.primary.main, 0.12), color: isDark ? '#111827' : theme.palette.primary.main }}>
                  <AttachFileIcon />
                </Avatar>
                <Typography sx={{ color: muted, fontSize: '0.72rem', fontWeight: 800, textAlign: 'center', lineHeight: 1.15 }} noWrap>
                  {file.file_name}
                </Typography>
                <Typography sx={{ color: muted, fontSize: '0.64rem', textAlign: 'center', mt: 0.3 }} noWrap>
                  {file.type === 'report' ? 'Отчёт' : formatFileSize?.(file.file_size)}
                </Typography>
              </Box>
            ))}
          </Stack>
          {canUploadFiles ? (
            <Button
              component="label"
              startIcon={<AddIcon />}
              disabled={uploadingAttachment}
              sx={{
                mt: 1.2,
                minHeight: 44,
                px: 0,
                color: muted,
                textTransform: 'none',
                fontWeight: 800,
                fontSize: '0.94rem',
                justifyContent: 'flex-start',
              }}
            >
              {uploadingAttachment ? 'Загрузка...' : 'Добавить файлы'}
              <input type="file" hidden onChange={handleUploadChange} />
            </Button>
          ) : null}
        </Box>
      ) : null}

      {shouldShowChecklistCard ? (
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
          sx={{
            ...cardSx,
            position: 'relative',
            minHeight: 126,
            p: 2,
            pb: 2.2,
            cursor: 'pointer',
            overflow: 'hidden',
          }}
        >
          <Typography sx={{ color: muted, fontSize: '0.82rem', fontWeight: 800, mb: 1.15 }}>
            {`Чек-листы: ${checklist.total}`}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1.1} sx={{ minHeight: 50 }}>
            <ChecklistOutlinedIcon sx={{ color: theme.palette.primary.main, fontSize: 24 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ fontSize: '0.94rem', fontWeight: 800 }}>Чек-лист</Typography>
              <Typography sx={{ color: muted, fontSize: '0.84rem', fontWeight: 700, mt: 0.22 }}>
                {`${checklist.done}/${checklist.total} выполнено`}
              </Typography>
            </Box>
            <ExpandMoreIcon sx={{ transform: 'rotate(-90deg)', color: muted, flexShrink: 0 }} />
          </Stack>
        </Box>
      ) : null}
      {taskDiscussionEnabled ? (
        <Box
          data-testid="task-mobile-chat-floating"
          sx={{
            position: 'fixed',
            left: '50%',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
            zIndex: theme.zIndex.drawer + 2,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}
        >
          <Button
            data-testid="task-mobile-open-chat"
            variant="contained"
            startIcon={<ForumOutlinedIcon sx={{ fontSize: 20 }} />}
            disabled={discussionOpening}
            onClick={() => onOpenTaskDiscussion?.()}
            sx={{
              minHeight: 42,
              px: 1.7,
              borderRadius: 3,
              textTransform: 'none',
              fontWeight: 850,
              fontSize: '0.95rem',
              boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.42)' : '0 12px 28px rgba(37,99,235,0.26)',
              whiteSpace: 'nowrap',
              pointerEvents: 'auto',
            }}
          >
            {discussionOpening ? 'Открываем...' : 'Чат задачи'}
          </Button>
        </Box>
      ) : null}
    </Stack>
  );
}
