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

const getDocNo = (item) => readFirst(item, ['doc_no', 'DOC_NO']);

function DatabaseRecentActsStrip({
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
      data-testid="database-recent-acts-strip"
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
          const docNo = getDocNo(item) || readFirst(snapshot, ['doc_no', 'DOC_NO']);
          const docNumber = readFirst(
            item,
            ['doc_number', 'DOC_NUMBER'],
            readFirst(snapshot, ['doc_number', 'DOC_NUMBER'], docNo),
          );
          const employee = readFirst(snapshot, ['employee_name', 'EMPLOYEE_NAME']);
          const label = employee ? `${docNumber} · ${employee}` : docNumber;

          return (
            <Chip
              key={`${item?.db_id || ''}:${docNo}`}
              label={label}
              size="small"
              onClick={() => onOpen?.(item)}
              sx={{
                flexShrink: 0,
                maxWidth: 140,
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
        <IconButton size="small" aria-label="Очистить последние акты" onClick={onClear} sx={{ p: 0.35 }}>
          <ClearAllIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default memo(DatabaseRecentActsStrip);
