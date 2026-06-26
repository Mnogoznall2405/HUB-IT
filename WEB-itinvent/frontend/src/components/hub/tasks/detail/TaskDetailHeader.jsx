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
  taskDiscussionEnabled = false,
  onOpenTaskDiscussion,
  discussionOpening = false,
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
      {task?.is_observer && (
        <Chip
          size="small"
          icon={<VisibilityOutlinedIcon sx={{ fontSize: '12px !important' }} />}
          label="Наблюдатель"
          sx={{ fontWeight: 800, bgcolor: 'rgba(0,121,107,0.12)', color: '#00796b' }}
        />
      )}
      {task?.has_unread_comments && (
        <Chip
          size="small"
          label={getTaskUnreadBadgeLabel(taskDiscussionEnabled)}
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
    const showMobileHeatIcon = priority?.value !== 'normal' || Boolean(task?.is_overdue);
    return (
      <Box
        data-testid="task-detail-mobile-header"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 2,
          px: 1.5,
          py: 0.55,
          borderBottom: '1px solid',
          borderColor: theme.palette.mode === 'dark' ? alpha('#fff', 0.08) : ui.borderSoft,
          bgcolor: alpha(ui.pageBg, 0.98),
          backdropFilter: 'blur(10px)',
        }}
      >
        <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between" sx={{ position: 'relative', minHeight: 52 }}>
          <IconButton
            aria-label="Назад"
            onClick={onBack}
            sx={{
              width: 44,
              height: 44,
              color: ui.textPrimary,
            }}
          >
            <ArrowBackIcon sx={{ fontSize: 31 }} />
          </IconButton>
          <Typography
            data-testid="task-detail-mobile-title"
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              maxWidth: '52%',
              color: ui.mutedText,
              fontWeight: 850,
              fontSize: '1rem',
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
          <Stack direction="row" spacing={0.35} alignItems="center" justifyContent="flex-end" sx={{ minWidth: 88 }}>
            {showMobileHeatIcon ? (
              <LocalFireDepartmentOutlinedIcon
                data-testid="task-detail-mobile-heat"
                sx={{ fontSize: 31, color: '#f59e0b' }}
              />
            ) : null}
            {Array.isArray(actionMenuItems) && actionMenuItems.length > 0 ? (
              <Box data-testid="task-detail-mobile-actions">
                <OverflowMenu
                  label="Действия задачи"
                  size="medium"
                  items={actionMenuItems}
                  onSelect={onActionMenuSelect}
                />
              </Box>
            ) : <Box sx={{ width: 44, height: 44 }} />}
          </Stack>
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
          <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
            {taskDiscussionEnabled ? (
              <Button
                data-testid="task-detail-open-chat"
                variant="contained"
                startIcon={<ForumOutlinedIcon />}
                onClick={() => onOpenTaskDiscussion?.()}
                disabled={discussionOpening}
                sx={{ textTransform: 'none', fontWeight: 800, borderRadius: '10px', boxShadow: 'none', minHeight: 44 }}
              >
                {discussionOpening ? 'Открываем чат…' : 'Открыть чат'}
              </Button>
            ) : null}
            <Button
              variant="outlined"
              startIcon={<ContentCopyIcon />}
              onClick={onCopyLink}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px', minHeight: 44 }}
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
          {task?.is_observer && (
            <Chip
              size="small"
              icon={<VisibilityOutlinedIcon sx={{ fontSize: '12px !important' }} />}
              label="Наблюдатель"
              sx={{ fontWeight: 800, bgcolor: 'rgba(0,121,107,0.12)', color: '#00796b' }}
            />
          )}
          {task?.has_unread_comments && (
            <Chip
              size="small"
              label={getTaskUnreadBadgeLabel(taskDiscussionEnabled)}
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
