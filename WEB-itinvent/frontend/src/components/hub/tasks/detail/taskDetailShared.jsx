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


export const clampTextSx = (lines) => ({
  display: '-webkit-box',
  WebkitLineClamp: lines,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});

export const renderKvRows = (rows, ui) => (
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

export const renderObserverBlock = (task, ui, theme) => {
  const observers = Array.isArray(task?.observers) ? task.observers : [];
  if (!observers.length) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" sx={{ color: ui.subtleText }}>
        Наблюдатели
      </Typography>
      <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 0.45 }}>
        {observers.map((observer) => {
          const label = String(observer?.full_name || observer?.username || observer?.user_id || '').trim() || '-';
          return (
            <Chip
              key={String(observer?.user_id || label)}
              size="small"
              icon={<VisibilityOutlinedIcon sx={{ fontSize: '0.95rem !important' }} />}
              label={label}
              color="secondary"
              variant="outlined"
              sx={{
                fontWeight: 700,
                bgcolor: alpha(theme.palette.secondary.main, 0.06),
              }}
            />
          );
        })}
      </Stack>
    </Box>
  );
};

export const getTaskUserLabel = (task, prefix) => (
  task?.[`${prefix}_full_name`]
  || task?.[`${prefix}_username`]
  || '-'
);

const getInitialsFromName = (value) => {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
};

export const getChecklistStats = (task) => {
  const items = Array.isArray(task?.checklist_items) ? task.checklist_items : [];
  const total = Number(task?.checklist_total ?? items.length);
  const done = Number(task?.checklist_done ?? items.filter((item) => Boolean(item?.done)).length);
  return { items, done, total };
};

export const getTaskViewCount = (task) => {
  const candidates = [task?.views_count, task?.view_count, task?.watchers_count, task?.seen_count];
  const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) > 0);
  return value == null ? null : Number(value);
};

export const getTaskLikeCount = (task) => {
  const candidates = [task?.likes_count, task?.like_count, task?.reactions_count];
  const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) > 0);
  return value == null ? null : Number(value);
};

export const formatMobileDueText = (value, fallbackFormatter) => {
  if (!value) return 'Без срока';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallbackFormatter?.(value) || String(value);
  }
  const months = [
    'января',
    'февраля',
    'марта',
    'апреля',
    'мая',
    'июня',
    'июля',
    'августа',
    'сентября',
    'октября',
    'ноября',
    'декабря',
  ];
  const day = parsed.getDate();
  const month = months[parsed.getMonth()] || '';
  const yearPart = parsed.getFullYear() === new Date().getFullYear() ? '' : ` ${parsed.getFullYear()}`;
  const hours = String(parsed.getHours()).padStart(2, '0');
  const minutes = String(parsed.getMinutes()).padStart(2, '0');
  return `${day} ${month}${yearPart} в ${hours}:${minutes}`;
};

export function TaskMobilePersonRow({ label, name, ui, theme }) {
  const isDark = theme.palette.mode === 'dark';
  const resolvedName = name || '-';
  return (
    <Stack direction="row" spacing={1.2} alignItems="center" sx={{ minHeight: 52 }}>
      <Avatar
        sx={{
          width: 38,
          height: 38,
          bgcolor: isDark ? '#7bbd22' : alpha(theme.palette.success.main, 0.16),
          color: isDark ? '#fff' : theme.palette.success.dark,
          fontWeight: 900,
          fontSize: '1rem',
        }}
      >
        {getInitialsFromName(resolvedName)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ color: ui.subtleText, fontSize: '0.76rem', fontWeight: 750, lineHeight: 1.15 }}>
          {label}
        </Typography>
        <Typography sx={{ color: ui.textPrimary, fontSize: '0.9rem', fontWeight: 750, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
          {resolvedName}
        </Typography>
      </Box>
    </Stack>
  );
}

export function TaskMobileRailButton({
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
        minHeight: 40,
        borderRadius: 999,
        px: 1.45,
        textTransform: 'none',
        fontWeight: 850,
        fontSize: '0.86rem',
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
