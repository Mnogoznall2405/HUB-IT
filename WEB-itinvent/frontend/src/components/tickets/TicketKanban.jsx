import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { ticketsAPI } from '../../api/tickets';
import { STATUS_LABELS, formatDate, getErrorMessage } from './ticketUi';

const COLUMN_TARGET_STATUS = {
  'Не запущен': 'data_check',
  'В работе': 'in_progress',
  'Куплен': 'purchased',
  'Возврат/обмен': 'exchange_needed',
  Отмена: 'cancelled',
  Проблема: 'missing_data',
};

export default function TicketKanban({ objects = [], canWrite = false, onSelectRequest, onChanged }) {
  const [columns, setColumns] = useState({});
  const [objectIds, setObjectIds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draggedId, setDraggedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await ticketsAPI.getKanban({ object_ids: objectIds });
      setColumns(data && typeof data === 'object' ? data : {});
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [objectIds]);

  useEffect(() => {
    void load();
  }, [load]);

  const dropToColumn = async (columnName) => {
    if (!canWrite || !draggedId) return;
    const targetStatus = COLUMN_TARGET_STATUS[columnName];
    if (!targetStatus) return;
    try {
      const request = await ticketsAPI.getRequest(draggedId);
      if (request.status === targetStatus) return;
      await ticketsAPI.changeStatus(draggedId, {
        new_status: targetStatus,
        expected_version: request.version,
        comment: `Перемещено в колонку "${columnName}"`,
      });
      await load();
      onChanged?.();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setDraggedId(null);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 240 }}>
          <InputLabel>Объекты</InputLabel>
          <Select
            multiple
            label="Объекты"
            value={objectIds}
            onChange={(event) => setObjectIds(Array.isArray(event.target.value) ? event.target.value : [])}
            renderValue={(selected) => `${selected.length} выбрано`}
          >
            {objects.map((item) => (
              <MenuItem key={item.id} value={String(item.id)}>{item.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button startIcon={<RefreshIcon />} onClick={load}>Обновить</Button>
      </Stack>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(6, minmax(180px, 1fr))' }, gap: 1.5 }}>
        {Object.entries(columns).map(([columnName, cards]) => (
          <Box
            key={columnName}
            onDragOver={(event) => {
              if (canWrite) event.preventDefault();
            }}
            onDrop={() => dropToColumn(columnName)}
            sx={{
              minHeight: 360,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper',
              p: 1,
            }}
          >
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
              <Typography variant="subtitle2">{columnName}</Typography>
              <Chip size="small" label={Array.isArray(cards) ? cards.length : 0} />
            </Stack>
            <Stack spacing={1}>
              {(Array.isArray(cards) ? cards : []).map((card) => (
                <Box
                  key={card.id}
                  draggable={canWrite}
                  onDragStart={() => setDraggedId(card.id)}
                  onClick={() => onSelectRequest?.(card.id)}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1,
                    cursor: 'pointer',
                    bgcolor: 'background.default',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{card.employee_name || `#${card.id}`}</Typography>
                  <Typography variant="caption" color="text.secondary">{card.object_name || '-'}</Typography>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
                    <Chip size="small" label={STATUS_LABELS[card.status] || card.status} />
                    {card.is_urgent ? <Chip size="small" color="error" label="Срочно" /> : null}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                    {formatDate(card.departure_date)} · {card.route || 'маршрут не указан'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">{card.assignee_name || 'Без ответственного'}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>
        ))}
      </Box>
    </Stack>
  );
}
