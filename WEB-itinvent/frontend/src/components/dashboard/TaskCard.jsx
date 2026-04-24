import React from 'react';
import {
  Avatar,
  Box,
  Card,
  CardContent,
  CardActions,
  Chip,
  IconButton,
  Stack,
  Typography,
  Tooltip,
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ModeCommentOutlinedIcon from '@mui/icons-material/ModeCommentOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import TaskAltIcon from '@mui/icons-material/TaskAlt';

const taskStatusMeta = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'new') return { label: 'Новое', color: '#2563eb', bg: 'rgba(37,99,235,0.14)' };
  if (value === 'in_progress') return { label: 'В работе', color: '#d97706', bg: 'rgba(217,119,6,0.16)' };
  if (value === 'review') return { label: 'На проверке', color: '#7c3aed', bg: 'rgba(124,58,237,0.14)' };
  if (value === 'done') return { label: 'Готово', color: '#059669', bg: 'rgba(5,150,105,0.14)' };
  return { label: value || '-', color: '#64748b', bg: 'rgba(100,116,139,0.12)' };
};

const taskPriorityMeta = (priority) => {
  const value = String(priority || '').toLowerCase();
  if (value === 'urgent') return { value: 'urgent', label: 'Срочный', dotColor: '#dc2626' };
  if (value === 'high') return { value: 'high', label: 'Высокий', dotColor: '#d97706' };
  if (value === 'low') return { value: 'low', label: 'Низкий', dotColor: '#64748b' };
  return { value: 'normal', label: 'Обычный', dotColor: '#2563eb' };
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

const TaskCard = React.memo(({
  task,
  onClick,
  ui,
  isMobile,
}) => {
  const statusMeta = taskStatusMeta(task?.status);
  const priorityMeta = taskPriorityMeta(task?.priority);
  const isOverdue = task?.is_overdue;
  const hasUnreadComments = task?.has_unread_comments;
  const commentPreview = task?.latest_comment_preview;
  const commentAuthor = task?.latest_comment_full_name || task?.latest_comment_username;

  const handleClick = React.useCallback(() => {
    if (onClick) {
      onClick(task);
    }
  }, [onClick, task]);

  return (
    <Card
      onClick={handleClick}
      sx={{
        ...ui.cardSoft,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease-in-out',
        borderLeft: isOverdue
          ? `4px solid #dc2626`
          : hasUnreadComments
          ? `4px solid #059669`
          : '1px solid transparent',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: ui.shadowMedium,
        },
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {/* Status Badge */}
      <Box
        sx={{
          position: 'absolute',
          top: -8,
          right: 8,
          zIndex: 1,
        }}
      >
        <Chip
          label={statusMeta.label}
          size="small"
          sx={{
            backgroundColor: statusMeta.bg,
            color: statusMeta.color,
            fontWeight: 600,
            fontSize: '0.7rem',
            height: 24,
          }}
        />
      </Box>

      <CardContent sx={{ p: isMobile ? 1.5 : 2, '&:last-child': { pb: isMobile ? 1 : 1.5 } }}>
        <Stack spacing={1.5}>
          {/* Title and Priority */}
          <Stack spacing={0.5}>
            <Typography
              variant={isMobile ? 'subtitle1' : 'h6'}
              sx={{
                fontWeight: 600,
                lineHeight: 1.3,
                pr: 8, // Space for status badge
              }}
            >
              {task?.title}
            </Typography>

            {/* Priority Indicator */}
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: priorityMeta.dotColor,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {priorityMeta.label}
              </Typography>
            </Stack>
          </Stack>

          {/* Assignee and Date */}
          <Stack direction="row" spacing={1} alignItems="center">
            <Avatar
              sx={{
                width: 28,
                height: 28,
                fontSize: '0.75rem',
                bgcolor: ui.accentMuted,
                color: ui.accentFg,
              }}
            >
              {task?.assignee_initials || '?'}
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              {task?.assignee_full_name || 'Не назначено'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ·
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {fmtDateTime(task?.updated_at || task?.created_at)}
            </Typography>
          </Stack>

          {/* Overdue Warning */}
          {isOverdue && task?.due_date && (
            <Stack
              direction="row"
              spacing={0.5}
              alignItems="center"
              sx={{
                backgroundColor: 'rgba(220,38,38,0.08)',
                borderRadius: 1,
                p: 0.75,
              }}
            >
              <WarningAmberIcon sx={{ fontSize: 16, color: '#dc2626' }} />
              <Typography variant="caption" sx={{ color: '#dc2626', fontWeight: 600 }}>
                Просрочено: {fmtDateTime(task.due_date)}
              </Typography>
            </Stack>
          )}

          {/* Comment Preview */}
          {hasUnreadComments && commentPreview && (
            <Stack
              spacing={0.5}
              sx={{
                backgroundColor: 'rgba(5,150,105,0.08)',
                borderRadius: 1,
                p: 1,
              }}
            >
              <Stack direction="row" spacing={0.5} alignItems="center">
                <ModeCommentOutlinedIcon sx={{ fontSize: 14, color: '#059669' }} />
                {commentAuthor && (
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#059669' }}>
                    {commentAuthor}:
                  </Typography>
                )}
              </Stack>
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {commentPreview}
              </Typography>
            </Stack>
          )}
        </Stack>
      </CardContent>

      {/* Actions */}
      <CardActions
        sx={{
          px: isMobile ? 1.5 : 2,
          py: isMobile ? 0.75 : 1,
          justifyContent: 'space-between',
          borderTop: `1px solid ${ui.borderSoft}`,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          {/* Unread Comments Count */}
          {hasUnreadComments && Number(task?.unread_comments_count || 0) > 0 && (
            <Tooltip title={`${task.unread_comments_count} непрочитанных комментариев`}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <ModeCommentOutlinedIcon sx={{ fontSize: 16, color: '#059669' }} />
                <Typography variant="caption" sx={{ color: '#059669', fontWeight: 600 }}>
                  {task.unread_comments_count}
                </Typography>
              </Stack>
            </Tooltip>
          )}

          {/* Overdue Indicator */}
          {isOverdue && (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <AccessTimeIcon sx={{ fontSize: 16, color: '#dc2626' }} />
              <Typography variant="caption" sx={{ color: '#dc2626', fontWeight: 600 }}>
                Просрочено
              </Typography>
            </Stack>
          )}
        </Stack>

        {/* View Details Button */}
        {onClick && (
          <Tooltip title="Открыть детали">
            <IconButton
              size="small"
              sx={{
                color: ui.accentFg,
                '&:hover': {
                  backgroundColor: ui.accentBg,
                },
              }}
            >
              <VisibilityIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </CardActions>
    </Card>
  );
});

TaskCard.displayName = 'TaskCard';

export default TaskCard;
