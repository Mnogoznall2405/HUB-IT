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
  canReopenTask = false,
  reopening = false,
  canEditTask,
  canDeleteTask,
  onOpenTransferActReminder,
  onStartTask,
  onReopenTask,
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
      if (canReopenTask) {
        return {
          label: reopening ? 'Возврат...' : 'Вернуть в работу',
          variant: 'outlined',
          color: 'primary',
          onClick: () => onReopenTask(task),
          disabled: reopening,
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
          fontWeight: 850,
          borderRadius: mobileRail ? 999 : '10px',
          boxShadow: 'none',
          minHeight: mobileRail ? 40 : undefined,
          px: mobileRail ? 1.7 : undefined,
          fontSize: mobileRail ? '0.86rem' : undefined,
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
      {canReopenTask && (
        <Button
          fullWidth
          variant="outlined"
          onClick={() => onReopenTask(task)}
          disabled={reopening}
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '10px' }}
        >
          {reopening ? 'Возврат...' : 'Вернуть в работу'}
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
