import { memo } from 'react';
import {
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import FlagIcon from '@mui/icons-material/Flag';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

import OverflowMenu from '../../common/OverflowMenu';
import {
  canOpenTransferActUpload,
  getTransferActReminderLabel,
  isTransferActUploadTask,
} from '../../../lib/hubTaskIntegrations';
import { buildMobileTaskCardMenuItems } from '../../../pages/tasks/taskCardModel';
import {
  formatShortDate,
  getInitials,
  getTaskCommentPreview,
  priorityMeta,
  statusMeta,
} from '../../../pages/tasks/taskFormatters';

const TaskCard = memo(function TaskCard({
  task,
  column,
  isMobile = false,
  ui,
  canEdit = false,
  canDelete = false,
  onOpen,
  onEdit,
  onDelete,
  onCopyLink,
  onOpenTransferAct,
}) {
  const theme = useTheme();
  const latestComment = getTaskCommentPreview(task);
  const attachCount = Number(task?.attachments_count || 0);
  const isTransferReminder = isTransferActUploadTask(task);
  const priority = priorityMeta(task?.priority);
  const descriptionPreview = String(task?.description || '').trim();
  const mobileCardMenuItems = buildMobileTaskCardMenuItems({ canEdit, canDelete });
  const columnColor = column?.color || theme.palette.primary.main;
  const canOpenTransferAct = canOpenTransferActUpload(task);

  if (isMobile) {
    return (
      <Card
        data-testid={`mobile-task-card-${task.id}`}
        onClick={() => onOpen?.(task)}
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
                    onEdit?.(task);
                    return;
                  }
                  if (key === 'delete') {
                    onDelete?.(task);
                    return;
                  }
                  if (key === 'copy') {
                    onCopyLink?.(task);
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
      className="task-card"
      onClick={() => onOpen?.(task)}
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
                onOpen?.(task);
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
                  onEdit?.(task);
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
                onCopyLink?.(task);
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
        {priority.value !== 'normal' && (
          <Chip
            size="small"
            icon={<FlagIcon sx={{ fontSize: '11px !important', color: `${priority.dotColor} !important` }} />}
            label={priority.label}
            sx={{
              height: 19,
              fontSize: '0.62rem',
              fontWeight: 700,
              bgcolor: alpha(priority.dotColor, 0.12),
              color: priority.dotColor,
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
          {canOpenTransferAct && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<OpenInNewIcon />}
              onClick={(event) => {
                event.stopPropagation();
                onOpenTransferAct?.(task);
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
          <Avatar sx={{ width: 22, height: 22, fontSize: '0.62rem', bgcolor: alpha(columnColor, theme.palette.mode === 'dark' ? 0.18 : 0.10), color: columnColor }}>
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
});

export default TaskCard;
