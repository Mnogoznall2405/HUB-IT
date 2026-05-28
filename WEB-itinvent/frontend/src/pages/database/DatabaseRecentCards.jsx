import React, { useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  IconButton,
  Paper,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HistoryIcon from '@mui/icons-material/History';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const RECENT_TITLE = 'Последние карточки';
const CLEAR_LABEL = 'Очистить последние карточки';
const OPEN_LABEL = 'Открыть карточку';
const REMOVE_LABEL = 'Убрать из последних';
const COLLAPSE_LABEL = 'Скрыть последние карточки';
const EXPAND_LABEL = 'Показать последние карточки';
const JUST_NOW_LABEL = 'только что';

const readFirst = (item, keys, fallback = '') => {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return fallback;
};

const getSnapshot = (item) => (item?.snapshot && typeof item.snapshot === 'object' ? item.snapshot : {});

const getInvNo = (item) => readFirst(item, ['inv_no', 'INV_NO']);

const chipOverflowSx = {
  maxWidth: { xs: 128, sm: 150 },
  '& .MuiChip-label': {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};

const formatRecentTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return JUST_NOW_LABEL;
  if (diffMinutes < 60) return `${diffMinutes} мин назад`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} ч назад`;

  return date.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function DatabaseRecentCards({
  items = [],
  loading = false,
  theme,
  onOpen,
  onRemove,
  onClear,
}) {
  const [collapsed, setCollapsed] = useState(true);

  if (!Array.isArray(items) || items.length === 0) return null;

  const palette = theme?.palette || {};
  const primaryMain = palette.primary?.main || '#2563eb';
  const borderColor = alpha(primaryMain, 0.16);
  const surfaceColor = alpha(primaryMain, 0.035);

  return (
    <Paper
      variant="outlined"
      data-testid="database-recent-cards"
      sx={{
        mb: 1.25,
        p: { xs: 0.75, sm: 1 },
        borderColor,
        bgcolor: surfaceColor,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <HistoryIcon fontSize="small" sx={{ color: primaryMain }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }} noWrap>
          {RECENT_TITLE}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {loading ? 'Обновление...' : items.length}
        </Typography>
        <Tooltip title={collapsed ? EXPAND_LABEL : COLLAPSE_LABEL}>
          <IconButton
            size="small"
            aria-label={collapsed ? EXPAND_LABEL : COLLAPSE_LABEL}
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
        <Tooltip title={CLEAR_LABEL}>
          <IconButton size="small" aria-label={CLEAR_LABEL} onClick={onClear}>
            <ClearAllIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Collapse in={!collapsed} timeout="auto" unmountOnExit>
        <Box
          sx={{
            mt: 0.75,
            border: '1px solid',
            borderColor: alpha(primaryMain, 0.12),
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: palette.background?.paper || '#fff',
          }}
        >
          {items.map((item, index) => {
            const snapshot = getSnapshot(item);
            const invNo = getInvNo(item) || readFirst(snapshot, ['inv_no', 'INV_NO']);
            const title = readFirst(snapshot, ['MODEL_NAME', 'model_name', 'model', 'TYPE_NAME', 'type_name'], `INV ${invNo}`);
            const employee = readFirst(snapshot, ['OWNER_DISPLAY_NAME', 'OWNER_FULLNAME', 'employee_name', 'employee']);
            const branch = readFirst(snapshot, ['BRANCH_NAME', 'branch_name', 'branch']);
            const location = readFirst(snapshot, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location', 'PLACE']);
            const status = readFirst(snapshot, ['STATUS_NAME', 'status_name', 'STATUS_DESCR', 'status']);
            const actionLabel = readFirst(item, ['last_action_label'], readFirst(item, ['last_action']));
            const timeLabel = formatRecentTime(item?.last_activity_at);
            const placeLabel = [branch, location].filter(Boolean).join(' / ');
            const mobileMeta = [employee, placeLabel].filter(Boolean).join(' / ');

            return (
              <Box
                key={`${item?.db_id || ''}:${invNo}`}
                role="button"
                tabIndex={0}
                onClick={() => onOpen?.(item)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpen?.(item);
                  }
                }}
                sx={{
                  minWidth: 0,
                  px: { xs: 0.75, sm: 1 },
                  py: { xs: 0.75, sm: 0.85 },
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: 'minmax(0, 1fr) auto',
                    md: 'minmax(220px, 1.2fr) minmax(140px, 0.8fr) minmax(170px, 1fr) minmax(170px, auto) auto',
                  },
                  gap: { xs: 0.5, md: 1 },
                  alignItems: 'center',
                  borderTop: index === 0 ? 0 : '1px solid',
                  borderColor: alpha(primaryMain, 0.09),
                  cursor: 'pointer',
                  transition: 'background-color 120ms ease',
                  '&:hover': {
                    bgcolor: alpha(primaryMain, 0.055),
                  },
                  '&:focus-visible': {
                    outline: `2px solid ${alpha(primaryMain, 0.5)}`,
                    outlineOffset: -2,
                  },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 800, minWidth: 0 }} noWrap title={title}>
                      {title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                      INV {invNo || '-'}
                    </Typography>
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    title={mobileMeta || undefined}
                    sx={{ display: { xs: 'block', md: 'none' } }}
                  >
                    {mobileMeta || '-'}
                  </Typography>
                </Box>

                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  title={employee || undefined}
                  sx={{ display: { xs: 'none', md: 'block' }, minWidth: 0 }}
                >
                  {employee || '-'}
                </Typography>

                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  title={placeLabel || undefined}
                  sx={{ display: { xs: 'none', md: 'block' }, minWidth: 0 }}
                >
                  {placeLabel || '-'}
                </Typography>

                <Box
                  sx={{
                    gridColumn: { xs: '1 / -1', md: 'auto' },
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    minWidth: 0,
                  }}
                >
                  {status && <Chip size="small" label={status} sx={chipOverflowSx} />}
                  <Chip size="small" color="primary" variant="outlined" label={actionLabel || '-'} sx={chipOverflowSx} />
                  {timeLabel && (
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 'auto' }}>
                      {timeLabel}
                    </Typography>
                  )}
                </Box>

                <Box
                  sx={{
                    gridColumn: { xs: '2', md: 'auto' },
                    gridRow: { xs: '1', md: 'auto' },
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: 0.25,
                  }}
                >
                  <Tooltip title={OPEN_LABEL}>
                    <IconButton
                      size="small"
                      aria-label={`${OPEN_LABEL} ${invNo}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onOpen?.(item);
                      }}
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={REMOVE_LABEL}>
                    <IconButton
                      size="small"
                      aria-label={`${REMOVE_LABEL} ${invNo}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRemove?.(invNo);
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Collapse>
    </Paper>
  );
}

export default DatabaseRecentCards;
