import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

// Machine-wide programs are the default and need no label.
const SCOPE_LABELS = { user: 'пользователя', store: 'Microsoft Store' };

const formatCollectedAt = (ts) => {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return new Date(value * 1000).toLocaleString('ru-RU');
};

// InstallDate in the registry is "YYYYMMDD"; anything else is shown as the agent sent it.
const formatInstallDate = (raw) => {
  const text = String(raw || '').trim();
  if (/^\d{8}$/.test(text)) return `${text.slice(6, 8)}.${text.slice(4, 6)}.${text.slice(0, 4)}`;
  return text || '-';
};

export default function ComputerSoftwareList({ software }) {
  const [filter, setFilter] = useState('');
  const items = useMemo(
    () => (Array.isArray(software?.items) ? software.items.filter((item) => item && item.display_name) : []),
    [software],
  );
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(
    () => (needle
      ? items.filter((item) => `${item.display_name} ${item.publisher || ''}`.toLowerCase().includes(needle))
      : items),
    [items, needle],
  );

  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 1.4 }}>
        <Typography variant="body2" color="text.secondary">
          Список программ ещё не получен: он приходит раз в сутки от агента версии 1.4.11 и выше.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.2 }} data-testid="computer-software">
      <TextField
        size="small"
        fullWidth
        placeholder="Фильтр по названию или издателю"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        inputProps={{ 'aria-label': 'Фильтр программ' }}
        sx={{ mb: 1 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
        Программ: {visible.length}{needle ? ` из ${items.length}` : ''} · Обновлено: {formatCollectedAt(software?.collected_at)}
      </Typography>
      <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Программа</TableCell>
              <TableCell>Версия</TableCell>
              <TableCell>Установлена</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((item, index) => (
              <TableRow key={`${item.display_name}|${item.display_version}|${index}`}>
                <TableCell sx={{ wordBreak: 'break-word' }}>
                  {item.display_name}
                  {SCOPE_LABELS[item.scope] ? (
                    <Chip size="small" variant="outlined" label={SCOPE_LABELS[item.scope]} sx={{ ml: 0.8 }} />
                  ) : null}
                  {item.publisher ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {item.publisher}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{item.display_version || '-'}</TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatInstallDate(item.install_date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
}
