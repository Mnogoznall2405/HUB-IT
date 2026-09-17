import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { LoadingSpinner } from '../../components/common';
import { formatWarehouseQty } from './warehouse1cShared';
import DescriptionIcon from '@mui/icons-material/Description';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { MOVEMENT_DIRECTION_COLOR, MOVEMENT_DIRECTION_LABEL, filterMovementDocsByText, formatMovementDate, movementDocTitle } from './employeeCompareFormat';

export function WarehouseMovementRow({ doc, expanded, onToggle, onOpenDoc }) {
  const fromName = String(doc?.transfer_from_warehouse_name || '').trim();
  const toName = String(doc?.transfer_to_warehouse_name || '').trim();
  const route = fromName || toName ? `${fromName || '—'} → ${toName || '—'}` : '';
  const directionLabel = MOVEMENT_DIRECTION_LABEL[doc?.direction] || '';
  const directionColor = MOVEMENT_DIRECTION_COLOR[doc?.direction] || 'default';
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggle();
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.9,
          minHeight: 52,
          cursor: 'pointer',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {formatMovementDate(doc?.period || doc?.registrar_date)} · {movementDocTitle(doc)}
          </Typography>
          {route ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {route}
            </Typography>
          ) : null}
        </Box>
        {directionLabel ? (
          <Chip size="small" variant="outlined" color={directionColor} label={directionLabel} />
        ) : null}
        <Chip size="small" variant="outlined" label={`${doc?.positions ?? doc?.items?.length ?? 0} поз.`} />
        {onOpenDoc ? (
          <Tooltip title="Карточка документа (вложения)">
            <IconButton
              size="small"
              aria-label="Карточка документа"
              onClick={(event) => {
                event.stopPropagation();
                onOpenDoc(doc);
              }}
            >
              <DescriptionIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        <IconButton size="small" aria-label={expanded ? 'Скрыть позиции' : 'Показать позиции'}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      {expanded ? (
        <Box sx={{ px: 2, pb: 1 }}>
          {(Array.isArray(doc?.items) ? doc.items : []).map((item, index) => {
            const qty = item?.qty_in || item?.qty_out;
            return (
              <Box
                key={`${item?.nomenclature_ref || item?.nomenclature_name}|${index}`}
                sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, py: 0.25 }}
              >
                <Typography variant="caption" sx={{ minWidth: 0 }}>
                  {item?.nomenclature_code ? `${item.nomenclature_code} ` : ''}
                  {item?.nomenclature_name || '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {formatWarehouseQty(qty)}
                </Typography>
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}

export default function WarehouseMovementsList({
  movements,
  loading,
  error,
  meta,
  filterText = '',
  onLoadMore,
  onOpenMovement,
}) {
  const [expandedKey, setExpandedKey] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const visibleDocs = useMemo(
    () => filterMovementDocsByText(movements, filterText).filter(
      (doc) => !directionFilter || doc?.direction === directionFilter,
    ),
    [movements, filterText, directionFilter],
  );
  const filterActive = Boolean(String(filterText || '').trim()) || Boolean(directionFilter);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Stack direction="row" spacing={0.75} sx={{ mb: 1 }}>
        {[
          ['', 'Все'],
          ['in', 'Приход'],
          ['out', 'Расход'],
        ].map(([key, label]) => (
          <Chip
            key={key || 'all'}
            size="small"
            label={label}
            color={key ? (MOVEMENT_DIRECTION_COLOR[key] || 'default') : 'default'}
            variant={directionFilter === key ? 'filled' : 'outlined'}
            onClick={() => setDirectionFilter(key)}
          />
        ))}
      </Stack>
      {loading && visibleDocs.length === 0 ? (
        <LoadingSpinner message="Загрузка перемещений склада..." />
      ) : null}
      {error ? <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert> : null}
      {!loading && !error && visibleDocs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {filterActive ? 'По фильтру перемещений не найдено.' : 'Перемещений по этому складу нет.'}
        </Typography>
      ) : null}
      {visibleDocs.map((doc, index) => {
        const key = doc?.registrar_ref || `doc-${index}`;
        return (
          <WarehouseMovementRow
            key={key}
            doc={doc}
            expanded={expandedKey === key}
            onToggle={() => setExpandedKey(expandedKey === key ? '' : key)}
            onOpenDoc={onOpenMovement}
          />
        );
      })}
      {meta?.has_more ? (
        <Box sx={{ py: 1 }}>
          <Button
            size="small"
            variant="outlined"
            disabled={loading}
            onClick={() => onLoadMore?.(meta?.next_cursor || '')}
          >
            {loading ? 'Загрузка...' : 'Загрузить ещё'}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
}
