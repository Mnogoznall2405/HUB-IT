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

const RECENT_TITLE = 'Последние акты';
const CLEAR_LABEL = 'Очистить последние акты';
const OPEN_LABEL = 'Открыть акт';
const REMOVE_LABEL = 'Убрать из последних';
const COLLAPSE_LABEL = 'Скрыть последние акты';
const EXPAND_LABEL = 'Показать последние акты';
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

const getDocNo = (item) => readFirst(item, ['doc_no', 'DOC_NO']);

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

function DatabaseRecentActs({
  items = [],
  loading = false,
  theme,
  formatDate = (value) => value,
  onOpen,
  onRemove,
  onClear,
  compact = false,
}) {
  const [collapsed, setCollapsed] = useState(true);

  if (!Array.isArray(items) || items.length === 0) return null;

  const palette = theme?.palette || {};
  const primaryMain = palette.primary?.main || '#2563eb';
  const borderColor = alpha(primaryMain, collapsed && compact ? 0.1 : 0.16);
  const surfaceColor = collapsed && compact
    ? 'transparent'
    : alpha(primaryMain, 0.035);
  const toggleCollapsed = () => setCollapsed((value) => !value);

  return (
    <Paper
      variant="outlined"
      data-testid="database-recent-acts"
      sx={{
        mb: compact ? 0 : 1.25,
        p: collapsed && compact ? 0.35 : { xs: 0.75, sm: 1 },
        borderColor: collapsed && compact ? 'transparent' : borderColor,
        bgcolor: surfaceColor,
        boxShadow: 'none',
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={collapsed ? EXPAND_LABEL : COLLAPSE_LABEL}
        onClick={toggleCollapsed}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleCollapsed();
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: compact ? 0.5 : 0.75,
          cursor: 'pointer',
          borderRadius: '4px',
          mx: collapsed && compact ? 0 : -0.25,
          px: collapsed && compact ? 0.5 : 0.25,
          py: collapsed && compact ? 0.15 : 0,
          minHeight: collapsed && compact ? 28 : undefined,
          '&:hover': { bgcolor: alpha(primaryMain, 0.06) },
          '&:focus-visible': {
            outline: `2px solid ${alpha(primaryMain, 0.45)}`,
            outlineOffset: 1,
          },
        }}
      >
        <HistoryIcon
          fontSize="small"
          sx={{ color: primaryMain, fontSize: compact ? 16 : undefined }}
        />
        <Typography
          variant="caption"
          sx={{
            fontWeight: collapsed && compact ? 600 : 700,
            flex: 1,
            fontSize: collapsed && compact ? '0.75rem' : '0.8125rem',
            color: 'text.secondary',
          }}
          noWrap
        >
          {RECENT_TITLE}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, opacity: 0.85 }}>
          {loading ? '…' : items.length}
        </Typography>
        {collapsed ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ExpandLessIcon sx={{ fontSize: 18 }} />}
        <Tooltip title={CLEAR_LABEL}>
          <IconButton
            size="small"
            aria-label={CLEAR_LABEL}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onClear?.();
            }}
            sx={{ p: compact ? 0.25 : 0.5 }}
          >
            <ClearAllIcon sx={{ fontSize: compact ? 16 : 20 }} />
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
            const docNo = getDocNo(item) || readFirst(snapshot, ['doc_no', 'DOC_NO']);
            const docNumber = readFirst(
              item,
              ['doc_number', 'DOC_NUMBER'],
              readFirst(snapshot, ['doc_number', 'DOC_NUMBER'], docNo ? `DOC ${docNo}` : 'Акт'),
            );
            const employee = readFirst(snapshot, ['employee_name', 'EMPLOYEE_NAME']);
            const branch = readFirst(snapshot, ['branch_name', 'BRANCH_NAME']);
            const location = readFirst(snapshot, ['location_name', 'LOCATION_NAME']);
            const docDateRaw = snapshot?.doc_date || snapshot?.DOC_DATE;
            const docDate = docDateRaw ? formatDate(docDateRaw) : '';
            const itemCount = Number(snapshot?.item_count || snapshot?.items_count || (Array.isArray(snapshot?.items) ? snapshot.items.length : 0)) || 0;
            const actionLabel = readFirst(item, ['last_action_label'], readFirst(item, ['last_action']));
            const timeLabel = formatRecentTime(item?.last_activity_at);
            const placeLabel = [branch, location].filter(Boolean).join(' / ');
            const mobileMeta = [employee, placeLabel, docDate].filter(Boolean).join(' / ');

            return (
              <Box
                key={`${item?.db_id || ''}:${docNo}`}
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
                    <Typography variant="body2" sx={{ fontWeight: 800, minWidth: 0 }} noWrap title={docNumber}>
                      {docNumber}
                    </Typography>
                    {docDate ? (
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                        {docDate}
                      </Typography>
                    ) : null}
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
                  {itemCount > 0 && (
                    <Chip size="small" label={`${itemCount} поз.`} sx={chipOverflowSx} />
                  )}
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
                      aria-label={`${OPEN_LABEL} ${docNumber}`}
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
                      aria-label={`${REMOVE_LABEL} ${docNumber}`}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRemove?.(docNo);
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

export default DatabaseRecentActs;
