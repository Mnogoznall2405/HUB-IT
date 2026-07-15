import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { Replay as ReplayIcon } from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';

function friendlyReason(value) {
  const reason = String(value || '').trim();
  const normalized = reason.toLowerCase();
  if (!reason) return 'Анализ не завершён';
  if (normalized.includes('timeout')) return `Превышено время анализа: ${reason}`;
  if (normalized.includes('payload') && normalized.includes('large')) return 'Файл превышает допустимый размер передачи';
  if (normalized.includes('payload')) return `Не удалось получить файл: ${reason}`;
  if (normalized.includes('encrypt') || normalized.includes('password')) return 'Файл зашифрован или защищён паролем';
  if (normalized.includes('tesseract') || normalized.includes('ocr')) return `Ошибка распознавания: ${reason}`;
  if (normalized.includes('libreoffice') || normalized.includes('convert')) return `Ошибка преобразования документа: ${reason}`;
  return reason;
}

function outcomeLabel(item) {
  const outcomes = Array.isArray(item?.extraction_outcomes) ? item.extraction_outcomes : [];
  if (outcomes.length === 0) return 'Нет данных по страницам';
  return outcomes
    .slice(0, 3)
    .map((outcome, index) => {
      if (typeof outcome === 'string') return outcome;
      const page = Number(outcome?.page || outcome?.page_number || index + 1);
      const value = String(outcome?.outcome || outcome?.status || 'неизвестно');
      return `стр. ${page}: ${value}`;
    })
    .join(' · ');
}

function ReviewItemCard({ item, canScanTasks, formatTs, onRetryAgent }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
      <Stack spacing={1}>
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {item.hostname || item.agent_id || 'Неизвестный компьютер'}
          </Typography>
          <Typography variant="caption" color="text.secondary">{item.branch || item.agent_id || 'Без филиала'}</Typography>
        </Box>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.file_path || item.file_name || 'Путь не указан'}</Typography>
        <Alert severity="warning" icon={false} sx={{ py: 0.45 }}>
          <Typography variant="body2">{friendlyReason(item.reason)}</Typography>
        </Alert>
        <Typography variant="caption" color="text.secondary">{outcomeLabel(item)}</Typography>
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
          {item.source_kind ? <Chip size="small" variant="outlined" label={item.source_kind} /> : null}
          {item.analysis_version ? <Chip size="small" variant="outlined" label={item.analysis_version} /> : null}
          <Chip size="small" variant="outlined" label={formatTs(item.finished_at || item.created_at)} />
        </Stack>
        <Button
          type="button"
          size="small"
          variant="outlined"
          startIcon={<ReplayIcon />}
          disabled={!canScanTasks || !item.agent_id}
          onClick={() => onRetryAgent(item.agent_id)}
        >
          Пересканировать ПК
        </Button>
      </Stack>
    </Paper>
  );
}

export default function ReviewItemsSection({
  visible,
  items,
  total,
  loading,
  page,
  rowsPerPage,
  rowsPerPageOptions,
  canScanTasks,
  formatTs,
  onPageChange,
  onRowsPerPageChange,
  onRetryAgent,
}) {
  const theme = useTheme();
  const mobileLayout = useMediaQuery(theme.breakpoints.down('md'));
  if (!visible) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Stack spacing={1.5}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>Не удалось проверить</Typography>
          <Typography variant="body2" color="text.secondary">
            Эти файлы не считаются чистыми. Устраните причину и запустите повторный скан компьютера.
          </Typography>
        </Box>

        {loading && items.length === 0 ? (
          <Alert severity="info" icon={<CircularProgress size={18} />}>Загружаю очередь непроверенных файлов…</Alert>
        ) : Number(total || 0) > 0 ? (
          <Alert severity="warning">
            Требуют повторной проверки: {Number(total || 0)}. Ошибки OCR, повреждённые и недоступные файлы остаются в этом списке.
          </Alert>
        ) : (
          <Alert severity="success">Неполностью проверенных файлов нет.</Alert>
        )}

        {mobileLayout ? <Stack spacing={1}>
          {items.map((item) => (
            <ReviewItemCard
              key={item.id}
              item={item}
              canScanTasks={canScanTasks}
              formatTs={formatTs}
              onRetryAgent={onRetryAgent}
            />
          ))}
          {!loading && items.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              Нет файлов, ожидающих повторной проверки.
            </Typography>
          ) : null}
        </Stack> : (

        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 620 }}>
          <Table stickyHeader size="small" sx={{ minWidth: 1080 }}>
            <TableHead>
              <TableRow>
                <TableCell>Компьютер</TableCell>
                <TableCell>Файл</TableCell>
                <TableCell>Почему не проверен</TableCell>
                <TableCell>Результат извлечения</TableCell>
                <TableCell>Время</TableCell>
                <TableCell align="right">Действие</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && items.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={24} /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={6} align="center">Нет файлов, ожидающих повторной проверки.</TableCell></TableRow>
              ) : items.map((item) => (
                <TableRow hover key={item.id}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{item.hostname || item.agent_id || 'Неизвестный компьютер'}</Typography>
                    <Typography variant="caption" color="text.secondary">{item.branch || item.agent_id || '—'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 330, overflowWrap: 'anywhere' }}>{item.file_path || item.file_name || 'Путь не указан'}</Typography>
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                      {item.source_kind ? <Chip size="small" variant="outlined" label={item.source_kind} /> : null}
                      {item.analysis_version ? <Chip size="small" variant="outlined" label={item.analysis_version} /> : null}
                    </Stack>
                  </TableCell>
                  <TableCell><Typography variant="body2" color="error.main">{friendlyReason(item.reason)}</Typography></TableCell>
                  <TableCell><Typography variant="caption" color="text.secondary">{outcomeLabel(item)}</Typography></TableCell>
                  <TableCell>{formatTs(item.finished_at || item.created_at)}</TableCell>
                  <TableCell align="right">
                    <Button
                      type="button"
                      size="small"
                      variant="outlined"
                      startIcon={<ReplayIcon />}
                      disabled={!canScanTasks || !item.agent_id}
                      onClick={() => onRetryAgent(item.agent_id)}
                    >
                      Пересканировать ПК
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        )}

        <TablePagination
          component="div"
          count={Number(total || 0)}
          page={page}
          onPageChange={(_, nextPage) => onPageChange(nextPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => onRowsPerPageChange(Number(event.target.value))}
          rowsPerPageOptions={rowsPerPageOptions}
          labelRowsPerPage="Строк на странице"
        />
      </Stack>
    </Paper>
  );
}
