import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Drawer,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  Close as CloseIcon,
  Download as DownloadIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';

const OBSERVATION_LABELS = {
  found_new: 'Найдено впервые',
  found_duplicate: 'Найдено повторно',
  deleted: 'Файл удалён',
  cleaned: 'Файл очищен',
  moved: 'Файл перемещён',
};

const RESOLVED_STATUS_LABELS = {
  resolved_deleted: 'Удалён',
  resolved_clean: 'Очищен',
  resolved_moved: 'Перемещён',
};

function formatTs(ts) {
  if (!ts) return '-';
  return new Date(Number(ts) * 1000).toLocaleString('ru-RU');
}

function formatTaskTimestamp(task) {
  if (!task) return '-';
  return formatTs(task.completed_at || task.updated_at || task.acked_at || task.delivered_at || task.created_at);
}

function taskStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'queued') return 'В очереди';
  if (normalized === 'delivered') return 'Доставлено агенту';
  if (normalized === 'acknowledged') return 'Выполняется';
  if (normalized === 'completed') return 'Завершено';
  if (normalized === 'failed') return 'Ошибка';
  if (normalized === 'expired') return 'Просрочено';
  return '-';
}

function taskStatusColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'acknowledged') return 'info';
  if (normalized === 'completed') return 'success';
  if (normalized === 'failed' || normalized === 'expired') return 'error';
  if (normalized === 'queued' || normalized === 'delivered') return 'warning';
  return 'default';
}

function fileStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return RESOLVED_STATUS_LABELS[normalized]
    || (normalized === 'new' ? 'Актуален' : (normalized === 'ack' ? 'ACK' : normalized || '-'));
}

function fileStatusColor(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'new') return 'warning';
  if (normalized === 'ack') return 'info';
  if (normalized.startsWith('resolved_')) return 'success';
  return 'default';
}

function observationLabel(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return OBSERVATION_LABELS[normalized] || normalized || '-';
}

function isForceScanTask(task) {
  const result = task?.result && typeof task.result === 'object' ? task.result : {};
  const payload = task?.payload && typeof task.payload === 'object' ? task.payload : {};
  return Boolean(result.force_rescan || payload.force_rescan);
}

function scanRunErrorText(run) {
  if (String(run?.status || '').trim().toLowerCase() !== 'failed') return '';
  const result = run?.result && typeof run.result === 'object' ? run.result : {};
  const failedJobs = Number(run?.failed_jobs_count || result.jobs_failed || 0);
  const failedJobErrors = String(run?.failed_job_errors || result.failed_job_errors || '').trim();
  if (failedJobs > 0 && failedJobErrors) return `Не обработано PDF: ${failedJobs}. ${failedJobErrors}`;
  if (failedJobs > 0) return `Не обработано PDF: ${failedJobs}. Проверьте ошибки заданий обработки PDF.`;
  return String(
    run?.error_text
      || result.error_text
      || result.error
      || result.message
      || 'Запуск скана завершился с ошибкой без подробного текста',
  ).trim();
}

function patternPayloadSummary(payload, patterns) {
  const selected = Array.isArray(payload?.server_pdf_pattern_ids) ? payload.server_pdf_pattern_ids.length : 0;
  const total = Array.isArray(patterns) ? patterns.length : 0;
  return total ? `PDF паттерны: ${selected} из ${total}` : '';
}

function inferFileExt(value) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  const name = text.split('/').pop() || '';
  const index = name.lastIndexOf('.');
  return index >= 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : '';
}

function getIncidentFileExt(incident) {
  return String(incident?.file_ext || inferFileExt(incident?.file_name) || inferFileExt(incident?.file_path) || '')
    .trim()
    .toLowerCase();
}

function getIncidentSourceKind(incident) {
  const source = String(incident?.source_kind || '').trim().toLowerCase();
  if (source) return source;
  const ext = getIncidentFileExt(incident);
  if (ext === 'pdf') return 'pdf';
  if (['txt', 'rtf', 'csv', 'json', 'xml', 'ini', 'conf', 'md', 'log'].includes(ext)) return 'text';
  return ext ? 'metadata' : '';
}

