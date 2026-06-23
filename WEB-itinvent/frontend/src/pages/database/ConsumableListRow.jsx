import { memo } from 'react';
import { Box, Chip, IconButton, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';

import { readFirst } from './databaseRecordModel';
import { toInvNo } from './equipmentModel';

function ConsumableListRow({
  item,
  onEditQty,
  canWrite = false,
}) {
  const invNo = toInvNo(item);
  const typeName = readFirst(item, ['TYPE_NAME', 'type_name'], '');
  const modelName = readFirst(item, ['MODEL_NAME', 'model_name'], '—');
  const title = [typeName, modelName].filter(Boolean).join(' · ') || modelName;
  const qty = readFirst(item, ['QTY', 'qty'], '0');

  return (
    <Box
      data-testid={`consumable-row-${invNo}`}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.9,
        borderBottom: '1px solid',
        borderColor: 'divider',
        minHeight: 48,
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
          {invNo}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {title}
        </Typography>
      </Box>
      <Chip label={qty} size="small" color="primary" variant="outlined" sx={{ minWidth: 40 }} />
      {canWrite && onEditQty ? (
        <IconButton
          size="small"
          aria-label={`Изменить количество ${invNo}`}
          onClick={() => onEditQty(item)}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      ) : null}
    </Box>
  );
}

export default memo(ConsumableListRow);
