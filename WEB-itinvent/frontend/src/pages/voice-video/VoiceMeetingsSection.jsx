import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DeleteOutlineOutlinedIcon from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import OpenInNewOutlinedIcon from '@mui/icons-material/OpenInNewOutlined';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ArrowUpwardOutlinedIcon from '@mui/icons-material/ArrowUpwardOutlined';
import ArrowDownwardOutlinedIcon from '@mui/icons-material/ArrowDownwardOutlined';

const formatTime = (value) => {
  if (!value) return '—';
  const date = Number.isFinite(Number(value))
    ? new Date(Number(value) * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', { hour12: false });
};

const displayName = (base) => String(base || '').replace(/^j[0-9a-f]{12}_/, '');

function MeetingsSkeleton() {
  return (
    <Paper sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} variant="rounded" height={52} />
        ))}
      </Stack>
    </Paper>
  );
}

const SpeakerChip = ({ meeting }) => (
  meeting.unresolved_count > 0 ? (
    <Chip
      size="small"
      color="warning"
      icon={<PersonOffOutlinedIcon />}
      label={`${meeting.unresolved_count} без имени`}
    />
  ) : (
    <Chip size="small" color="success" variant="outlined" label="Все имена заданы" />
  )
);

function DebouncedField({ value, onCommit, ...props }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== (value || '')) onCommit?.(draft);
    }, 400);
    return () => clearTimeout(t);
  }, [draft, value, onCommit]);
  return <TextField size="small" value={draft} onChange={(e) => setDraft(e.target.value)} {...props} />;
}