function IncidentFragments({ incident }) {
  const matches = Array.isArray(incident?.matched_patterns) ? incident.matched_patterns : [];
  if (matches.length === 0) {
    return <Typography variant="caption" color="text.secondary">Фрагменты не найдены</Typography>;
  }
  return (
    <Stack spacing={0.7}>
      {matches.slice(0, 6).map((item, index) => (
        <Paper key={`${incident.id || 'inc'}-${index}`} variant="outlined" sx={{ p: 0.8 }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            {item.pattern_name || item.pattern || 'pattern'}
          </Typography>
          {!!String(item.value || '').trim() && <Typography variant="caption" sx={{ display: 'block' }}>Значение: {String(item.value)}</Typography>}
          {!!String(item.snippet || '').trim() && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>Фрагмент: {String(item.snippet)}</Typography>}
        </Paper>
      ))}
    </Stack>
  );
}

function ObservationList({
  runId,
  bucket,
  loading,
  onLoadMore,
}) {
  const items = Array.isArray(bucket?.items) ? bucket.items : [];
  const total = Number(bucket?.total || 0);
  if (loading && items.length === 0) {
    return <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={22} /></Box>;
  }
  if (items.length === 0) {
    return <Typography variant="body2" color="text.secondary">Значимые изменения в этом запуске не найдены.</Typography>;
  }
  return (
    <Stack spacing={0.8}>
      {items.map((item) => (
        <Paper key={item.id} variant="outlined" sx={{ p: 1, borderRadius: 1.2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 700, wordBreak: 'break-all' }}>
                {item.file_path || '-'}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {item.source_kind || '-'} · {item.file_hash ? `hash ${String(item.file_hash).slice(0, 10)}` : 'hash -'}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexShrink: 0 }}>
              <Chip size="small" label={observationLabel(item.observation_type)} />
              {!!item.incident_status && <Chip size="small" color={fileStatusColor(item.incident_status)} label={fileStatusLabel(item.incident_status)} />}
            </Stack>
          </Stack>
        </Paper>
      ))}
      {items.length < total && (
        <Button type="button" size="small" variant="outlined" onClick={() => onLoadMore(runId)} disabled={loading}>
          {loading ? 'Загрузка...' : `Показать ещё · ${items.length} из ${total}`}
        </Button>
      )}
    </Stack>
  );
}

