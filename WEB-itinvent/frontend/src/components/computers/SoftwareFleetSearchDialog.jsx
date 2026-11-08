import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import { computersSoftwareAPI } from '../../api/computersSoftware';

const SEARCH_DEBOUNCE_MS = 500;
const MIN_QUERY_LEN = 2;

export default function SoftwareFleetSearchDialog({ open, onClose, scope = 'selected' }) {
  const [query, setQuery] = useState('');
  const [versionBelow, setVersionBelow] = useState('');
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
        const data = await computersSoftwareAPI.searchSoftware({
          q: text,
          versionBelow,
          scope,
          signal: controller.signal,
        });
        setResult(data);
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
  }, [open, query, versionBelow, scope]);

  const items = Array.isArray(result?.items) ? result.items : [];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Поиск программы по парку</DialogTitle>
      <DialogContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mt: 0.5, mb: 1 }}>
          <TextField
            autoFocus
            size="small"
            fullWidth
            label="Название программы"
            placeholder="Например: AnyDesk, Adobe Reader"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <TextField
            size="small"
            label="Версия ниже"
            placeholder="Например: 24.1"
            value={versionBelow}
            onChange={(event) => setVersionBelow(event.target.value)}
            sx={{ minWidth: { sm: 180 } }}
          />
        </Stack>
        {loading ? <LinearProgress sx={{ mb: 1 }} /> : null}
        {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
        {!result && !loading && !error ? (
          <Typography variant="body2" color="text.secondary">
            Введите не менее {MIN_QUERY_LEN} символов. Поиск идёт по спискам программ, которые присылают агенты.
          </Typography>
        ) : null}
        {result ? (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
              Найдено установок: {result.total}
              {result.truncated ? ` (показаны первые ${items.length})` : ''} · Компьютеров со списком ПО: {result.computers_with_software} из {result.computers_checked}
            </Typography>
            {items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Ничего не найдено.</Typography>
            ) : (
              <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Программа</TableCell>
                      <TableCell>Версия</TableCell>
                      <TableCell>Компьютер</TableCell>
                      <TableCell>Пользователь</TableCell>
                      <TableCell>Филиал</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((row, index) => (
                      <TableRow key={`${row.mac_address}|${row.program}|${row.version}|${index}`}>
                        <TableCell sx={{ wordBreak: 'break-word' }}>{row.program}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.version || '-'}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.hostname || '-'}</TableCell>
                        <TableCell>{row.user_login || '-'}</TableCell>
                        <TableCell>{row.branch_name || '-'}</TableCell>
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
