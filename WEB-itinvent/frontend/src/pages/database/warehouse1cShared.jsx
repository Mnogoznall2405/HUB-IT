import { Box, Typography } from '@mui/material';

export const UNBOUNDED_MOVEMENT_PERIOD = Object.freeze({
  dateFrom: '',
  dateTo: '',
});

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

const collator = typeof Intl !== 'undefined'
  ? new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
  : null;

export function compareRuText(left, right) {
  const a = String(left || '').trim();
  const b = String(right || '').trim();
  if (collator) return collator.compare(a, b);
  return a.localeCompare(b, 'ru', { numeric: true, sensitivity: 'base' });
}

/** Sort balance rows by nomenclature name (then code / warehouse). */
export function sortBalancesByNomenclature(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const byName = compareRuText(left?.nomenclature_name, right?.nomenclature_name);
    if (byName !== 0) return byName;
    const byCode = compareRuText(left?.nomenclature_code, right?.nomenclature_code);
    if (byCode !== 0) return byCode;
    return compareRuText(left?.warehouse_name, right?.warehouse_name);
  });
}

/** Sort warehouse balance rows by warehouse / employee name. */
export function sortBalancesByWarehouse(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftName = left?.hub_employee_name || left?.warehouse_name || '';
    const rightName = right?.hub_employee_name || right?.warehouse_name || '';
    const byName = compareRuText(leftName, rightName);
    if (byName !== 0) return byName;
    return compareRuText(left?.warehouse_name, right?.warehouse_name);
  });
}

export function filterBalancesByText(rows = [], query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const haystack = [
      row?.nomenclature_name,
      row?.nomenclature_code,
      row?.characteristic_name,
      row?.series_name,
      row?.series_number,
      row?.warehouse_name,
      row?.hub_employee_name,
    ]
      .map((part) => String(part || '').toLowerCase())
      .join(' ');
    return haystack.includes(needle);
  });
}

export const HUB_PART_NO_NOT_IN_1C = 'нет в 1С';

const PART_NO_PLACEHOLDER_RE = /не\s*найден/i;
const PART_NO_NOT_IN_1C_RE = /^нет\s+в\s+1[сc]/i;

export function isNotIn1cPartNo(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return PART_NO_NOT_IN_1C_RE.test(text);
}

export function isUsableHubPartNo(value) {
  const text = String(value || '').trim();
  if (!text || text === '-' || text === '—') return false;
  if (isNotIn1cPartNo(text)) return false;
  if (PART_NO_PLACEHOLDER_RE.test(text)) return false;
  return true;
}

export function isPendingHubPartNo(value) {
  return !isUsableHubPartNo(value) && !isNotIn1cPartNo(value);
}
