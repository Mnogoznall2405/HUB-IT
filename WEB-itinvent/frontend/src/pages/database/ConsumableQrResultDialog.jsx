import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';

import jsonAPI from '../../api/json_client';
import { readFirst, readQty, toNumberOrNull } from './databaseRecordModel';
import { isCartridgeLikeConsumable } from './consumableModel';
import { readPrinterInvNo } from './useConsumableQrPrinterPicker';

const readConsumableField = (item, keys, fallback = '—') => {
  const value = String(readFirst(item, keys, '') || '').trim();
  return value && value !== '-' ? value : fallback;
};

const readPrinterField = (printer, keys) => String(readFirst(printer, keys, '') || '').trim();

const printerTitle = (printer) =>
  readPrinterField(printer, ['MODEL_NAME', 'model_name']) || 'МФУ';

const printerSubtitle = (printer) => [
  readPrinterInvNo(printer) ? `инв. ${readPrinterInvNo(printer)}` : '',
  [readPrinterField(printer, ['BRANCH_NAME', 'branch_name']), readPrinterField(printer, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'])]
    .filter(Boolean).join(' · '),
  readPrinterField(printer, ['OWNER_DISPLAY_NAME', 'employee_name']),
].filter(Boolean).join(' · ');

function PrinterPickList({ rows, emptyText, onSelect }) {
  if (!rows || rows.length === 0) {
    return <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{emptyText}</Typography>;
  }
  return (
    <List dense disablePadding sx={{ mt: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, maxHeight: 180, overflowY: 'auto' }}>
      {rows.map((printer, index) => (
        <ListItemButton
          key={readPrinterInvNo(printer) || `printer-${index}`}
          onClick={() => onSelect?.(printer)}
          divider={index < rows.length - 1}
        >
          <ListItemText
            primary={printerTitle(printer)}
            secondary={printerSubtitle(printer)}
            primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </ListItemButton>
      ))}
    </List>
  );
}

function ConsumableQrResultDialog({
  open,
  onClose,
  isMobile = false,
  loading = false,
  item = null,
  canWrite = false,
  consumeQty = '1',
  consumeLoading = false,
  error = '',
  onConsumeQtyChange,
  onConsume,
  onEditQty,
  printerPicker = null,
}) {
  const [localCompatiblePrinters, setLocalCompatiblePrinters] = useState(null);

  const modelName = readConsumableField(item, ['MODEL_NAME', 'model_name']);
  const typeName = readConsumableField(item, ['TYPE_NAME', 'type_name']);
  const branchName = readConsumableField(item, ['BRANCH_NAME', 'branch_name'], '');
  const locationName = readConsumableField(item, ['LOCATION_NAME', 'location_name', 'LOCATION', 'location'], '');
  const invNo = readConsumableField(item, ['INV_NO', 'inv_no']);
  const itemId = toNumberOrNull(readFirst(item, ['ID', 'id'], null));
  const qty = readQty(item, 0);

  const storage = [branchName, locationName].filter(Boolean).join(' · ') || 'Не указано';

  const isCartridgeLike = useMemo(() => isCartridgeLikeConsumable(item), [item]);

  // Compatibility chips come from the shared picker hook when it is wired;
  // the local fetch below is only a fallback for standalone usage.
  const pickerActive = Boolean(printerPicker);
  useEffect(() => {
    setLocalCompatiblePrinters(null);
    if (pickerActive || !open || !isCartridgeLike || !modelName || modelName === '—') return undefined;

    let cancelled = false;
    jsonAPI.getPrintersForCartridge(modelName)
      .then((response) => {
        if (cancelled) return;
        const rows = Array.isArray(response?.data?.printer_models)
          ? response.data.printer_models
          : [];
        setLocalCompatiblePrinters(rows);
      })
      .catch(() => {
        if (!cancelled) setLocalCompatiblePrinters([]);
      });
    return () => { cancelled = true; };
  }, [isCartridgeLike, modelName, open, pickerActive]);

  const compatiblePrinters = pickerActive ? printerPicker.compatibleModels : localCompatiblePrinters;
  const pickerQuery = String(printerPicker?.printerQuery || '');
  const pickerSearching = Boolean(printerPicker?.searching);
  const pickerRows = pickerQuery.trim()
    ? (printerPicker?.searchResults ?? null)
    : (printerPicker?.suggestedPrinters ?? []);
  const selectedPrinter = printerPicker?.selectedPrinter || null;
  const printerRequired = isCartridgeLike && canWrite && pickerActive;
  const consumeDisabled = consumeLoading || qty <= 0 || (printerRequired && !selectedPrinter);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      fullScreen={isMobile}
    >
      <DialogTitle>{modelName === '—' ? 'Расходник' : modelName}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
              <Typography variant="h3" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {qty}
              </Typography>
              <Typography color="text.secondary">шт. на остатке</Typography>
            </Box>

            <Box component="dl" sx={{ m: 0, display: 'grid', rowGap: 0.5 }}>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Typography component="dt" color="text.secondary" sx={{ minWidth: 110 }}>Тип</Typography>
                <Typography component="dd" sx={{ m: 0 }}>{typeName}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Typography component="dt" color="text.secondary" sx={{ minWidth: 110 }}>Хранится</Typography>
                <Typography component="dd" sx={{ m: 0 }}>{storage}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Typography component="dt" color="text.secondary" sx={{ minWidth: 110 }}>Инв. № / ID</Typography>
                <Typography component="dd" sx={{ m: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {invNo}{itemId !== null ? ` · ${itemId}` : ''}
                </Typography>
              </Box>
            </Box>

            {isCartridgeLike ? (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  Подходит к
                </Typography>
                {compatiblePrinters === null || compatiblePrinters === undefined ? (
                  <Typography variant="body2" color="text.secondary">Проверяем совместимость…</Typography>
                ) : compatiblePrinters.length ? (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {compatiblePrinters.map((printer) => (
                      <Chip key={printer} label={printer} size="small" variant="outlined" />
                    ))}
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.secondary">Совместимость не найдена.</Typography>
                )}
              </Box>
            ) : null}

            {printerRequired ? (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                  МФУ для списания
                </Typography>
                {selectedPrinter ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, p: 1, border: '1px solid', borderColor: 'primary.main', borderRadius: 1.5 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {printerTitle(selectedPrinter)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {printerSubtitle(selectedPrinter)}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={() => printerPicker?.clearPrinter?.()}
                      aria-label="Выбрать другую МФУ"
                    >
                      <CloseRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ) : (
                  <>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="Модель, инв. №, серийник или локация"
                      value={pickerQuery}
                      onChange={(event) => printerPicker?.setPrinterQuery?.(event.target.value)}
                      inputProps={{ 'aria-label': 'Поиск МФУ' }}
                      sx={{ mt: 0.5 }}
                      disabled={consumeLoading}
                    />
                    {pickerSearching ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                        <CircularProgress size={16} />
                        <Typography variant="body2" color="text.secondary">Ищем МФУ…</Typography>
                      </Box>
                    ) : pickerQuery.trim() ? (
                      <PrinterPickList
                        rows={pickerRows || []}
                        emptyText="МФУ не найдены — уточните запрос."
                        onSelect={printerPicker?.selectPrinter}
                      />
                    ) : (
                      <>
                        {printerPicker?.suggestionsLoading ? (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            Подбираем МФУ по совместимости…
                          </Typography>
                        ) : null}
                        <PrinterPickList
                          rows={pickerRows}
                          emptyText={compatiblePrinters?.length
                            ? 'Подходящих МФУ в базе не найдено — воспользуйтесь поиском.'
                            : 'Найдите МФУ поиском выше.'}
                          onSelect={printerPicker?.selectPrinter}
                        />
                      </>
                    )}
                  </>
                )}
              </Box>
            ) : null}

            {canWrite ? (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                <Button
                  variant="contained"
                  disabled={consumeDisabled}
                  onClick={() => onConsume?.(1)}
                >
                  Списать 1
                </Button>
                <TextField
                  size="small"
                  label="Списать шт."
                  value={consumeQty}
                  onChange={(event) => onConsumeQtyChange?.(event.target.value)}
                  inputProps={{ inputMode: 'numeric', 'aria-label': 'Количество для списания' }}
                  sx={{ width: 110 }}
                  disabled={consumeLoading}
                />
                <Button
                  variant="outlined"
                  disabled={consumeDisabled}
                  onClick={() => onConsume?.(consumeQty)}
                >
                  Списать
                </Button>
              </Box>
            ) : null}
            {printerRequired && !selectedPrinter ? (
              <Typography variant="caption" color="text.secondary">
                Выберите МФУ, в которую устанавливается расходник — без неё списание недоступно.
              </Typography>
            ) : null}

            {consumeLoading ? <CircularProgress size={22} /> : null}
            {error ? <Alert severity="error">{error}</Alert> : null}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1, flexDirection: { xs: 'column', sm: 'row' }, '& > :not(style) ~ :not(style)': { ml: 0 }, '& .MuiButton-root': { width: { xs: '100%', sm: 'auto' } } }}>
        <Button onClick={onClose} variant="outlined">Закрыть</Button>
        {canWrite && onEditQty ? (
          <Button onClick={onEditQty} variant="text" disabled={consumeLoading}>
            Установить остаток…
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  );
}

export default ConsumableQrResultDialog;
