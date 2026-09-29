import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';

import { readFirst } from './databaseRecordModel';
import { CONSUMABLE_QR_PRINT_GRID } from './useConsumableQrLabel';

const itemKey = (item, index) => {
  const id = String(readFirst(item, ['ID', 'id'], '') || '').trim();
  const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
  return `${id || 'noid'}-${invNo || 'noinv'}-${index}`;
};

const GRID_INPUT_MAX = 10;

// Batch print of consumable QR labels: pick cards, pick the sticker-sheet
// grid (default 6×6 on A4), send to the shared print portal.
function ConsumableQrPrintDialog({
  open,
  items = [],
  printing = false,
  isMobile = false,
  onClose,
  onPrint,
}) {
  const [selectedKeys, setSelectedKeys] = useState(() => new Set());
  const [columnsInput, setColumnsInput] = useState(String(CONSUMABLE_QR_PRINT_GRID.columns));
  const [rowsInput, setRowsInput] = useState(String(CONSUMABLE_QR_PRINT_GRID.rows));

  const rows = useMemo(
    () => (items || []).map((item, index) => ({ item, key: itemKey(item, index) })),
    [items]
  );

  useEffect(() => {
    if (!open) return;
    setSelectedKeys(new Set(rows.map((row) => row.key)));
    setColumnsInput(String(CONSUMABLE_QR_PRINT_GRID.columns));
    setRowsInput(String(CONSUMABLE_QR_PRINT_GRID.rows));
  }, [open, rows]);

  const allSelected = rows.length > 0 && selectedKeys.size === rows.length;
  const partiallySelected = selectedKeys.size > 0 && selectedKeys.size < rows.length;

  const toggleAll = () => {
    setSelectedKeys(allSelected ? new Set() : new Set(rows.map((row) => row.key)));
  };
  const toggleRow = (key) => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handlePrint = () => {
    const selected = rows.filter((row) => selectedKeys.has(row.key)).map((row) => row.item);
    if (!selected.length) return;
    onPrint?.(selected, { columns: columnsInput, rows: rowsInput });
  };

  return (
    <Dialog
      open={open}
      onClose={printing ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>Печать QR этикеток расходников</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            pb: 0.5,
            mb: 0.5,
          }}
        >
          <Checkbox
            size="small"
            checked={allSelected}
            indeterminate={partiallySelected}
            onChange={toggleAll}
            inputProps={{ 'aria-label': 'Выбрать все расходники' }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            Выбрано: {selectedKeys.size} из {rows.length}
          </Typography>
          <TextField
            label="Колонок"
            type="number"
            size="small"
            value={columnsInput}
            onChange={(event) => setColumnsInput(event.target.value)}
            inputProps={{ min: 1, max: GRID_INPUT_MAX, step: 1 }}
            sx={{ width: 96 }}
          />
          <TextField
            label="Строк"
            type="number"
            size="small"
            value={rowsInput}
            onChange={(event) => setRowsInput(event.target.value)}
            inputProps={{ min: 1, max: GRID_INPUT_MAX, step: 1 }}
            sx={{ width: 96 }}
          />
        </Box>

        <Box sx={{ maxHeight: isMobile ? 'none' : 420, overflowY: 'auto' }}>
          {rows.map(({ item, key }) => {
            const model = String(readFirst(item, ['MODEL_NAME', 'model_name'], '') || readFirst(item, ['TYPE_NAME', 'type_name'], 'Расходник'));
            const type = String(readFirst(item, ['TYPE_NAME', 'type_name'], '') || '').trim();
            const branch = String(readFirst(item, ['BRANCH_NAME', 'branch_name'], '') || '').trim();
            const location = String(readFirst(item, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'], '') || '').trim();
            const invNo = String(readFirst(item, ['INV_NO', 'inv_no'], '') || '').trim();
            const id = String(readFirst(item, ['ID', 'id'], '') || '').trim();
            const qty = readFirst(item, ['QTY', 'qty'], '');
            return (
              <Box
                key={key}
                onClick={() => toggleRow(key)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  py: 0.25,
                  cursor: 'pointer',
                  borderRadius: '4px',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Checkbox
                  size="small"
                  checked={selectedKeys.has(key)}
                  inputProps={{ 'aria-label': `Печать QR: ${model}` }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap>{model}{type ? ` | ${type}` : ''}</Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {[branch, location].filter(Boolean).join(' / ') || '—'}
                    {` | `}{invNo ? `Инв. № ${invNo}` : ''}{invNo && id ? ' · ' : ''}{id ? `ID ${id}` : ''}
                    {qty !== '' ? ` | Остаток: ${qty}` : ''}
                  </Typography>
                </Box>
              </Box>
            );
          })}
          {!rows.length && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              Список расходников пуст.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} variant="outlined" disabled={printing}>
          Закрыть
        </Button>
        <Button
          onClick={handlePrint}
          variant="contained"
          disabled={printing || selectedKeys.size === 0}
        >
          {printing ? 'Подготовка...' : `Печать (${selectedKeys.size})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ConsumableQrPrintDialog;
