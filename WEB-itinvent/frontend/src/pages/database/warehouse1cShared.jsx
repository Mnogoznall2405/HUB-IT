import { Box, Typography } from '@mui/material';

export function NomenclatureCell({ code, name }) {
  const codeText = String(code || '').trim();
  const nameText = String(name || '').trim() || '-';

  return (
    <Box>
      {codeText ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
          {codeText}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ lineHeight: 1.35 }}>
        {nameText}
      </Typography>
    </Box>
  );
}

export function formatWarehouseQty(value, digits = 3) {
  const num = Number(value || 0);
  return num.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function resolveWarehouseErrorMessage(err, fallback) {
  if (err?.code === 'ECONNABORTED') {
    return '1С не ответила вовремя. Повторите запрос позже.';
  }
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  return fallback;
}
