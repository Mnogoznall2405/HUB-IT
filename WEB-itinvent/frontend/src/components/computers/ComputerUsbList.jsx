import React from 'react';
import {
  Box,
  Chip,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

export const formatUsbTs = (ts) => {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return '-';
  return new Date(value * 1000).toLocaleString('ru-RU');
};

export const usbDeviceTitle = (item) => {
  const name = item?.friendly_name || [item?.vendor, item?.product].filter(Boolean).join(' ');
  return name || item?.pnp_device_id || 'USB-устройство';
};

export default function ComputerUsbList({ usb }) {
  const items = Array.isArray(usb?.items) ? usb.items.filter(Boolean) : [];
  if (items.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 1.4 }}>
        <Typography variant="body2" color="text.secondary">
          Данных о USB-устройствах нет: их присылает агент версии 1.4.14 и выше, либо к компьютеру ничего не подключали.
        </Typography>
      </Paper>
    );
  }
  return (
    <Paper variant="outlined" sx={{ p: 1.2 }} data-testid="computer-usb">
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
        Устройств: {items.length} · Обновлено: {formatUsbTs(usb?.collected_at)}
      </Typography>
      <Box sx={{ maxHeight: 360, overflow: 'auto' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Устройство</TableCell>
              <TableCell>Серийный №</TableCell>
              <TableCell>Подключали</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={`${item.pnp_device_id || item.serial}|${index}`}>
                <TableCell sx={{ wordBreak: 'break-word' }}>
                  {usbDeviceTitle(item)}
                  {item.present ? <Chip size="small" color="warning" label="сейчас подключено" sx={{ ml: 0.8 }} /> : null}
                  {item.size_gb ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {item.size_gb} ГБ
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell sx={{ wordBreak: 'break-all' }}>
                  {item.serial || '-'}
                  {item.serial && item.has_unique_serial === false ? (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      без своего номера
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    Первый раз: {formatUsbTs(item.first_connected_at)}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block' }}>
                    Последний: {formatUsbTs(item.last_connected_at)}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  );
}
