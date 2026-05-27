import React from 'react';
import {
  Box,
  Chip,
  IconButton,
  Paper,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import CloseIcon from '@mui/icons-material/Close';
import HistoryIcon from '@mui/icons-material/History';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const RECENT_TITLE = 'Последние карточки';
const CLEAR_LABEL = 'Очистить последние карточки';
const OPEN_LABEL = 'Открыть карточку';
const REMOVE_LABEL = 'Убрать из последних';
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
  maxWidth: 150,
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
  theme,
  onOpen,
  onRemove,
  onClear,
}) {
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
        mb: 1.5,
        p: { xs: 1.25, sm: 1.5 },
        borderColor,
        bgcolor: surfaceColor,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
        <HistoryIcon fontSize="small" sx={{ color: primaryMain }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 800, flex: 1 }}>
          {RECENT_TITLE}
        </Typography>
        {items.length > 0 && (
          <Tooltip title={CLEAR_LABEL}>
            <IconButton size="small" aria-label={CLEAR_LABEL} onClick={onClear}>
              <ClearAllIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridAutoFlow: { xs: 'column', md: 'row' },
          gridAutoColumns: { xs: 'minmax(240px, 78vw)', sm: 'minmax(260px, 360px)' },
          gridTemplateColumns: { md: 'repeat(auto-fit, minmax(260px, 1fr))' },
          gap: 1,
          overflowX: { xs: 'auto', md: 'visible' },
          pb: { xs: 0.25, md: 0 },
        }}
      >
        {items.map((item) => {
          const snapshot = getSnapshot(item);
          const invNo = getInvNo(item) || readFirst(snapshot, ['inv_no', 'INV_NO']);
          const title = readFirst(snapshot, ['MODEL_NAME', 'model_name', 'model', 'TYPE_NAME', 'type_name'], `INV ${invNo}`);
          const employee = readFirst(snapshot, ['OWNER_DISPLAY_NAME', 'OWNER_FULLNAME', 'employee_name', 'employee']);
          const branch = readFirst(snapshot, ['BRANCH_NAME', 'branch_name', 'branch']);
          const location = readFirst(snapshot, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location', 'PLACE']);
          const status = readFirst(snapshot, ['STATUS_NAME', 'status_name', 'STATUS_DESCR', 'status']);
          const actionLabel = readFirst(item, ['last_action_label'], readFirst(item, ['last_action']));
          const timeLabel = formatRecentTime(item?.last_activity_at);

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
                p: 1.25,
                borderRadius: 1,
                border: '1px solid',
                borderColor: alpha(primaryMain, 0.14),
                bgcolor: palette.background?.paper || '#fff',
                cursor: 'pointer',
                display: 'grid',
                gap: 0.75,
                transition: 'border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease',
                '&:hover': {
                  borderColor: alpha(primaryMain, 0.34),
                  boxShadow: `0 8px 22px ${alpha(primaryMain, 0.12)}`,
                  transform: 'translateY(-1px)',
                },
                '&:focus-visible': {
                  outline: `2px solid ${alpha(primaryMain, 0.5)}`,
                  outlineOffset: 2,
                },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap title={title}>
                    {title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    INV {invNo || '-'}
                  </Typography>
                </Box>
                <Tooltip title={OPEN_LABEL}>
                  <OpenInNewIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.25 }} />
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
                    sx={{ mt: -0.5, mr: -0.5 }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>

              <Typography variant="caption" color="text.secondary" noWrap title={employee || undefined}>
                {employee || '-'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap title={[branch, location].filter(Boolean).join(' / ') || undefined}>
                {[branch, location].filter(Boolean).join(' / ') || '-'}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                {status && <Chip size="small" label={status} sx={chipOverflowSx} />}
                <Chip size="small" color="primary" variant="outlined" label={actionLabel || '-'} sx={chipOverflowSx} />
                {timeLabel && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ ml: 'auto' }}>
                    {timeLabel}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

export default DatabaseRecentCards;
