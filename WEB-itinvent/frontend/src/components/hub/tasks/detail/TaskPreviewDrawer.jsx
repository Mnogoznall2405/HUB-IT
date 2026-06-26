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
  renderObserverBlock,
  getTaskUserLabel,
  getChecklistStats,
  getTaskViewCount,
  getTaskLikeCount,
  formatMobileDueText,
  TaskMobilePersonRow,
  TaskMobileRailButton,
} from './taskDetailShared';

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
        <Chip size="small" label={getTaskUnreadBadgeLabel(taskDiscussionEnabled)} sx={{ fontWeight: 800, bgcolor: 'rgba(37,99,235,0.12)', color: '#2563eb' }} />
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