function ScanRunsTab({
  canScanRead,
  canScanAck,
  busyIncident,
  scanPatterns,
  runs,
  runsTotal,
  runsLoading,
  runsLoadingMore,
  selectedRunId,
  expandedRunId,
  observations,
  observationsLoadingId,
  exportingRunId,
  findings,
  findingsTotal,
  findingsLoading,
  findingsLoadingMore,
  onRefreshRuns,
  onLoadMoreRuns,
  onSelectRun,
  onToggleRun,
  onLoadMoreObservations,
  onExportRun,
  onAckIncident,
  onLoadMoreFindings,
  resolveIncidentMeta,
}) {
  const selectedRun = runs.find((run) => String(run?.id || '') === selectedRunId) || null;

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      <Paper variant="outlined" sx={{ p: 1.2, borderRadius: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>История запусков</Typography>
            <Typography variant="caption" color="text.secondary">Показано {runs.length} из {runsTotal}</Typography>
          </Box>
          <Button type="button" size="small" variant="outlined" onClick={onRefreshRuns} disabled={runsLoading}>Обновить</Button>
        </Stack>

        {runsLoading && runs.length === 0 ? (
          <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>
        ) : runs.length === 0 ? (
          <Typography color="text.secondary">Запусков скана по этому компьютеру пока нет.</Typography>
        ) : (
          <Stack spacing={1}>
            {runs.map((run) => {
              const runId = String(run.id || '');
              const counts = run.observation_counts || {};
              const expanded = expandedRunId === runId;
              const selected = selectedRunId === runId;
              const runError = scanRunErrorText(run);
              const toggleRun = () => {
                if (!selected) onSelectRun(runId);
                onToggleRun(runId);
              };
              return (
                <Paper
                  key={runId}
                  variant="outlined"
                  sx={{
                    borderRadius: 1,
                    overflow: 'hidden',
                    borderColor: selected ? 'primary.main' : (expanded ? 'primary.light' : 'divider'),
                    bgcolor: selected ? 'action.selected' : 'background.paper',
                  }}
                >
                  <Box sx={{ p: 1.2, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1fr) auto' }, gap: 1 }}>
                    <Box
                      role="button"
                      tabIndex={0}
                      onClick={toggleRun}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          toggleRun();
                        }
                      }}
                      sx={{ minWidth: 0, cursor: 'pointer' }}
                    >
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                          {isForceScanTask(run) ? 'Скан с 0' : 'Скан'} · {formatTaskTimestamp(run)}
                        </Typography>
                        <Chip size="small" color={taskStatusColor(run.status)} label={taskStatusLabel(run.status)} />
                      </Stack>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.3 }}>
                        проверено {Number(run.result?.scanned || 0)} · пропущено {Number(run.result?.skipped || 0)} · наблюдений {Number(counts.total || 0)}
                      </Typography>
                      {!!patternPayloadSummary(run.payload, scanPatterns) && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.2 }}>
                          {patternPayloadSummary(run.payload, scanPatterns)}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
                        <Chip size="small" label={`новые ${Number(counts.found_new || 0)}`} />
                        <Chip size="small" label={`повторно ${Number(counts.found_duplicate || 0)}`} />
                        <Chip size="small" color="success" label={`удалены ${Number(counts.deleted || 0)}`} />
                        <Chip size="small" color="success" label={`очищены ${Number(counts.cleaned || 0)}`} />
                        <Chip size="small" color="success" label={`перемещены ${Number(counts.moved || 0)}`} />
                      </Stack>
                      {!!runError && <Alert severity="error" sx={{ mt: 0.9, py: 0.2 }}><Typography variant="caption" sx={{ fontWeight: 700 }}>{runError}</Typography></Alert>}
                    </Box>
                    <Stack direction="row" spacing={0.8} sx={{ justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
                      <Button
                        type="button"
                        size="small"
                        variant="contained"
                        startIcon={exportingRunId === runId ? <CircularProgress size={15} color="inherit" /> : <DownloadIcon />}
                        disabled={!canScanRead || exportingRunId === runId}
                        onClick={(event) => onExportRun(event, run)}
                        sx={{ flex: { xs: 1, sm: '0 0 auto' } }}
                      >
                        {exportingRunId === runId ? 'Готовлю...' : 'Excel'}
                      </Button>
                      <Button type="button" size="small" variant="outlined" aria-label={expanded ? 'Свернуть детали запуска' : 'Развернуть детали запуска'} onClick={toggleRun} sx={{ minWidth: 40, px: 0.6 }}>
                        <ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 160ms ease' }} />
                      </Button>
                    </Stack>
                  </Box>
                  <Collapse in={expanded} timeout="auto" unmountOnExit>
                    <Box sx={{ px: 1.2, pb: 1.2 }}>
                      <ObservationList
                        runId={runId}
                        bucket={observations[runId]}
                        loading={observationsLoadingId === runId}
                        onLoadMore={onLoadMoreObservations}
                      />
                    </Box>
                  </Collapse>
                </Paper>
              );
            })}
            {runs.length < runsTotal && (
              <Button type="button" size="small" variant="outlined" onClick={onLoadMoreRuns} disabled={runsLoadingMore}>
                {runsLoadingMore ? 'Загрузка...' : 'Показать ещё запуски'}
              </Button>
            )}
          </Stack>
        )}
      </Paper>

      {selectedRun ? (
        <>
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6}>
              <Paper variant="outlined" sx={{ p: 1.4, height: '100%', borderRadius: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Файлов с находками</Typography>
                <Typography variant="h5" sx={{ fontWeight: 800 }}>{findingsTotal}</Typography>
                <Typography variant="caption" color="text.secondary">Уникальные записи находок, созданные выбранным запуском.</Typography>
              </Paper>
            </Grid>
            <Grid item xs={12} sm={6}>
              <Paper variant="outlined" sx={{ p: 1.4, height: '100%', borderRadius: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Наблюдений</Typography>
                <Typography variant="h5" sx={{ fontWeight: 800 }}>{Number(selectedRun.observation_counts?.total || 0)}</Typography>
                <Typography variant="caption" color="text.secondary">Все изменения: новые, повторные, удалённые, очищенные и перемещённые файлы.</Typography>
              </Paper>
            </Grid>
          </Grid>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Находки выбранного запуска</Typography>
              <Typography variant="caption" color="text.secondary">{formatTaskTimestamp(selectedRun)}</Typography>
            </Box>
            <Button
              type="button"
              size="small"
              variant="contained"
              startIcon={exportingRunId === selectedRunId ? <CircularProgress size={15} color="inherit" /> : <DownloadIcon />}
              disabled={!canScanRead || exportingRunId === selectedRunId}
              onClick={(event) => onExportRun(event, selectedRun)}
            >
              {exportingRunId === selectedRunId ? 'Готовлю...' : 'Экспорт Excel'}
            </Button>
          </Stack>
          <IncidentList
            incidents={findings}
            total={findingsTotal}
            loading={findingsLoading}
            loadingMore={findingsLoadingMore}
            emptyText="В выбранном запуске находок нет."
            canScanAck={canScanAck}
            busyIncident={busyIncident}
            onAckIncident={onAckIncident}
            onLoadMore={onLoadMoreFindings}
            resolveIncidentMeta={resolveIncidentMeta}
          />
        </>
      ) : (
        <Alert severity="info">Выберите запуск, чтобы увидеть его метрики, наблюдения, находки и экспорт.</Alert>
      )}
    </Stack>
  );
}

function IncidentList({
  incidents,
  total,
  loading,
  loadingMore,
  emptyText,
  canScanAck,
  busyIncident,
  onAckIncident,
  onLoadMore,
  resolveIncidentMeta,
}) {
  if (loading) {
    return <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress size={30} /></Box>;
  }
  if (incidents.length === 0) return <Typography color="text.secondary">{emptyText}</Typography>;
  return (
    <Stack spacing={1.3}>
      {incidents.map((incident) => {
        const meta = resolveIncidentMeta?.(incident) || {};
        return (
          <Paper key={incident.id} variant="outlined" sx={{ p: 1.2 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 0.6 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{incident.severity || '-'} · {formatTs(incident.created_at)}</Typography>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip size="small" color={fileStatusColor(incident.status)} label={fileStatusLabel(incident.status)} />
                {canScanAck && String(incident.status || '').toLowerCase() === 'new' && (
                  <Button type="button" size="small" variant="outlined" disabled={busyIncident === incident.id} onClick={() => onAckIncident(incident)}>ACK</Button>
                )}
              </Stack>
            </Stack>
            <Typography variant="body2" sx={{ mb: 0.8, overflowWrap: 'anywhere' }}>{incident.file_path || '-'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
              Тип: {getIncidentFileExt(incident) || '-'} · Источник: {getIncidentSourceKind(incident) || '-'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
              {meta.branch || incident.branch || 'Без филиала'} · {meta.user || incident.user_full_name || incident.user_login || '-'} · IP: {meta.ip || incident.ip_address || '-'}
            </Typography>
            <IncidentFragments incident={incident} />
          </Paper>
        );
      })}
      {incidents.length < total && (
        <Button type="button" size="small" variant="outlined" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? 'Загрузка...' : `Загрузить ещё · ${incidents.length} из ${total}`}
        </Button>
      )}
    </Stack>
  );
}

function AllFindingsTab({
  incidents,
  total,
  loading,
  loadingMore,
  newCount,
  canScanAck,
  busyIncident,
  busyAckAll,
  filters,
  sourceOptions,
  patternOptions,
  onFilterChange,
  onToggleFragments,
  onAckAll,
  onAckIncident,
  onLoadMore,
  resolveIncidentMeta,
}) {
  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
        <Chip size="small" color={newCount > 0 ? 'warning' : 'default'} label={`Непросмотренных: ${newCount}`} />
        <Chip size="small" variant="outlined" label={`Находок за всё время: ${total}`} />
        <Button type="button" size="small" variant="contained" onClick={onAckAll} disabled={!canScanAck || loading || busyAckAll || newCount === 0}>Просмотрено всё</Button>
        <Button type="button" size="small" variant={filters.hasFragment ? 'contained' : 'outlined'} onClick={onToggleFragments}>Только с фрагментами</Button>
      </Stack>
      <Grid container spacing={1.2}>
        <Grid item xs={12}>
          <FormControl size="small" fullWidth>
            <InputLabel id="host-pattern-filter-label">Тип находки на этом компьютере</InputLabel>
            <Select labelId="host-pattern-filter-label" value={filters.patternId} label="Тип находки на этом компьютере" onChange={(event) => onFilterChange('patternId', event.target.value)}>
              <MenuItem value="all">Все правила</MenuItem>
              {(Array.isArray(patternOptions) ? patternOptions : []).map((pattern) => (
                <MenuItem key={pattern.id} value={pattern.id}>{pattern.name || pattern.id}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12}>
          <TextField size="small" fullWidth label="Поиск по пути/фрагменту/паттерну" value={filters.q} onChange={(event) => onFilterChange('q', event.target.value)} />
        </Grid>
        <Grid item xs={6}>
          <FormControl size="small" fullWidth>
            <InputLabel>Статус</InputLabel>
            <Select value={filters.status} label="Статус" onChange={(event) => onFilterChange('status', event.target.value)}>
              <MenuItem value="all">Все</MenuItem><MenuItem value="new">NEW</MenuItem><MenuItem value="ack">ACK</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={6}>
          <FormControl size="small" fullWidth>
            <InputLabel>Severity</InputLabel>
            <Select value={filters.severity} label="Severity" onChange={(event) => onFilterChange('severity', event.target.value)}>
              <MenuItem value="all">Все</MenuItem><MenuItem value="high">High</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="low">Low</MenuItem>
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={6}>
          <FormControl size="small" fullWidth>
            <InputLabel>Источник</InputLabel>
            <Select value={filters.sourceKind} label="Источник" onChange={(event) => onFilterChange('sourceKind', event.target.value)}>
              <MenuItem value="all">Все</MenuItem>
              {sourceOptions.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={6}><TextField size="small" fullWidth label="Расширение файла" value={filters.fileExt} onChange={(event) => onFilterChange('fileExt', event.target.value)} placeholder="pdf/txt/docx" /></Grid>
        <Grid item xs={6}><TextField size="small" fullWidth type="date" label="Дата с" value={filters.dateFrom} onChange={(event) => onFilterChange('dateFrom', event.target.value)} InputLabelProps={{ shrink: true }} /></Grid>
        <Grid item xs={6}><TextField size="small" fullWidth type="date" label="Дата по" value={filters.dateTo} onChange={(event) => onFilterChange('dateTo', event.target.value)} InputLabelProps={{ shrink: true }} /></Grid>
      </Grid>
      <IncidentList
        incidents={incidents}
        total={total}
        loading={loading}
        loadingMore={loadingMore}
        emptyText="Инциденты по текущим фильтрам не найдены."
        canScanAck={canScanAck}
        busyIncident={busyIncident}
        onAckIncident={onAckIncident}
        onLoadMore={onLoadMore}
        resolveIncidentMeta={resolveIncidentMeta}
      />
    </Stack>
  );
}

export default function HostDrawer({
  open,
  host,
  activeTab,
  onClose,
  onTabChange,
  scanRuns,
  scanRunsTotal,
  scanRunsLoading,
  scanRunsLoadingMore,
  selectedRunId,
  expandedRunId,
  observations,
  observationsLoadingId,
  exportingRunId,
  scanPatterns,
  incidentPatternOptions,
  incidents,
  incidentsTotal,
  incidentsLoading,
  incidentsLoadingMore,
  newCount,
  canScanRead,
  canScanAck,
  busyIncident,
  busyAckAll,
  filters,
  sourceOptions,
  onRefreshRuns,
  onLoadMoreRuns,
  onSelectRun,
  onToggleRun,
  onLoadMoreObservations,
  onExportRun,
  onFilterChange,
  onToggleFragments,
  onAckAll,
  onAckIncident,
  onLoadMoreIncidents,
  resolveIncidentMeta,
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 760, md: 860 }, maxWidth: '100vw' } }}
    >
      <Box sx={{ p: { xs: 1.5, sm: 2.2 } }}>
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>Карточка расследования</Typography>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>{host || 'Компьютер'}</Typography>
            <Typography variant="body2" color="text.secondary">Запуски сканирования, изменения файлов и подтверждённые находки.</Typography>
          </Box>
          <IconButton type="button" aria-label="Закрыть карточку компьютера" onClick={onClose} edge="end">
            <CloseIcon />
          </IconButton>
        </Stack>
        <Tabs
          value={activeTab}
          onChange={(_, value) => onTabChange(value)}
          variant="fullWidth"
          sx={{ mt: 1.5, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="runs" label="Запуски скана" />
          <Tab value="findings" label="Все находки" />
        </Tabs>
        {activeTab === 'runs' ? (
          <ScanRunsTab
            canScanRead={canScanRead}
            canScanAck={canScanAck}
            busyIncident={busyIncident}
            scanPatterns={scanPatterns}
            runs={scanRuns}
            runsTotal={scanRunsTotal}
            runsLoading={scanRunsLoading}
            runsLoadingMore={scanRunsLoadingMore}
            selectedRunId={selectedRunId}
            expandedRunId={expandedRunId}
            observations={observations}
            observationsLoadingId={observationsLoadingId}
            exportingRunId={exportingRunId}
            findings={incidents}
            findingsTotal={incidentsTotal}
            findingsLoading={incidentsLoading}
            findingsLoadingMore={incidentsLoadingMore}
            onRefreshRuns={onRefreshRuns}
            onLoadMoreRuns={onLoadMoreRuns}
            onSelectRun={onSelectRun}
            onToggleRun={onToggleRun}
            onLoadMoreObservations={onLoadMoreObservations}
            onExportRun={onExportRun}
            onAckIncident={onAckIncident}
            onLoadMoreFindings={onLoadMoreIncidents}
            resolveIncidentMeta={resolveIncidentMeta}
          />
        ) : (
          <AllFindingsTab
            incidents={incidents}
            total={incidentsTotal}
            loading={incidentsLoading}
            loadingMore={incidentsLoadingMore}
            newCount={newCount}
            canScanAck={canScanAck}
            busyIncident={busyIncident}
            busyAckAll={busyAckAll}
            filters={filters}
            sourceOptions={sourceOptions}
            patternOptions={incidentPatternOptions}
            onFilterChange={onFilterChange}
            onToggleFragments={onToggleFragments}
            onAckAll={onAckAll}
            onAckIncident={onAckIncident}
            onLoadMore={onLoadMoreIncidents}
            resolveIncidentMeta={resolveIncidentMeta}
          />
        )}
      </Box>
    </Drawer>
  );
}
