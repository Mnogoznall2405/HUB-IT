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
        gap: 0.75,
        mb: 0.5,
        minHeight: 32,
      }}
    >
      <HistoryIcon fontSize="small" sx={{ color: primaryMain, flexShrink: 0 }} />
      <Box
        sx={{
          display: 'flex',
          gap: 0.75,
          overflowX: 'auto',
          flex: 1,
          minWidth: 0,
          py: 0.25,
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
                maxWidth: 140,
                height: 26,
                fontSize: '0.7rem',
                bgcolor: alpha(primaryMain, 0.08),
                borderColor: alpha(primaryMain, 0.2),
                '& .MuiChip-label': {
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
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
        <IconButton size="small" aria-label="Очистить последние" onClick={onClear}>
          <ClearAllIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default memo(DatabaseRecentCardsStrip);
