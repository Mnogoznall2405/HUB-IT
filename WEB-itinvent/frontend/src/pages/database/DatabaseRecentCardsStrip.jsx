import { memo } from 'react';
import { Box, Chip, IconButton, Tooltip, Typography, alpha } from '@mui/material';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import HistoryIcon from '@mui/icons-material/History';

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

function DatabaseRecentCardsStrip({
  items = [],
  loading = false,
  theme,
  onOpen,
  onClear,
}) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const palette = theme?.palette || {};
  const primaryMain = palette.primary?.main || '#2563eb';

  return (
    <Box
      data-testid="database-recent-cards-strip"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mb: 0.35,
        minHeight: 26,
      }}
    >
      <HistoryIcon sx={{ color: primaryMain, flexShrink: 0, fontSize: 16 }} />
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          overflowX: 'auto',
          flex: 1,
          minWidth: 0,
          py: 0,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {items.map((item) => {
          const snapshot = getSnapshot(item);
          const invNo = getInvNo(item) || readFirst(snapshot, ['inv_no', 'INV_NO']);
          const title = readFirst(snapshot, ['MODEL_NAME', 'model_name', 'TYPE_NAME', 'type_name'], invNo);
          const label = `${invNo} · ${title}`;

          return (
            <Chip
              key={`${item?.db_id || ''}:${invNo}`}
              label={label}
              size="small"
              onClick={() => onOpen?.(item)}
              sx={{
                flexShrink: 0,
                maxWidth: 128,
                height: 22,
                fontSize: '0.68rem',
                bgcolor: alpha(primaryMain, 0.06),
                borderColor: alpha(primaryMain, 0.14),
                '& .MuiChip-label': {
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  px: 0.75,
                },
              }}
              variant="outlined"
            />
          );
        })}
      </Box>
      {loading ? (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          ...
        </Typography>
      ) : null}
      <Tooltip title="Очистить последние">
        <IconButton size="small" aria-label="Очистить последние" onClick={onClear} sx={{ p: 0.35 }}>
          <ClearAllIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default memo(DatabaseRecentCardsStrip);
