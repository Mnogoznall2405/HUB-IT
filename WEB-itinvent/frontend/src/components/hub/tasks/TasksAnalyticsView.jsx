import {
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  Grid,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import FilterListIcon from '@mui/icons-material/FilterList';
import { lazy, Suspense, useMemo } from 'react';

import TasksAnalyticsFiltersContainer from './containers/TasksAnalyticsFiltersContainer';
import { TasksAnalyticsChartsSkeleton } from './TasksAnalyticsLoadingSkeleton';

const TasksAnalyticsCharts = lazy(() => import('./TasksAnalyticsCharts'));

import { buildAnalyticsTableColumns } from '../../../pages/tasks/taskAnalyticsModel';
import { formatPercent } from '../../../pages/tasks/taskFormatters';
import {
  getOfficeEmptyStateSx,
  getOfficeMetricBlockSx,
  getOfficePanelSx,
  getOfficeSubtlePanelSx,
} from '../../../theme/officeUiTokens';

export default function TasksAnalyticsView({
  ui,
  isAnalyticsMobile = false,
  filtersVisible = true,
  onToggleFilters,
  onExport,
  analyticsLoading = false,
  analyticsExporting = false,
  analyticsAccentColor = '#2563eb',
  analyticsGridStroke,
  analyticsFocusMeta,
  filtersPanel = null,
  filtersPanelProps = null,
  analyticsKpis = [],
  analyticsPayload = null,
  analyticsProjectSectionMeta = null,
  selectedAnalyticsProjects = [],
  selectedAnalyticsObjects = [],
  onSelectParticipant,
  analyticsStatusChartData = [],
  analyticsTrendItems = [],
  analyticsParticipantSectionMeta = { title: '', subtitle: '' },
  analyticsParticipantChartData = [],
  analyticsScopeChart = { title: '', rows: [] },
  selectedAnalyticsParticipant = null,
  analyticsTableColumns: analyticsTableColumnsProp,
}) {
  const theme = useTheme();
  const analyticsTableColumns = useMemo(
    () => analyticsTableColumnsProp || buildAnalyticsTableColumns(),
    [analyticsTableColumnsProp],
  );
  const resolvedFiltersPanel = filtersPanelProps
    ? <TasksAnalyticsFiltersContainer {...filtersPanelProps} />
    : filtersPanel;

  return (
              <Box sx={{ height: '100%', minHeight: 0, overflowY: 'auto', pr: 0.2 }}>
                <Stack spacing={1.2} sx={{ minHeight: '100%', pb: 0.6 }}>
                  {!isAnalyticsMobile ? (
                  <Box
                    sx={{
                      position: isAnalyticsMobile ? 'static' : 'sticky',
                      top: 0,
                      zIndex: 5,
                      pt: 0.1,
                      pb: 0.25,
                      bgcolor: ui.pageBg,
                    }}
                  >
                    <Card
                      data-testid="analytics-filters-panel"
                      sx={{
                        ...getOfficePanelSx(ui, { p: 0.95, borderRadius: '15px' }),
                        overflow: 'visible',
                      }}
                    >
                      <Stack spacing={0.8}>
                        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.75}>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography sx={{ fontWeight: 900 }}>Фильтры аналитики</Typography>
                            <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
                              Сначала выберите проект, потом при необходимости сузьте отчёт до объекта. Ниже появится отдельный срез по выбранному фокусу.
                            </Typography>
                          </Box>
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.7} sx={{ width: { xs: '100%', md: 'auto' }, alignItems: { xs: 'stretch', md: 'flex-start' } }}>
                            <Button
                              variant="contained"
                              size="small"
                              startIcon={<DownloadIcon />}
                              onClick={onExport}
                              disabled={analyticsLoading || analyticsExporting}
                              sx={{ textTransform: 'none', fontWeight: 800, alignSelf: { xs: 'stretch', md: 'flex-start' }, whiteSpace: 'nowrap' }}
                            >
                              {analyticsExporting ? 'Экспорт...' : 'Экспорт Excel'}
                            </Button>
                            <Button
                              variant="outlined"
                              size="small"
                              startIcon={<FilterListIcon />}
                              onClick={onToggleFilters}
                              sx={{ textTransform: 'none', fontWeight: 800, alignSelf: { xs: 'stretch', md: 'flex-start' }, whiteSpace: 'nowrap' }}
                            >
                              {filtersVisible ? 'Скрыть фильтры' : 'Показать фильтры'}
                            </Button>
                            <Box
                              sx={{
                                ...getOfficeSubtlePanelSx(ui, { px: 0.95, py: 0.65, borderRadius: '12px' }),
                                minWidth: { md: 300 },
                                maxWidth: { md: 430 },
                              }}
                            >
                              <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block' }}>Сейчас считаем</Typography>
                              <Typography sx={{ fontWeight: 900, mt: 0.2 }}>{analyticsFocusMeta.title}</Typography>
                              <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.25 }}>
                                {analyticsFocusMeta.description}
                              </Typography>
                            </Box>
                          </Stack>
                        </Stack>

                        {!isAnalyticsMobile ? (
                          <Collapse in={filtersVisible} timeout="auto" unmountOnExit={false}>
                            {resolvedFiltersPanel}
                          </Collapse>
                        ) : null}
                      </Stack>
                    </Card>
                  </Box>
                  ) : null}

                  {analyticsLoading ? <LinearProgress sx={{ borderRadius: 999 }} /> : null}

                  <Grid container spacing={1}>
                  {analyticsKpis.map((item) => (
                    <Grid item xs={6} sm={6} xl={2} key={item.title}>
                      <Box sx={{ ...getOfficeMetricBlockSx(ui, item.color, { p: 0.95, minHeight: 88 }) }}>
                        <Typography sx={{ fontWeight: 900, color: item.color, fontSize: '1.02rem', lineHeight: 1.1 }}>{item.value}</Typography>
                        <Typography sx={{ mt: 0.45, fontWeight: 800, fontSize: '0.76rem' }}>{item.title}</Typography>
                        <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.35, lineHeight: 1.35 }}>
                          {item.helper}
                        </Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>

                <Grid container spacing={1.2}>
                  {analyticsProjectSectionMeta ? (
                    <Grid item xs={12}>
                      <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }) }}>
                        <Stack spacing={0.8}>
                          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                            <Box>
                              <Typography sx={{ fontWeight: 900 }}>{analyticsProjectSectionMeta.title}</Typography>
                              <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                {selectedAnalyticsProjects.length === 1
                                  ? 'Выбрали проект, ниже видно кто по нему работает и сколько задач у каждого исполнителя.'
                                  : 'Выбраны проекты, ниже видно кто по ним работает и сколько задач у каждого исполнителя.'}
                              </Typography>
                            </Box>
                            <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                              {selectedAnalyticsProjects.map((item) => (
                                <Chip
                                  key={`analytics-project-${item.id}`}
                                  size="small"
                                  label={item.name}
                                  sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#059669', 0.12), color: '#059669' }}
                                />
                              ))}
                            </Stack>
                          </Stack>

                          {(analyticsPayload?.by_participant || []).length > 0 ? (
                            <Grid container spacing={0.8}>
                              {(analyticsPayload?.by_participant || []).map((row) => (
                                <Grid item xs={12} md={6} xl={4} key={`project-focus-user-${row.participant_user_id || 'none'}`}>
                                  <Box
                                    data-testid={`project-focus-user-${row.participant_user_id || 'none'}`}
                                    onClick={() => onSelectParticipant(row.participant_user_id)}
                                    sx={{
                                      ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }),
                                      cursor: 'pointer',
                                      transition: 'transform 0.16s ease, box-shadow 0.16s ease',
                                      '&:hover': {
                                        transform: 'translateY(-1px)',
                                        boxShadow: theme.shadows[2],
                                      },
                                    }}
                                  >
                                    <Typography sx={{ fontWeight: 800 }}>{row.participant_name || 'Не назначен'}</Typography>
                                    <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.15 }}>
                                      Всего {Number(row.total || 0)} · Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · В срок {Number(row.done_on_time || 0)} · Просрочено {Number(row.overdue || 0)}
                                    </Typography>
                                  </Box>
                                </Grid>
                              ))}
                            </Grid>
                          ) : (
                            <Box sx={getOfficeEmptyStateSx(ui, { p: 1.5 })}>
                              <Typography sx={{ fontWeight: 800 }}>По выбранному проекту задач не найдено.</Typography>
                            </Box>
                          )}
                        </Stack>
                      </Card>
                    </Grid>
                  ) : null}

                  {selectedAnalyticsObjects.length > 0 ? (
                    <Grid item xs={12}>
                      <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }) }}>
                        <Stack spacing={0.8}>
                          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                            <Box>
                              <Typography sx={{ fontWeight: 900 }}>Срез по объекту</Typography>
                              <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                Выбрали объект, ниже видно кто по нему работает и сколько задач у каждого исполнителя.
                              </Typography>
                            </Box>
                            <Stack direction="row" spacing={0.6} flexWrap="wrap" sx={{ gap: 0.6 }}>
                              {selectedAnalyticsObjects.map((item) => (
                                <Chip
                                  key={`analytics-object-${item.id}`}
                                  size="small"
                                  label={item.name}
                                  sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#2563eb', 0.12), color: '#2563eb' }}
                                />
                              ))}
                            </Stack>
                          </Stack>

                          {(analyticsPayload?.by_participant || []).length > 0 ? (
                            <Grid container spacing={0.8}>
                              {(analyticsPayload?.by_participant || []).map((row) => (
                                <Grid item xs={12} md={6} xl={4} key={`object-focus-user-${row.participant_user_id || 'none'}`}>
                                  <Box
                                    data-testid={`object-focus-user-${row.participant_user_id || 'none'}`}
                                    onClick={() => onSelectParticipant(row.participant_user_id)}
                                    sx={{
                                      ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }),
                                      cursor: 'pointer',
                                      transition: 'transform 0.16s ease, box-shadow 0.16s ease',
                                      '&:hover': {
                                        transform: 'translateY(-1px)',
                                        boxShadow: theme.shadows[2],
                                      },
                                    }}
                                  >
                                    <Typography sx={{ fontWeight: 800 }}>{row.participant_name || 'Не назначен'}</Typography>
                                    <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.15 }}>
                                      Всего {Number(row.total || 0)} · Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · В срок {Number(row.done_on_time || 0)} · Просрочено {Number(row.overdue || 0)}
                                    </Typography>
                                  </Box>
                                </Grid>
                              ))}
                            </Grid>
                          ) : (
                            <Box sx={getOfficeEmptyStateSx(ui, { p: 1.5 })}>
                              <Typography sx={{ fontWeight: 800 }}>По выбранному объекту задач не найдено.</Typography>
                            </Box>
                          )}
                        </Stack>
                      </Card>
                    </Grid>
                  ) : null}

                  <Grid item xs={12}>
                    <Suspense fallback={<TasksAnalyticsChartsSkeleton />}>
                      <TasksAnalyticsCharts
                        ui={ui}
                        analyticsGridStroke={analyticsGridStroke}
                        analyticsStatusChartData={analyticsStatusChartData}
                        analyticsTrendItems={analyticsTrendItems}
                        analyticsPayload={analyticsPayload}
                        analyticsParticipantSectionMeta={analyticsParticipantSectionMeta}
                        analyticsParticipantChartData={analyticsParticipantChartData}
                        analyticsScopeChart={analyticsScopeChart}
                      />
                    </Suspense>
                  </Grid>
                </Grid>

                {selectedAnalyticsParticipant ? (
                  <Card data-testid="analytics-participant-card" sx={{ ...getOfficePanelSx(ui, { p: 1.1, borderRadius: '16px' }) }}>
                    <Stack spacing={1}>
                      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.8}>
                        <Box>
                          <Typography sx={{ fontWeight: 900 }}>Участник: {selectedAnalyticsParticipant.participant_name || '—'}</Typography>
                          <Typography variant="caption" sx={{ color: ui.subtleText }}>
                            Детальная карточка выбранного исполнителя по текущим фильтрам.
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={`Выполнено ${formatPercent(selectedAnalyticsParticipant.completion_percent)}`}
                          sx={{ height: 24, fontWeight: 800, bgcolor: alpha('#059669', 0.12), color: '#059669' }}
                        />
                      </Stack>

                      <Grid container spacing={0.8}>
                        {[
                          { label: 'Новые', value: Number(selectedAnalyticsParticipant.new || 0), color: '#2563eb' },
                          { label: 'В работе', value: Number(selectedAnalyticsParticipant.in_progress || 0), color: '#d97706' },
                          { label: 'На проверке', value: Number(selectedAnalyticsParticipant.review || 0), color: '#7c3aed' },
                          { label: 'Открыто', value: Number(selectedAnalyticsParticipant.open || 0), color: '#0f172a' },
                          { label: 'Выполнено', value: Number(selectedAnalyticsParticipant.done || 0), color: '#059669' },
                          { label: 'В срок', value: Number(selectedAnalyticsParticipant.done_on_time || 0), color: '#7c3aed' },
                          { label: 'Просрочено', value: Number(selectedAnalyticsParticipant.overdue || 0), color: '#dc2626' },
                        ].map((item) => (
                          <Grid item xs={6} sm={4} md={3} key={item.label}>
                            <Box sx={{ ...getOfficeMetricBlockSx(ui, item.color, { p: 0.8, minHeight: 74 }) }}>
                              <Typography sx={{ fontWeight: 900, color: item.color, fontSize: '1rem', lineHeight: 1 }}>{item.value}</Typography>
                              <Typography sx={{ mt: 0.4, fontWeight: 800, fontSize: '0.72rem' }}>{item.label}</Typography>
                            </Box>
                          </Grid>
                        ))}
                      </Grid>

                      <Grid container spacing={1}>
                        <Grid item xs={12} lg={6}>
                          <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }) }}>
                            <Typography sx={{ fontWeight: 800, mb: 0.7 }}>По проектам участника</Typography>
                            <Stack spacing={0.55}>
                              {(analyticsPayload?.by_project || []).length === 0 ? (
                                <Typography variant="body2" sx={{ color: ui.mutedText }}>Нет данных по проектам.</Typography>
                              ) : (analyticsPayload?.by_project || []).map((row) => (
                                <Stack key={`participant-project-${row.project_id || 'none'}`} direction="row" justifyContent="space-between" spacing={1}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.project_name || 'Без проекта'}</Typography>
                                  <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                    Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · Просрочено {Number(row.overdue || 0)}
                                  </Typography>
                                </Stack>
                              ))}
                            </Stack>
                          </Box>
                        </Grid>
                        <Grid item xs={12} lg={6}>
                          <Box sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.95, borderRadius: '14px' }) }}>
                            <Typography sx={{ fontWeight: 800, mb: 0.7 }}>По объектам участника</Typography>
                            <Stack spacing={0.55}>
                              {(analyticsPayload?.by_object || []).length === 0 ? (
                                <Typography variant="body2" sx={{ color: ui.mutedText }}>Нет данных по объектам.</Typography>
                              ) : (analyticsPayload?.by_object || []).map((row) => (
                                <Stack key={`participant-object-${row.object_id || 'none'}`} direction="row" justifyContent="space-between" spacing={1}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.object_name || 'Без объекта'}</Typography>
                                  <Typography variant="caption" sx={{ color: ui.subtleText }}>
                                    Открыто {Number(row.open || 0)} · Выполнено {Number(row.done || 0)} · Просрочено {Number(row.overdue || 0)}
                                  </Typography>
                                </Stack>
                              ))}
                            </Stack>
                          </Box>
                        </Grid>
                      </Grid>
                    </Stack>
                  </Card>
                ) : null}

                <Grid container spacing={1.2} sx={{ minHeight: 0 }}>
                  {[
                    { title: analyticsParticipantSectionMeta.title, rows: analyticsPayload?.by_participant || [], idKey: 'participant_user_id', labelKey: 'participant_name', subtitle: analyticsParticipantSectionMeta.subtitle },
                    { title: 'По проектам', rows: analyticsPayload?.by_project || [], idKey: 'project_id', labelKey: 'project_name' },
                    { title: 'По объектам', rows: analyticsPayload?.by_object || [], idKey: 'object_id', labelKey: 'object_name' },
                  ].map((section) => (
                    <Grid item xs={12} key={section.title}>
                      <Card sx={{ ...getOfficePanelSx(ui, { p: 1.05, borderRadius: '16px' }) }}>
                        <Typography sx={{ fontWeight: 900, mb: 0.9 }}>{section.title}</Typography>
                        {section.subtitle ? (
                          <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mb: 0.9 }}>
                            {section.subtitle}
                          </Typography>
                        ) : null}
                        {section.rows.length === 0 ? (
                          <Box sx={getOfficeEmptyStateSx(ui, { p: 1.4 })}>
                            <Typography sx={{ fontWeight: 800 }}>Нет данных по фильтрам.</Typography>
                          </Box>
                        ) : (
                          <Stack spacing={0.75}>
                            <Box
                              sx={{
                                display: { xs: 'none', lg: 'grid' },
                                gridTemplateColumns: 'minmax(220px, 1.6fr) repeat(8, minmax(62px, 0.7fr))',
                                gap: 0.7,
                                px: 0.35,
                              }}
                            >
                              <Typography variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>Срез</Typography>
                              {analyticsTableColumns.map((column) => (
                                <Typography key={`${section.title}-head-${column.key}`} variant="caption" sx={{ color: ui.subtleText, fontWeight: 800 }}>{column.label}</Typography>
                              ))}
                            </Box>
                            {section.rows.map((row) => (
                              <Box key={`${section.title}-${row[section.idKey] || 'none'}`} sx={{ ...getOfficeSubtlePanelSx(ui, { p: 0.9, borderRadius: '12px' }) }}>
                                <Box
                                  sx={{
                                    display: 'grid',
                                    gridTemplateColumns: { xs: '1fr 1fr', lg: 'minmax(220px, 1.6fr) repeat(8, minmax(62px, 0.7fr))' },
                                    gap: 0.7,
                                    alignItems: 'center',
                                  }}
                                >
                                  <Box sx={{ minWidth: 0 }}>
                                    <Typography sx={{ fontWeight: 800 }}>{row[section.labelKey] || '-'}</Typography>
                                    <Typography variant="caption" sx={{ color: ui.subtleText, display: 'block', mt: 0.2 }}>
                                      Выполнено {formatPercent(row.completion_percent)} · В срок {formatPercent(row.completion_on_time_percent)}
                                    </Typography>
                                  </Box>
                                  {analyticsTableColumns.map((column) => (
                                    <Box key={`${section.title}-${row[section.idKey] || 'none'}-${column.key}`} sx={{ minWidth: 0 }}>
                                      <Typography variant="caption" sx={{ color: ui.subtleText, display: { xs: 'block', lg: 'none' } }}>{column.label}</Typography>
                                      <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>{Number(row[column.key] || 0)}</Typography>
                                    </Box>
                                  ))}
                                </Box>
                              </Box>
                            ))}
                          </Stack>
                        )}
                      </Card>
                    </Grid>
                  ))}
                </Grid>
                </Stack>
              </Box>
  );
}
