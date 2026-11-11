import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import { computersUsbAPI } from '../../api/computersUsb';
import { formatUsbTs, usbDeviceTitle } from './ComputerUsbList';

const SEARCH_DEBOUNCE_MS = 500;
const MIN_QUERY_LEN = 2;

export default function UsbFleetSearchDialog({ open, onClose, scope = 'selected' }) {
  const [query, setQuery] = useState('');
  const [presentOnly, setPresentOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    const text = query.trim();
    if (!open || text.length < MIN_QUERY_LEN) {
      setResult(null);
      setError('');
      setLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        setResult(await computersUsbAPI.searchUsb({ q: text, presentOnly, scope, signal: controller.signal }));
      } catch (err) {
        if (controller.signal.aborted || err?.code === 'ERR_CANCELED') return;
        setResult(null);
        setError(err?.response?.data?.detail || 'Не удалось выполнить поиск');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, presentOnly, scope]);

  const items = Array.isArray(result?.items) ? result.items : [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Поиск USB-устройства по парку</DialogTitle>
      <DialogContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mt: 0.5, mb: 1 }}>
          <TextField
            autoFocus
            size="small"
            fullWidth
            label="Производитель, модель или серийный номер"
            placeholder="Например: SanDisk или серийный номер флешки"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <FormControlLabel
            sx={{ m: 0, whiteSpace: 'nowrap' }}
            control={<Switch checked={presentOnly} onChange={(event) => setPresentOnly(event.target.checked)} />}
            label="Только подключённые сейчас"
          />
        </Stack>
        {loading ? <LinearProgress sx={{ mb: 1 }} /> : null}
        {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
        {!result && !loading && !error ? (
          <Typography variant="body2" color="text.secondary">
            Введите не менее {MIN_QUERY_LEN} символов. Ищем по истории USB-накопителей, которую присылают агенты.
          </Typography>
        ) : null}
        {result ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
              Найдено записей: {result.total}
              {result.truncated ? ` (показаны первые ${items.length})` : ''} · Компьютеров с данными: {result.computers_with_usb_data} из {result.computers_checked}
            </Typography>
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Ничего не найдено.</Typography>
            ) : (
              <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Устройство</TableCell>
                      <TableCell>Серийный №</TableCell>
                      <TableCell>Компьютер</TableCell>
                      <TableCell>Последний раз</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((row, index) => (
                      <TableRow key={`${row.mac_address}|${row.serial}|${row.product}|${index}`}>
                        <TableCell sx={{ wordBreak: 'break-word' }}>
                          {usbDeviceTitle(row)}
                          {row.present ? <Chip size="small" color="warning" label="подключено" sx={{ ml: 0.8 }} /> : null}
                        </TableCell>
                        <TableCell sx={{ wordBreak: 'break-all' }}>{row.serial || '-'}</TableCell>
                        <TableCell>
                          {row.hostname || '-'}
                          {row.user_login ? (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {row.user_login}
                            </Typography>
                          ) : null}
                        </TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatUsbTs(row.last_connected_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
