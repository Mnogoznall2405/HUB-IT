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

export function TaskPrimaryActions({
  task,
  canOpenTransferActUpload,
  canStartTask,
  canSubmitTask,
  canReviewTask,
  canCloseTask = false,
  canReopenTask = false,
  reopening = false,
  closing = false,
  canEditTask,
  canDeleteTask,
  onOpenTransferActReminder,
  onStartTask,
  onReopenTask,
  onOpenSubmitTask,
  onOpenReviewTask,
  onOpenCloseTask,
  onOpenEditTask,
  onDeleteTask,
  onCopyLink,
  compactMobile = false,
  mobileRail = false,
}) {
  const showSecondaryActions = !compactMobile && (canEditTask || canDeleteTask || onCopyLink);
  const workflowButtons = [];

  if (canOpenTransferActUpload) {
    workflowButtons.push({
      key: 'upload_act',
      label: compactMobile ? 'Загрузить акт' : 'Загрузить подписанный акт',
      variant: 'contained',
      color: 'primary',
      onClick: () => onOpenTransferActReminder(task),
    });
  }
  if (canStartTask) {
    workflowButtons.push({
      key: 'start',
      label: compactMobile ? 'Начать' : 'В работу',
      variant: compactMobile ? 'outlined' : 'outlined',
      color: 'primary',
      onClick: () => onStartTask(task.id),
    });
  }
  if (canSubmitTask) {
    workflowButtons.push({
      key: 'submit',
      label: 'Отправить на проверку',
      variant: 'contained',
      color: 'primary',
      onClick: () => onOpenSubmitTask(task),
    });
  }
  if (canReviewTask) {
    workflowButtons.push({
      key: 'approve',
      label: 'Принять',
      variant: 'contained',
      color: 'success',
      onClick: () => onOpenReviewTask(task),
    });
    workflowButtons.push({
      key: 'reject',
      label: 'Вернуть на доработку',
      variant: 'outlined',
      color: 'warning',
      onClick: () => onOpenReviewTask(task),
    });
  }
  if (canCloseTask) {
    workflowButtons.push({
      key: 'close',
      label: closing ? 'Закрытие...' : 'Закрыть',
      variant: 'outlined',
      color: 'primary',
      onClick: () => onOpenCloseTask?.(task),
      disabled: closing,
    });
  }
  if (canReopenTask) {
    workflowButtons.push({
      key: 'reopen',
      label: reopening ? 'Возврат...' : 'Вернуть в работу',
      variant: 'outlined',
      color: 'primary',
      onClick: () => onReopenTask(task),
      disabled: reopening,
    });
  }

  if (compactMobile) {
    if (workflowButtons.length === 0) return null;

    return (
      <Stack direction="row" spacing={0.8} sx={{ flexWrap: 'nowrap' }}>
        {workflowButtons.map((action) => (
          <Button
            key={action.key}
            fullWidth={!mobileRail}
            variant={action.variant}
            color={action.color}
            onClick={action.onClick}
            disabled={action.disabled}
            sx={{
              textTransform: 'none',
              fontWeight: 850,
              borderRadius: mobileRail ? 999 : '10px',
              boxShadow: 'none',
              minHeight: mobileRail ? 40 : undefined,
              px: mobileRail ? 1.7 : undefined,
              fontSize: mobileRail ? '0.86rem' : undefined,
              whiteSpace: 'nowrap',
            }}
          >
            {action.label}
          </Button>
        ))}
      </Stack>
    );
  }

  return (
    <Stack spacing={0.8}>
      {workflowButtons.map((action) => (
        <Button
          key={action.key}
          fullWidth
          variant={action.variant}
          color={action.color}
          onClick={action.onClick}
          disabled={action.disabled}
          sx={{ textTransform: 'none', fontWeight: action.variant === 'contained' ? 800 : 700, borderRadius: '10px', boxShadow: 'none' }}
        >
          {action.label}
        </Button>
      ))}

      {showSecondaryActions && workflowButtons.length > 0 && <Divider />}

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