function VoiceMeetingsSection({
  meetings = [], total = 0, page = 0, pageSize = 20, onPageChange, onOpen,
  loading = false, query = '', onQueryChange,
  unresolvedOnly = false, onUnresolvedChange,
  order = 'desc', onOrderChange,
  participant = '', onParticipantChange,
  tag = '', onTagChange,
  dateFrom = '', dateTo = '', onDateChange,
  canUpload = false, onUpload,
  canManage = false, onDelete,
  onExport, exportBusy = false,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const hasFilters = Boolean(query || unresolvedOnly || participant || tag || dateFrom || dateTo);

  const toolbar = (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <DebouncedField
          value={query}
          onCommit={onQueryChange}
          placeholder="Поиск по названию"
          aria-label="Поиск протоколов"
          sx={{ minWidth: 200, flex: { xs: '1 1 100%', sm: '0 1 280px' } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment>
            ),
          }}
        />
        <Chip
          size="small"
          variant={unresolvedOnly ? 'filled' : 'outlined'}
          color={unresolvedOnly ? 'warning' : 'default'}
          icon={<PersonOffOutlinedIcon />}
          label="Без имени"
          onClick={() => onUnresolvedChange?.(!unresolvedOnly)}
          aria-pressed={unresolvedOnly}
        />
        <Tooltip title={order === 'desc' ? 'Сначала новые — нажмите для обратного порядка' : 'Сначала старые'}>
          <IconButton
            size="small"
            aria-label="Сменить сортировку по дате"
            onClick={() => onOrderChange?.(order === 'desc' ? 'asc' : 'desc')}
          >
            {order === 'desc' ? <ArrowDownwardOutlinedIcon fontSize="small" /> : <ArrowUpwardOutlinedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap' }}>
        <DebouncedField
          value={participant}
          onCommit={onParticipantChange}
          placeholder="Участник"
          aria-label="Фильтр по участнику"
          sx={{ minWidth: 160 }}
        />
        <DebouncedField
          value={tag}
          onCommit={onTagChange}
          placeholder="Тег"
          aria-label="Фильтр по тегу"
          sx={{ minWidth: 120 }}
        />
        <TextField
          size="small"
          type="date"
          label="С"
          value={dateFrom}
          onChange={(e) => onDateChange?.(e.target.value, dateTo)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 140 }}
        />
        <TextField
          size="small"
          type="date"
          label="По"
          value={dateTo}
          onChange={(e) => onDateChange?.(dateFrom, e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 140 }}
        />
        <Tooltip title="Скачать отчёты за выбранный период одним ZIP (до 20 протоколов)">
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadOutlinedIcon fontSize="small" />}
              disabled={exportBusy}
              onClick={onExport}
              sx={{ minHeight: 40 }}
            >
              {exportBusy ? 'Собираю…' : 'Экспорт ZIP'}
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );

  const emptyState = (
    <Paper sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="text.secondary" sx={{ mb: canUpload && !hasFilters ? 2 : 0 }}>
        {hasFilters
          ? 'Ничего не найдено — измените поиск или снимите фильтры.'
          : 'Здесь появятся готовые протоколы встреч. Загрузите первую запись через кнопку «Загрузить».'}
      </Typography>
      {canUpload && !hasFilters && (
        <Button variant="contained" onClick={onUpload}>Загрузить запись</Button>
      )}
    </Paper>
  );

  const pagination = (
    <TablePagination
      component="div"
      count={total || meetings.length}
      page={page}
      onPageChange={(_e, p) => onPageChange?.(p)}
      rowsPerPage={pageSize}
      rowsPerPageOptions={[pageSize]}
      labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`}
    />
  );

  if (loading && !meetings.length) {
    return (<>{toolbar}<MeetingsSkeleton /></>);
  }
  if (!meetings.length) {
    return (<>{toolbar}{emptyState}</>);
  }

  if (isMobile) {
    return (
      <Box>
        {toolbar}
        <Stack spacing={1}>
          {meetings.map((meeting) => (
            <Paper
              key={meeting.base_filename}
              variant="outlined"
              sx={{ p: 1.5, cursor: 'pointer' }}
              onClick={() => onOpen?.(meeting.base_filename)}
            >
              <Stack spacing={0.75}>
                <Typography variant="body2" fontWeight={600} noWrap>
                  {displayName(meeting.base_filename)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatTime(meeting.modified_at)} · реплик: {meeting.segments_count || '—'} · отчёты: {(meeting.reports || []).map((r) => r.ext).filter(Boolean).join(', ') || '—'}
                </Typography>
                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <SpeakerChip meeting={meeting} />
                  {meeting.project && <Chip size="small" color="info" variant="outlined" label={meeting.project} />}
                  {(meeting.tags || []).map((t) => <Chip key={t} size="small" variant="outlined" label={t} />)}
                  {canManage && (
                    <IconButton
                      size="small"
                      color="error"
                      aria-label="Удалить протокол"
                      onClick={(e) => { e.stopPropagation(); onDelete?.(meeting); }}
                    >
                      <DeleteOutlineOutlinedIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              </Stack>
            </Paper>
          ))}
        </Stack>
        {pagination}
      </Box>
    );
  }

  return (
    <Box>
      {toolbar}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Встреча</TableCell>
              <TableCell>Реплик</TableCell>
              <TableCell>Спикеры</TableCell>
              <TableCell>Отчёты</TableCell>
              <TableCell>Изменено</TableCell>
              <TableCell align="right">Открыть</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {meetings.map((meeting) => (
              <TableRow
                key={meeting.base_filename}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => onOpen?.(meeting.base_filename)}
              >
                <TableCell>
                  <Typography variant="body2" sx={{ maxWidth: 360 }} noWrap>
                    {displayName(meeting.base_filename)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 360 }}>
                    {meeting.base_filename}
                  </Typography>
                  {(meeting.project || (meeting.tags || []).length > 0) && (
                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                      {meeting.project && <Chip size="small" color="info" variant="outlined" label={meeting.project} />}
                      {(meeting.tags || []).map((t) => (
                        <Chip key={t} size="small" variant="outlined" label={t} />
                      ))}
                    </Stack>
                  )}
                </TableCell>
                <TableCell>{meeting.segments_count || '—'}</TableCell>
                <TableCell><SpeakerChip meeting={meeting} /></TableCell>
                <TableCell>
                  {(meeting.reports || []).map((r) => r.ext).filter(Boolean).join(', ') || '—'}
                </TableCell>
                <TableCell>{formatTime(meeting.modified_at)}</TableCell>
                <TableCell align="right">
                  <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Tooltip title="Открыть протокол">
                      <IconButton
                        size="small"
                        aria-label="Открыть протокол"
                        onClick={(e) => { e.stopPropagation(); onOpen?.(meeting.base_filename); }}
                      >
                        <OpenInNewOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {canManage && (
                      <Tooltip title="В корзину (30 дней)">
                        <IconButton
                          size="small"
                          color="error"
                          aria-label="Удалить протокол"
                          onClick={(e) => { e.stopPropagation(); onDelete?.(meeting); }}
                        >
                          <DeleteOutlineOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pagination}
      </TableContainer>
    </Box>
  );
}

export default VoiceMeetingsSection;
