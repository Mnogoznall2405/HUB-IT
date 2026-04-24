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
import AttachFileIcon from '@mui/icons-material/AttachFile';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import FlagIcon from '@mui/icons-material/Flag';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import NotificationsIcon from '@mui/icons-material/Notifications';

const announcementPriorityMeta = (priority) => {
  const value = String(priority || '').toLowerCase();
  if (value === 'high') return { label: 'Высокий', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
  if (value === 'low') return { label: 'Низкий', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
  return { label: 'Обычный', color: '#d97706', bg: 'rgba(217,119,6,0.14)' };
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

const AnnouncementCard = React.memo(({
  item,
  onClick,
  onAcknowledge,
  ui,
  isMobile,
}) => {
  const priorityMeta = announcementPriorityMeta(item?.priority);
  const hasAttachments = Number(item?.attachments_count || 0) > 0;
  const isPinned = item?.is_pinned_active;
  const isUnread = item?.is_unread;
  const isAckPending = item?.is_ack_pending;

  const handleAcknowledge = React.useCallback((e) => {
    e.stopPropagation();
    if (onAcknowledge) {
      onAcknowledge(item?.id);
    }
  }, [onAcknowledge, item?.id]);

  return (
    <Card
      onClick={() => onClick && onClick(item)}
      sx={{
        ...ui.cardSoft,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease-in-out',
        borderLeft: isUnread ? `4px solid ${priorityMeta.color}` : '1px solid transparent',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: ui.shadowMedium,
        },
        position: 'relative',
        overflow: 'visible',
      }}
    >
      {/* Priority Badge */}
      <Box
        sx={{
          position: 'absolute',
          top: -8,
          right: 8,
          zIndex: 1,
        }}
      >
        <Chip
          icon={<FlagIcon sx={{ fontSize: 14 }} />}
          label={priorityMeta.label}
          size="small"
          sx={{
            backgroundColor: priorityMeta.bg,
            color: priorityMeta.color,
            fontWeight: 600,
            fontSize: '0.7rem',
            height: 24,
          }}
        />
      </Box>

      {/* Pinned Indicator */}
      {isPinned && (
        <Box
          sx={{
            position: 'absolute',
            top: -8,
            left: 8,
            zIndex: 1,
          }}
        >
          <PushPinOutlinedIcon
            sx={{
              fontSize: 16,
              color: '#2563eb',
              transform: 'rotate(45deg)',
            }}
          />
        </Box>
      )}

      <CardContent sx={{ p: isMobile ? 1.5 : 2, '&:last-child': { pb: isMobile ? 1 : 1.5 } }}>
        <Stack spacing={1.5}>
          {/* Title and Meta */}
          <Stack spacing={0.5}>
            <Typography
              variant={isMobile ? 'subtitle1' : 'h6'}
              sx={{
                fontWeight: isUnread ? 700 : 500,
                lineHeight: 1.3,
                pr: 8, // Space for priority badge
              }}
            >
              {item?.title}
            </Typography>

            {item?.preview && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  lineHeight: 1.5,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {item?.preview}
              </Typography>
            )}
          </Stack>

          {/* Author and Date */}
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
              {item?.author_initials || '?'}
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              {item?.author_full_name || 'Неизвестный автор'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ·
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {fmtDateTime(item?.created_at)}
            </Typography>
          </Stack>

          {/* Recipients Summary */}
          {item?.recipients_summary && (
            <Typography
              variant="caption"
              sx={{
                color: ui.mutedFg,
                fontStyle: 'italic',
              }}
            >
              {item.recipients_summary}
            </Typography>
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
          {/* Attachment Count */}
          {hasAttachments && (
            <Tooltip title={`${item.attachments_count} вложение(й)`}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <AttachFileIcon sx={{ fontSize: 16, color: ui.mutedFg }} />
                <Typography variant="caption" color="text.secondary">
                  {item.attachments_count}
                </Typography>
              </Stack>
            </Tooltip>
          )}

          {/* Unread Indicator */}
          {isUnread && (
            <Chip
              icon={<NotificationsIcon sx={{ fontSize: 14 }} />}
              label="Новое"
              size="small"
              sx={{
                backgroundColor: 'rgba(37,99,235,0.1)',
                color: '#2563eb',
                fontWeight: 600,
                fontSize: '0.7rem',
                height: 24,
              }}
            />
          )}
        </Stack>

        <Stack direction="row" spacing={0.5}>
          {/* Acknowledge Button */}
          {isAckPending && onAcknowledge && (
            <Tooltip title="Подтвердить ознакомление">
              <IconButton
                size="small"
                onClick={handleAcknowledge}
                sx={{
                  color: '#16a34a',
                  '&:hover': {
                    backgroundColor: 'rgba(22,163,74,0.1)',
                  },
                }}
              >
                <CheckCircleOutlineIcon sx={{ fontSize: 20 }} />
              </IconButton>
            </Tooltip>
          )}

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
        </Stack>
      </CardActions>
    </Card>
  );
});

AnnouncementCard.displayName = 'AnnouncementCard';

export default AnnouncementCard;
