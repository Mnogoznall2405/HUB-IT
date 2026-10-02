import React, { memo, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  LinearProgress,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Popover,
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
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined';
import FilterAltOutlinedIcon from '@mui/icons-material/FilterAltOutlined';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined';
import ArrowUpwardOutlinedIcon from '@mui/icons-material/ArrowUpwardOutlined';
import ArrowDownwardOutlinedIcon from '@mui/icons-material/ArrowDownwardOutlined';
import MoreVertOutlinedIcon from '@mui/icons-material/MoreVertOutlined';
import { voiceJobsAPI } from '../../api/voiceJobs';

// N14: секунды в мете не нужны — «29.09.2026, 15:00» вместо «15:00:00».
const formatTime = (value) => {
  if (!value) return '—';
  const date = Number.isFinite(Number(value))
    ? new Date(Number(value) * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', {
    hour12: false,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const displayName = (base) => String(base || '').replace(/^j[0-9a-f]{12}_/, '');
const MAX_VISIBLE_TAGS = 3;
// T45: на xs в строке карточки — не больше двух чипов тегов + «+N».
const MAX_VISIBLE_TAGS_XS = 2;

// T45: статус обработки протокола — текстовый чип, не только цвет.
// Приоритет: идущая/стоящая в очереди задача > упавшая > нужны имена > готово.
const meetingStatus = (meeting, jobs) => {
  const related = (jobs || []).filter(
    (j) => (j.base_filename || j.result?.base_filename) === meeting.base_filename,
  );
  if (related.some((j) => ['queued', 'processing'].includes(j.status))) {
    return { label: 'В обработке', color: 'primary', filled: true };
  }
  if (related.some((j) => j.status === 'failed')) {
    return { label: 'Ошибка', color: 'error', filled: false };
  }
  if (meeting.unresolved_count > 0) {
    return { label: 'Нужны имена', color: 'warning', filled: false };
  }
  return { label: 'Готово', color: 'success', filled: false };
};

const MeetingStatusChip = ({ meeting, jobs }) => {
  const status = meetingStatus(meeting, jobs);
  return (
    <Chip
      size="small"
      data-testid="meeting-status"
      color={status.color}
      variant={status.filled ? 'filled' : 'outlined'}
      label={status.label === 'Нужны имена'
        ? `Нужны имена · ${meeting.unresolved_count}`
        : status.label}
      icon={status.label === 'Нужны имена' ? <PersonOffOutlinedIcon /> : undefined}
      sx={{ flex: '0 0 auto', height: 22 }}
    />
  );
};

// Меню «⋮» протокола: удаление остаётся gated по voice.manage и вызывается
// через onDelete, который на странице спрашивает подтверждение (T22).
function ProtocolMenu({ meeting, canManage, busy, onDelete }) {
  const [anchor, setAnchor] = useState(null);
  const name = displayName(meeting.base_filename);
  if (!canManage) return null;
  return (
    <>
      <IconButton
        size="small"
        aria-label={`Действия с протоколом ${name}`}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? `voice-protocol-menu-${meeting.base_filename}` : undefined}
        onClick={(e) => { e.stopPropagation(); setAnchor(e.currentTarget); }}
        sx={{ '@media (pointer: coarse)': { width: 44, height: 44 } }}
      >
        <MoreVertOutlinedIcon fontSize="small" />
      </IconButton>
      <Menu
        id={`voice-protocol-menu-${meeting.base_filename}`}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {/* T54: отчёты доступны из меню строки — отдельная колонка не нужна. */}
        {(meeting.reports || []).map((r) => (
          <MenuItem
            key={r.name || r.ext}
            component="a"
            href={r.name ? voiceJobsAPI.reportUrl(meeting.base_filename, r.name) : undefined}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => { e.stopPropagation(); setAnchor(null); }}
          >
            <ListItemIcon><DownloadOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={`Отчёт ${r.name || r.ext}`} />
          </MenuItem>
        ))}
        {(meeting.reports || []).length > 0 && <Divider />}
        <MenuItem
          disabled={busy}
          // Меню рендерится в портале: без stopPropagation клик всплывает по
          // React-дереву и открывает карточку протокола.
          onClick={(e) => {
            e.stopPropagation();
            setAnchor(null);
            onDelete?.(meeting);
          }}
        >
          <ListItemIcon><DeleteOutlineOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Удалить протокол" />
        </MenuItem>
      </Menu>
    </>
  );
}

// Русские склонения для числительных: 1 участник, 2 участника, 5 участников (T23).
export function plural(n, forms) {
  const abs = Math.abs(Number(n) || 0) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

const MetaLine = ({ meeting }) => {
  const count = meeting.segments_count;
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      noWrap
      sx={{ display: 'block', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}
    >
      {[
        formatTime(meeting.modified_at),
        count ? `${count} ${plural(count, ['реплика', 'реплики', 'реплик'])}` : null,
      ].filter(Boolean).join(' · ')}
    </Typography>
  );
};

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

function DebouncedField({ value, onCommit, onDraftChange, ...props }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft !== (value || '')) onCommit?.(draft);
    }, 400);
    return () => clearTimeout(t);
  }, [draft, value, onCommit]);
  return (
    <TextField
      size="small"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        onDraftChange?.(e.target.value);
      }}
      {...props}
    />
  );
}

