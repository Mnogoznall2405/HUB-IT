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

export function TaskMobileChecklistScreen({
  task,
  canUpdate = false,
  onToggleItem,
  onAddItem,
  ui,
  theme,
}) {
  const [adding, setAdding] = useState(false);
  const [draftText, setDraftText] = useState('');
  const isDark = theme.palette.mode === 'dark';
  const checklist = getChecklistStats(task);
  const muted = isDark ? alpha('#fff', 0.56) : ui.subtleText;
  const dividerColor = isDark ? alpha('#fff', 0.12) : ui.borderSoft;
  const canSaveDraft = canUpdate && String(draftText || '').trim().length > 0;

  const saveDraft = () => {
    if (!canSaveDraft) return;
    onAddItem?.(draftText.trim());
    setDraftText('');
    setAdding(false);
  };

  return (
    <Stack
      data-testid="task-mobile-checklist-screen"
      sx={{
        minHeight: '100%',
        px: 2,
        pt: 1.95,
        pb: 3,
        color: ui.textPrimary,
      }}
    >
      <Typography sx={{ fontWeight: 900, fontSize: '1.45rem', lineHeight: 1.08, letterSpacing: '-0.035em' }}>
        Чек-лист
      </Typography>
      <Typography data-testid="task-mobile-checklist-progress" sx={{ color: muted, fontSize: '0.92rem', fontWeight: 800, mt: 0.75, mb: 2.45 }}>
        {`${checklist.done}/${checklist.total} выполнено`}
      </Typography>

      <Stack data-testid="task-mobile-checklist-items" spacing={0}>
        {checklist.items.map((item, index) => {
          const itemId = String(item?.id || '');
          return (
            <Stack
              key={itemId || `${item?.text || 'item'}-${index}`}
              direction="row"
              alignItems="center"
              spacing={1.35}
              sx={{
                minHeight: 56,
                borderBottom: index < checklist.items.length - 1 ? '1px solid' : 'none',
                borderColor: dividerColor,
              }}
            >
              <Checkbox
                checked={Boolean(item?.done)}
                disabled={!canUpdate}
                onChange={(event) => onToggleItem?.(itemId, event.target.checked)}
                inputProps={{ 'aria-label': `Отметить пункт ${index + 1}` }}
                sx={{
                  p: 1,
                  m: -1,
                  color: muted,
                  '& .MuiSvgIcon-root': { fontSize: 28 },
                }}
              />
              <Typography
                sx={{
                  fontSize: '0.98rem',
                  fontWeight: 800,
                  lineHeight: 1.18,
                  color: item?.done ? muted : ui.textPrimary,
                  textDecoration: item?.done ? 'line-through' : 'none',
                  overflowWrap: 'anywhere',
                }}
              >
                {item?.text || `Пункт ${index + 1}`}
              </Typography>
            </Stack>
          );
        })}
      </Stack>

      {adding ? (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveDraft();
              if (event.key === 'Escape') {
                setAdding(false);
                setDraftText('');
              }
            }}
            placeholder="Название пункта"
            inputProps={{ 'data-testid': 'task-mobile-checklist-new-input' }}
          />
          <Button
            variant="contained"
            disabled={!canSaveDraft}
            onClick={saveDraft}
            sx={{ minHeight: 40, textTransform: 'none', fontWeight: 850, borderRadius: 999 }}
          >
            Добавить
          </Button>
        </Stack>
      ) : (
        <Button
          data-testid="task-mobile-checklist-add"
          startIcon={<AddIcon />}
          disabled={!canUpdate}
          onClick={() => setAdding(true)}
          sx={{
            alignSelf: 'flex-start',
            mt: 2.6,
            minHeight: 44,
            px: 0,
            color: muted,
            textTransform: 'none',
            fontWeight: 800,
            fontSize: '0.98rem',
          }}
        >
          Добавить пункт
        </Button>
      )}
    </Stack>
  );
}
