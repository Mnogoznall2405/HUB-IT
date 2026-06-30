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
  getTaskUserLabel,
  getChecklistStats,
  getTaskViewCount,
  getTaskLikeCount,
  formatMobileDueText,
  TaskMobilePersonRow,
  TaskMobileRailButton,
} from './taskDetailShared';

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
    { label: 'Наблюдатели', value: formatTaskObserversSummary(task) || '-' },
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