function VoiceMeetingsSection({
  meetings = [], total = 0, page = 0, pageSize = 20, onPageChange, onOpen,
  loading = false, error = '', query = '', onQueryChange,
  unresolvedOnly = false, onUnresolvedChange,
  order = 'desc', onOrderChange,
  participant = '', onParticipantChange,
  tag = '', onTagChange,
  dateFrom = '', dateTo = '', onDateChange,
  canUpload = false, onUpload,
  canManage = false, onDelete,
  busyBase = null,
  jobs = [],
  onExport, exportBusy = false,
  exportCount = null, exportCountLoading = false, exportCountError = false,
  exportMaxMeetings = 20,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersAnchor, setFiltersAnchor] = useState(null);
  const [overflowAnchor, setOverflowAnchor] = useState(null);
  // N15: якорь панели фильтров — кнопка «Фильтры», чтобы открытие из меню «⋮»
  // не оставляло Popover без anchorEl.
  const filtersButtonRef = useRef(null);
  const [participantDraft, setParticipantDraft] = useState(participant || '');
  const [tagDraft, setTagDraft] = useState(tag || '');
  useEffect(() => setParticipantDraft(participant || ''), [participant]);
  useEffect(() => setTagDraft(tag || ''), [tag]);
  const closeFilters = () => {
    if (participantDraft !== (participant || '')) onParticipantChange?.(participantDraft);
    if (tagDraft !== (tag || '')) onTagChange?.(tagDraft);
    setFiltersOpen(false);
    setFiltersAnchor(null);
  };
  const hasFilters = Boolean(query || unresolvedOnly || participant || tag || dateFrom || dateTo);
  const activeFilterCount = [
    query, unresolvedOnly, participant, tag, dateFrom, dateTo,
  ].filter(Boolean).length;
  const activeFilterChips = hasFilters && (
    <Box
      aria-label="Активные фильтры"
      sx={{
        display: 'flex',
        flexWrap: 'nowrap',
        gap: 0.75,
        mt: 1,
        overflowX: 'auto',
        '& > *': { flex: '0 0 auto' },
      }}
    >
      {query && (
        <Chip
          size="small"
          variant="outlined"
          label={`Поиск: ${query}`}
          onDelete={() => onQueryChange?.('')}
        />
      )}
      {unresolvedOnly && (
        <Chip
          size="small"
          color="warning"
          label="Без имени"
          onDelete={() => onUnresolvedChange?.(false)}
        />
      )}
      {participant && (
        <Chip
          size="small"
          variant="outlined"
          label={`Участник: ${participant}`}
          onDelete={() => onParticipantChange?.('')}
        />
      )}
      {tag && (
        <Chip
          size="small"
          variant="outlined"
          label={`Тег: ${tag}`}
          onDelete={() => onTagChange?.('')}
        />
      )}
      {dateFrom && (
        <Chip
          size="small"
          variant="outlined"
          label={`Дата от: ${dateFrom}`}
          onDelete={() => onDateChange?.('', dateTo)}
        />
      )}
      {dateTo && (
        <Chip
          size="small"
          variant="outlined"
          label={`Дата до: ${dateTo}`}
          onDelete={() => onDateChange?.(dateFrom, '')}
        />
      )}
    </Box>
  );

  // Плотное поле поиска (T21/T24): высота ≤ 44 px, подпись не переносится.
  // Плотные поля фильтров (T24): высота ≤ 44 px, подпись не переносится.
  const denseFieldSx = {
    maxHeight: '44px',
    '& .MuiInputBase-root': { height: 40 },
    '& .MuiInputBase-input': { padding: '8px 10px' },
    '& .MuiInputLabel-root': { whiteSpace: 'nowrap' },
    '& .MuiSelect-select': { height: 40, display: 'flex', alignItems: 'center', paddingTop: 0, paddingBottom: 0 },
  };
  const searchField = (
    <DebouncedField
      value={query}
      onCommit={onQueryChange}
      placeholder="Поиск"
      inputProps={{ 'aria-label': 'Поиск протоколов' }}
      sx={{
        minWidth: 0,
        flex: '1 1 140px',
        maxHeight: 44,
        '& .MuiInputBase-root': { height: 40 },
        '& .MuiInputBase-input': { padding: '8px 10px' },
        '& .MuiInputLabel-root': { whiteSpace: 'nowrap' },
      }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start"><SearchOutlinedIcon fontSize="small" /></InputAdornment>
        ),
      }}
    />
  );
  const unresolvedFilter = (
    <Chip
      size="small"
      variant={unresolvedOnly ? 'filled' : 'outlined'}
      color={unresolvedOnly ? 'warning' : 'default'}
      icon={<PersonOffOutlinedIcon />}
      label="Без имени"
      onClick={() => onUnresolvedChange?.(!unresolvedOnly)}
      aria-pressed={unresolvedOnly}
      sx={{ '@media (pointer: coarse)': { height: 44 } }}
    />
  );
  const orderFilter = (
    <Tooltip title={order === 'desc' ? 'Сначала новые — нажмите для обратного порядка' : 'Сначала старые'}>
      <IconButton
        size="small"
        aria-label="Сменить сортировку по дате"
        aria-pressed={order === 'asc'}
        onClick={() => onOrderChange?.(order === 'desc' ? 'asc' : 'desc')}
        sx={{ '@media (pointer: coarse)': { width: 44, height: 44 } }}
      >
        {order === 'desc' ? <ArrowDownwardOutlinedIcon fontSize="small" /> : <ArrowUpwardOutlinedIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
  const participantFilter = (
    <DebouncedField
      value={participant}
      onCommit={onParticipantChange}
      onDraftChange={setParticipantDraft}
      placeholder="Участник"
      inputProps={{ 'aria-label': 'Фильтр по участнику' }}
      sx={{ minWidth: 160, ...denseFieldSx }}
    />
  );
  const tagFilter = (
    <DebouncedField
      value={tag}
      onCommit={onTagChange}
      onDraftChange={setTagDraft}
      placeholder="Тег"
      inputProps={{ 'aria-label': 'Фильтр по тегу' }}
      sx={{ minWidth: 120, ...denseFieldSx }}
    />
  );
  const dateFilters = (
    <>
      <TextField
        size="small"
        type="date"
        label="Дата от"
        value={dateFrom}
        onChange={(e) => onDateChange?.(e.target.value, dateTo)}
        InputLabelProps={{ shrink: true }}
        sx={{ width: 140, ...denseFieldSx }}
      />
      <TextField
        size="small"
        type="date"
        label="Дата до"
        value={dateTo}
        onChange={(e) => onDateChange?.(dateFrom, e.target.value)}
        InputLabelProps={{ shrink: true }}
        sx={{ width: 140, ...denseFieldSx }}
      />
    </>
  );
  // Счётчик и предупреждение о лимите живут в пунктах меню «⋮», а не отдельной строкой (T21).
  const exportCountLabel = exportCountError
    ? 'Количество протоколов недоступно. Экспорт всё равно доступен.'
    : exportCountLoading
      ? 'Подсчёт протоколов…'
      : exportCount != null
        ? `Будет выгружено ${Math.min(exportCount, exportMaxMeetings)} из ${exportCount} протоколов`
        : '';
  const exportLimitNote = !exportCountError && exportCount != null && exportCount > exportMaxMeetings
    ? `Экспорт ограничен ${exportMaxMeetings} протоколами.`
    : '';

  const overflowMenu = (
    <>
      <Tooltip title="Экспорт, сортировка и фильтры">
        <IconButton
          size="small"
          aria-label="Действия со списком протоколов"
          aria-haspopup="menu"
          aria-expanded={overflowAnchor ? 'true' : undefined}
          aria-controls={overflowAnchor ? 'voice-meetings-overflow-menu' : undefined}
          onClick={(e) => setOverflowAnchor(e.currentTarget)}
          sx={{ '@media (pointer: coarse)': { width: 44, height: 44 } }}
        >
          <MoreVertOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        id="voice-meetings-overflow-menu"
        anchorEl={overflowAnchor}
        open={Boolean(overflowAnchor)}
        onClose={() => setOverflowAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem
          disabled={exportBusy}
          onClick={() => { setOverflowAnchor(null); onExport?.(); }}
          sx={{ maxWidth: 320, whiteSpace: 'normal' }}
        >
          <ListItemIcon><DownloadOutlinedIcon fontSize="small" /></ListItemIcon>
          {/* N16: примечание о лимите — часть подписи пункта «Экспорт ZIP»,
              а не отдельный блёклый disabled-пункт меню. */}
          <ListItemText
            primary={exportBusy ? 'Собираю…' : 'Экспорт ZIP'}
            secondary={[exportCountLabel, exportLimitNote].filter(Boolean).join(' ') || null}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem
          onClick={() => { setOverflowAnchor(null); onOrderChange?.(order === 'desc' ? 'asc' : 'desc'); }}
          sx={{ maxWidth: 320, whiteSpace: 'normal' }}
        >
          <ListItemIcon>
            {order === 'desc' ? <ArrowDownwardOutlinedIcon fontSize="small" /> : <ArrowUpwardOutlinedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText
            primary="Сортировка по дате"
            secondary={order === 'desc' ? 'Сначала новые' : 'Сначала старые'}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </MenuItem>
        <MenuItem
          onClick={() => { setOverflowAnchor(null); setFiltersOpen(true); }}
          sx={{ maxWidth: 320, whiteSpace: 'normal' }}
        >
          <ListItemIcon><FilterAltOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Фильтры" secondary={`Активно: ${activeFilterCount}`} secondaryTypographyProps={{ variant: 'caption' }} />
        </MenuItem>
      </Menu>
    </>
  );

  const filtersPanel = (
    <Box
      sx={{ '@media (pointer: coarse)': { '& .MuiIconButton-root': { width: 44, height: 44 } } }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        {unresolvedFilter}
        {participantFilter}
        {tagFilter}
        {dateFilters}
        {orderFilter}
      </Box>
    </Box>
  );

  const toolbar = (
    <Box sx={{ mb: 0.25 }}>
      <Box sx={{ display: 'flex', flexWrap: 'nowrap', gap: 1, alignItems: 'center' }}>
        {searchField}
        <Button
          ref={filtersButtonRef}
          size="small"
          variant="outlined"
          aria-expanded={filtersOpen}
          aria-controls="voice-meetings-filters"
          onClick={(e) => { setFiltersAnchor(e.currentTarget); setFiltersOpen(true); }}
          sx={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
        >
          {activeFilterCount > 0 ? `Фильтры (${activeFilterCount})` : 'Фильтры'}
        </Button>
        {overflowMenu}
      </Box>
      {activeFilterChips}
      {isMobile ? (
        <Drawer
          anchor="bottom"
          open={filtersOpen}
          onClose={closeFilters}
          PaperProps={{
            sx: {
              maxHeight: '85vh',
              overflowY: 'auto',
              borderTopLeftRadius: 2,
              borderTopRightRadius: 2,
              p: 2,
            },
          }}
        >
          <Box
            role="dialog"
            id="voice-meetings-filters"
            aria-labelledby="voice-meetings-filters-title"
            sx={{ '@media (pointer: coarse)': { '& .MuiIconButton-root': { width: 44, height: 44 } } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography id="voice-meetings-filters-title" variant="h6">Фильтры</Typography>
              <IconButton aria-label="Закрыть фильтры" onClick={closeFilters}>
                <CloseOutlinedIcon />
              </IconButton>
            </Box>
            {filtersPanel}
          </Box>
        </Drawer>
      ) : (
        <Popover
          open={filtersOpen}
          onClose={closeFilters}
          anchorEl={filtersAnchor ?? filtersButtonRef.current}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{ paper: { sx: { p: 2, maxWidth: 'calc(100vw - 32px)' } } }}
        >
          <Box
            role="dialog"
            id="voice-meetings-filters"
            aria-labelledby="voice-meetings-filters-title"
            sx={{ '@media (pointer: coarse)': { '& .MuiIconButton-root': { width: 44, height: 44 } } }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography id="voice-meetings-filters-title" variant="h6">Фильтры</Typography>
              <IconButton aria-label="Закрыть фильтры" onClick={closeFilters}>
                <CloseOutlinedIcon />
              </IconButton>
            </Box>
            {filtersPanel}
          </Box>
        </Popover>
      )}
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
    // При ошибке не показываем пустое состояние и CTA — сообщение об ошибке выводится отдельно.
    return (<>{toolbar}{error ? null : emptyState}</>);
  }

  // Данные уже на экране, но идёт перезагрузка (фильтры, страница, «Обновить») — показываем индикатор.
  const busyIndicator = loading ? <LinearProgress sx={{ mb: 1.5 }} /> : null;

  if (isMobile) {
    return (
      <Box>
        {toolbar}
        {busyIndicator}
        <Stack spacing={0.75}>
          {meetings.map((meeting) => {
            const tags = [meeting.project, ...(meeting.tags || [])].filter(Boolean);
            const shown = tags.slice(0, MAX_VISIBLE_TAGS_XS);
            const rest = tags.length - shown.length;
            return (
              <Paper
                key={meeting.base_filename}
                variant="outlined"
                sx={{ p: 1, cursor: 'pointer' }}
                onClick={() => onOpen?.(meeting.base_filename)}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Button
                      type="button"
                      color="inherit"
                      aria-label={`Открыть протокол ${displayName(meeting.base_filename)}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen?.(meeting.base_filename);
                      }}
                      sx={{
                        alignSelf: 'flex-start',
                        flex: '1 1 auto',
                        minWidth: 0,
                        maxWidth: '100%',
                        display: 'block',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        p: 0,
                        justifyContent: 'flex-start',
                        textAlign: 'left',
                        fontWeight: 600,
                        textTransform: 'none',
                      }}
                      title={meeting.base_filename}
                    >
                      {displayName(meeting.base_filename)}
                    </Button>
                    {/* N18/T45: статус обработки — текстовый чип рядом с названием,
                        чтобы мета-строка не обрезала важное на 320 px. */}
                    <MeetingStatusChip meeting={meeting} jobs={jobs} />
                    </Box>
                    <MetaLine meeting={meeting} />
                    {(shown.length > 0 || rest > 0) && (
                      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden', mt: 0.25 }}>
                        {/* N18: чипы тегов сжимаются с ellipsis, поэтому «+N»
                            всегда виден и строка не режется посреди чипа. */}
                        {shown.map((t) => (
                          <Chip key={t} size="small" variant="outlined" label={t} style={{ flexGrow: 0, flexShrink: 1, flexBasis: 'auto', minWidth: 0, maxWidth: 120 }} />
                        ))}
                        {rest > 0 && (
                          <Chip size="small" variant="outlined" label={`+${rest}`} style={{ flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }} />
                        )}
                      </Box>
                    )}
                  </Box>
                  <ProtocolMenu
                    meeting={meeting}
                    canManage={canManage}
                    busy={busyBase === meeting.base_filename}
                    onDelete={onDelete}
                  />
                </Box>
              </Paper>
            );
          })}
        </Stack>
        {pagination}
      </Box>
    );
  }

  return (
    <Box>
      {toolbar}
      {busyIndicator}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Встреча</TableCell>
              <TableCell align="right">Реплик</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Изменено</TableCell>
              <TableCell align="center" sx={{ width: 56 }}>Действия</TableCell>
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
                  <Button
                    type="button"
                    variant="text"
                    color="inherit"
                    aria-label={`Открыть протокол ${displayName(meeting.base_filename)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen?.(meeting.base_filename);
                    }}
                    sx={{
                      minWidth: 0,
                      maxWidth: 360,
                      display: 'block',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      p: 0,
                      justifyContent: 'flex-start',
                      textAlign: 'left',
                      textTransform: 'none',
                    }}
                    title={meeting.base_filename}
                  >
                    {displayName(meeting.base_filename)}
                  </Button>
                  {(() => {
                    // N14: десктопные чипы ограничены тремя — как на мобильной
                    // карточке; проект идёт первым (сохраняет цветовое отличие).
                    const chips = [
                      meeting.project && { label: meeting.project, color: 'info' },
                      ...(meeting.tags || []).map((t) => ({ label: t, color: 'default' })),
                    ].filter(Boolean);
                    if (!chips.length) return null;
                    const shown = chips.slice(0, MAX_VISIBLE_TAGS);
                    const rest = chips.length - shown.length;
                    return (
                      <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                        {shown.map((c) => (
                          <Chip key={c.label} size="small" color={c.color} variant="outlined" label={c.label} />
                        ))}
                        {rest > 0 && <Chip size="small" variant="outlined" label={`+${rest}`} />}
                      </Box>
                    );
                  })()}
                </TableCell>
                <TableCell align="right">{meeting.segments_count || '—'}</TableCell>
                {/* T45: статус обработки — текстовый чип (готово / нужны имена /
                    в обработке / ошибка), а не только цвет. */}
                <TableCell><MeetingStatusChip meeting={meeting} jobs={jobs} /></TableCell>
                <TableCell>{formatTime(meeting.modified_at)}</TableCell>
                <TableCell align="center" sx={{ width: 56 }}>
                  <ProtocolMenu
                    meeting={meeting}
                    canManage={canManage}
                    busy={busyBase === meeting.base_filename}
                    onDelete={onDelete}
                  />
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

// T46: memo — открытие карточки (selectedMeeting) не трогает список.
export default memo(VoiceMeetingsSection);
