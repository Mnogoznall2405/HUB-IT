import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  DoneOutlined as DoneOutlinedIcon,
  ExpandMore as ExpandMoreIcon,
  FactCheckOutlined as FactCheckOutlinedIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { FixedSizeList as VirtualList } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';

function sourceLabel(value) {
  const source = String(value || '').toLowerCase();
  if (source.includes('ocr')) return 'OCR';
  if (source.includes('text') || source === 'pdf') return 'Текстовый слой / документ';
  if (source.includes('image')) return 'Изображение';
  return value || 'Источник не указан';
}

export default function IncidentsInboxSection({
  inbox,
  newCount,
  rows,
  selectedIncident,
  sourceOptions,
  patternOptions,
  filters,
  workAreaHeight,
  canScanAck,
  busyAckInbox,
  busyIncident,
  ui,
  quietActionSx,
  panelSx,
  formatters,
  renderVirtualRow,
  renderFragments,
  onReload,
  onResetFilters,
  onOpenHostOverview,
  onExpandAll,
  onCollapseAll,
  onAckFiltered,
  onFilterChange,
  onToggleFragments,
  onAckIncident,
  onLoadMore,
}) {
  const {
    fileStatusColor,
    fileStatusLabel,
    formatTs,
    getFileExt,
    getSourceKind,
    severityColor,
  } = formatters;
  const selectedSource = selectedIncident ? getSourceKind(selectedIncident) : '';
  const selectedPage = Number(selectedIncident?.page_number || selectedIncident?.page || selectedIncident?.metadata?.page_number || 0);

  return (
    <Stack spacing={1.25}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Typography variant="h6" sx={{ fontWeight: 850 }}>Очередь проверки</Typography>
          <Typography variant="body2" color="text.secondary">
            Выберите находку, проверьте доказательство и отметьте её просмотренной. Загружено {Number(inbox.loaded || 0)} из {Number(inbox.total || 0)}.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          <Button type="button" size="small" variant="outlined" startIcon={inbox.loadingInitial ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={onReload} disabled={inbox.loadingInitial || inbox.loadingMore} sx={quietActionSx.neutral}>Обновить</Button>
          <Button type="button" size="small" variant="contained" startIcon={<DoneOutlinedIcon />} onClick={onAckFiltered} disabled={!canScanAck || busyAckInbox || newCount.loadingInitial || newCount.total <= 0}>
            {newCount.total > 0 ? `Просмотрено по фильтру (${newCount.total})` : 'Просмотрено по фильтру'}
          </Button>
        </Stack>
      </Box>

      {(inbox.loadingInitial || inbox.loadingMore) ? (
        <Box>
          <LinearProgress variant={inbox.total > 0 ? 'determinate' : 'indeterminate'} value={inbox.total > 0 ? Math.min(100, (inbox.loaded / inbox.total) * 100) : 0} />
          <Typography variant="caption" color="text.secondary">{inbox.loadingInitial ? 'Загрузка первой пачки' : 'Загружаются остальные инциденты'}</Typography>
        </Box>
      ) : null}
      {inbox.error ? <Alert severity="error">Не удалось загрузить инциденты. Проверьте Scan Server и повторите обновление.</Alert> : null}

      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
        <Grid container spacing={1} alignItems="center">
          <Grid item xs={12} md={5}>
            <TextField size="small" fullWidth label="Поиск" value={filters.q} onChange={(event) => onFilterChange('q', event.target.value)} placeholder="Файл, компьютер, фрагмент или пользователь" />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControl size="small" fullWidth>
              <InputLabel id="incident-pattern-filter-label">Тип находки</InputLabel>
              <Select labelId="incident-pattern-filter-label" value={filters.patternId} label="Тип находки" onChange={(event) => onFilterChange('patternId', event.target.value)}>
                <MenuItem value="all">Все правила</MenuItem>
                {(Array.isArray(patternOptions) ? patternOptions : []).map((pattern) => (
                  <MenuItem key={pattern.id} value={pattern.id}>{pattern.name || pattern.id}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4} md={2}>
            <Button type="button" fullWidth size="small" variant={filters.status === 'new' ? 'contained' : 'outlined'} onClick={() => onFilterChange('status', filters.status === 'new' ? 'all' : 'new')}>Новые</Button>
          </Grid>
          <Grid item xs={12} sm={4} md={2}>
            <Button type="button" fullWidth size="small" color="error" variant={filters.severity === 'high' ? 'contained' : 'outlined'} onClick={() => onFilterChange('severity', filters.severity === 'high' ? 'all' : 'high')}>Высокий риск</Button>
          </Grid>
          <Grid item xs={12}>
            <Button type="button" fullWidth size="small" variant={filters.hasFragment ? 'contained' : 'outlined'} onClick={onToggleFragments}>Только с доказательствами</Button>
          </Grid>
        </Grid>
      </Paper>

      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2" sx={{ fontWeight: 800 }}>Дополнительные фильтры и группировка</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={1}>
            <Grid item xs={6} md={2}>
              <FormControl size="small" fullWidth><InputLabel>Статус</InputLabel><Select value={filters.status} label="Статус" onChange={(event) => onFilterChange('status', event.target.value)}><MenuItem value="all">Все</MenuItem><MenuItem value="new">Новые</MenuItem><MenuItem value="ack">Просмотрены</MenuItem><MenuItem value="resolved_deleted">Удалён</MenuItem><MenuItem value="resolved_clean">Очищен</MenuItem><MenuItem value="resolved_moved">Перемещён</MenuItem></Select></FormControl>
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControl size="small" fullWidth><InputLabel>Риск</InputLabel><Select value={filters.severity} label="Риск" onChange={(event) => onFilterChange('severity', event.target.value)}><MenuItem value="all">Все</MenuItem><MenuItem value="high">Высокий</MenuItem><MenuItem value="medium">Средний</MenuItem><MenuItem value="low">Низкий</MenuItem></Select></FormControl>
            </Grid>
            <Grid item xs={6} md={2}>
              <FormControl size="small" fullWidth><InputLabel>Источник</InputLabel><Select value={filters.sourceKind} label="Источник" onChange={(event) => onFilterChange('sourceKind', event.target.value)}><MenuItem value="all">Все</MenuItem>{sourceOptions.map((option) => <MenuItem key={option} value={option}>{sourceLabel(option)}</MenuItem>)}</Select></FormControl>
            </Grid>
            <Grid item xs={6} md={2}><TextField size="small" fullWidth label="Расширение" value={filters.fileExt} onChange={(event) => onFilterChange('fileExt', event.target.value)} placeholder="pdf/txt" /></Grid>
            <Grid item xs={6} md={2}><TextField size="small" fullWidth type="date" label="Дата с" value={filters.dateFrom} onChange={(event) => onFilterChange('dateFrom', event.target.value)} InputLabelProps={{ shrink: true }} /></Grid>
            <Grid item xs={6} md={2}><TextField size="small" fullWidth type="date" label="Дата по" value={filters.dateTo} onChange={(event) => onFilterChange('dateTo', event.target.value)} InputLabelProps={{ shrink: true }} /></Grid>
          </Grid>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.25 }}>
            <Button type="button" size="small" onClick={onOpenHostOverview}>Сводка по компьютерам</Button>
            <Button type="button" size="small" onClick={onExpandAll}>Развернуть группы</Button>
            <Button type="button" size="small" onClick={onCollapseAll}>Свернуть группы</Button>
            <Button type="button" size="small" color="inherit" onClick={onResetFilters}>Сбросить фильтры</Button>
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Grid container spacing={1.5}>
        <Grid item xs={12} lg={5}>
          <Paper variant="outlined" sx={{ height: workAreaHeight, minHeight: { xs: 500, lg: 640 }, overflow: 'hidden', borderColor: ui.borderSoft, borderRadius: 2 }}>
            <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 850 }}>Находки</Typography>
              <Typography variant="caption" color="text.secondary">Сначала высокий риск, затем остальные совпадения</Typography>
            </Box>
            {rows.length === 0 && !inbox.loadingInitial ? (
              <Box sx={{ p: 3 }}><Typography variant="subtitle1" sx={{ fontWeight: 750 }}>Инциденты не найдены</Typography><Typography variant="body2" color="text.secondary">Измените фильтры или запустите новый скан.</Typography></Box>
            ) : (
              <Box sx={{ height: 'calc(100% - 61px)' }}>
                <AutoSizer>{({ height, width }) => <VirtualList height={height} width={width} itemCount={rows.length} itemSize={74}>{renderVirtualRow}</VirtualList>}</AutoSizer>
              </Box>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} lg={7}>
          <Paper variant="outlined" sx={{ ...panelSx, borderRadius: 2 }}>
            {selectedIncident ? (
              <Stack spacing={1.5}>
                <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={0.8} alignItems="center">
                      <FactCheckOutlinedIcon color="primary" fontSize="small" />
                      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 850 }}>Карточка проверки</Typography>
                    </Stack>
                    <Typography variant="h6" sx={{ fontWeight: 850 }}>{selectedIncident.hostname || 'Неизвестный компьютер'}</Typography>
                    <Typography variant="body2" color="text.secondary">{String(selectedIncident.branch || '').trim() || 'Без филиала'} · {String(selectedIncident.user_full_name || selectedIncident.user_login || '').trim() || 'Пользователь не указан'}</Typography>
                  </Box>
                  <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap" justifyContent="flex-end">
                    <Chip size="small" color={severityColor(selectedIncident.severity)} label={selectedIncident.severity || '—'} />
                    <Chip size="small" color={fileStatusColor(selectedIncident.status)} label={fileStatusLabel(selectedIncident.status)} />
                  </Stack>
                </Stack>

                <Box sx={{ p: 1.5, borderRadius: 1.5, bgcolor: 'action.hover' }}>
                  <Typography variant="caption" color="text.secondary">Файл</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}>{selectedIncident.file_path || selectedIncident.file_name || 'Путь не указан'}</Typography>
                  <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
                    <Chip size="small" variant="outlined" label={`Источник: ${sourceLabel(selectedSource)}`} />
                    {selectedPage > 0 ? <Chip size="small" variant="outlined" label={`Страница ${selectedPage}`} /> : null}
                    <Chip size="small" variant="outlined" label={`Тип: ${getFileExt(selectedIncident) || '—'}`} />
                    <Chip size="small" variant="outlined" label={formatTs(selectedIncident.created_at)} />
                  </Stack>
                </Box>

                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 850, mb: 0.8 }}>Доказательство срабатывания</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Показан фактически сохранённый OCR/текстовый фрагмент. Повторения одного правила не повышают критичность.
                  </Typography>
                  {renderFragments(selectedIncident)}
                </Box>

                {String(selectedIncident.status || '').toLowerCase() === 'new' ? (
                  <Button type="button" variant="contained" startIcon={<DoneOutlinedIcon />} disabled={!canScanAck || busyIncident === selectedIncident.id} onClick={() => onAckIncident(selectedIncident)} sx={{ alignSelf: 'flex-start' }}>
                    Отметить просмотренным
                  </Button>
                ) : null}
              </Stack>
            ) : (
              <Box sx={{ minHeight: 300, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
                <Box><FactCheckOutlinedIcon color="disabled" sx={{ fontSize: 44 }} /><Typography sx={{ fontWeight: 750 }}>Выберите находку слева</Typography><Typography variant="body2" color="text.secondary">Здесь появятся файл, источник, страница и совпавший фрагмент.</Typography></Box>
              </Box>
            )}
          </Paper>
        </Grid>
      </Grid>

      {inbox.hasMore ? (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}><Button type="button" size="small" variant="outlined" onClick={onLoadMore} disabled={inbox.loadingInitial || inbox.loadingMore}>{inbox.loadingMore ? 'Загрузка…' : 'Загрузить ещё'}</Button></Box>
      ) : null}
    </Stack>
  );
}
