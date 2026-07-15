import React from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import {
  ArrowForwardRounded as ArrowForwardRoundedIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  ErrorOutline as ErrorOutlineIcon,
  ExpandMore as ExpandMoreIcon,
  GppMaybeOutlined as GppMaybeOutlinedIcon,
  PeopleAltOutlined as PeopleAltOutlinedIcon,
  ScheduleOutlined as ScheduleOutlinedIcon,
} from '@mui/icons-material';

function formatDurationMs(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return '—';
  if (milliseconds >= 1000) {
    const seconds = milliseconds / 1000;
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)} с`;
  }
  return `${Math.round(milliseconds)} мс`;
}

function formatAgeSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'нет ожидания';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} ч`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} мин`;
  return `${Math.round(seconds)} с`;
}

function AttentionRow({ icon, title, description, value, tone, action, onClick }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1.35, '& + &': { borderTop: '1px solid', borderColor: 'divider' } }}>
      <Box sx={{ width: 38, height: 38, borderRadius: 1.5, bgcolor: `${tone}.light`, color: `${tone}.dark`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
          <Typography variant="body2" sx={{ fontWeight: 800 }}>{title}</Typography>
          <Chip size="small" color={tone} label={value} />
        </Stack>
        <Typography variant="caption" color="text.secondary">{description}</Typography>
      </Box>
      <Button type="button" size="small" endIcon={<ArrowForwardRoundedIcon />} onClick={onClick}>{action}</Button>
    </Box>
  );
}

function PulseRow({ label, value, helper, color = 'text.primary' }) {
  return (
    <Box sx={{ py: 1.1, '& + &': { borderTop: '1px solid', borderColor: 'divider' } }}>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Typography variant="body2" color="text.secondary">{label}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 850, color }}>{value}</Typography>
      </Stack>
      {helper ? <Typography variant="caption" color="text.secondary">{helper}</Typography> : null}
    </Box>
  );
}

function Metric({ title, value, helper }) {
  return (
    <Box sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, height: '100%', bgcolor: 'background.paper' }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 850 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{helper}</Typography>
    </Box>
  );
}

export default function ScanCenterOverview({ dashboard, dashboardLoading, reviewItems, onNavigate }) {
  const totals = dashboard?.totals || {};
  const performance = dashboard?.performance || {};
  const queueWait = performance.queue_wait_ms || {};
  const processing = performance.processing_ms || {};
  const ocr = performance.ocr_ms || {};
  const incidents = Number(totals.incidents_new || 0);
  const incomplete = Number(totals.analysis_incomplete || totals.server_pdf_incomplete || 0);
  const agentsTotal = Number(totals.agents_total || 0);
  const agentsOnline = Number(totals.agents_online || 0);
  const coverage = agentsTotal > 0 ? Math.round((agentsOnline / agentsTotal) * 100) : 0;

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="h6" sx={{ fontWeight: 850 }}>Что делать сейчас</Typography>
        <Typography variant="body2" color="text.secondary">Сначала разберите находки и неполные проверки. Технические метрики оставлены ниже.</Typography>
      </Box>

      <Grid container spacing={1.5}>
        <Grid item xs={12} lg={8}>
          <Paper variant="outlined" sx={{ px: 1.5, borderRadius: 2, height: '100%' }}>
            <AttentionRow
              icon={<GppMaybeOutlinedIcon />}
              title="Новые инциденты"
              description="Точная фраза ДСП имеет высокий приоритет; сокращение ДСП требует ручной проверки."
              value={incidents}
              tone={incidents > 0 ? 'warning' : 'success'}
              action="Открыть очередь"
              onClick={() => onNavigate('incidents')}
            />
            <AttentionRow
              icon={<ErrorOutlineIcon />}
              title="Не удалось проверить"
              description="Тайм-ауты, повреждённые и зашифрованные файлы не считаются чистыми."
              value={incomplete}
              tone={incomplete > 0 ? 'warning' : 'success'}
              action="Разобрать"
              onClick={() => onNavigate('review')}
            />
            <AttentionRow
              icon={<PeopleAltOutlinedIcon />}
              title="Агенты требуют внимания"
              description={`Не в сети: ${Math.max(0, agentsTotal - agentsOnline)} · устаревшая версия: ${Number(totals.agents_outdated || 0)}`}
              value={Math.max(0, agentsTotal - agentsOnline) + Number(totals.agents_outdated || 0)}
              tone="info"
              action="Проверить"
              onClick={() => onNavigate('agents')}
            />
          </Paper>
        </Grid>

        <Grid item xs={12} lg={4}>
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, height: '100%' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Состояние контура</Typography>
              {incidents + incomplete === 0 ? <CheckCircleOutlineIcon color="success" /> : <ScheduleOutlinedIcon color="warning" />}
            </Stack>
            <PulseRow label="OCR-очередь" value={Number(totals.server_pdf_pending || 0)} helper={`старейшее ожидание: ${formatAgeSeconds(performance.pending_oldest_age_sec)}`} />
            <PulseRow label="Скорость за 24 часа" value={`${Number(performance.throughput_per_hour || 0)} файлов/ч`} helper={`обработано: ${Number(performance.completed || 0)}`} />
            <PulseRow label="Агенты на связи" value={`${agentsOnline}/${agentsTotal}`} helper={`${coverage}% покрытия`} color={coverage >= 90 ? 'success.main' : 'warning.main'} />
            <LinearProgress variant="determinate" value={Math.max(0, Math.min(100, coverage))} color={coverage >= 90 ? 'success' : 'warning'} sx={{ mt: 0.5, height: 7, borderRadius: 4 }} />
          </Paper>
        </Grid>
      </Grid>

      {Number(reviewItems?.total || 0) > 0 ? (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Последние неполные проверки</Typography>
              <Typography variant="caption" color="text.secondary">Показаны первые файлы из очереди восстановления.</Typography>
            </Box>
            <Button type="button" size="small" onClick={() => onNavigate('review')}>Открыть все ({Number(reviewItems.total || 0)})</Button>
          </Stack>
          {(Array.isArray(reviewItems.items) ? reviewItems.items : []).slice(0, 3).map((item) => (
            <Box key={item.id} sx={{ pt: 1, mt: 1, borderTop: '1px solid', borderColor: 'divider' }}>
              <Typography variant="body2" sx={{ fontWeight: 750, overflowWrap: 'anywhere' }}>
                {item.hostname || item.agent_id || 'Неизвестный хост'} · {item.file_path || item.file_name || 'Путь не указан'}
              </Typography>
              <Typography variant="caption" color="error.main">{item.reason || 'Анализ не завершён'}</Typography>
            </Box>
          ))}
        </Paper>
      ) : null}

      <Accordion disableGutters elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '8px !important' }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 850 }}>Технические показатели</Typography>
            <Typography variant="caption" color="text.secondary">Очередь, p50/p95, DPI и результаты за 24 часа</Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {dashboardLoading ? <Alert severity="info">Загрузка показателей…</Alert> : null}
          <Grid container spacing={1}>
            <Grid item xs={12} sm={6} md={3}><Metric title="PDF очередь" value={Number(totals.server_pdf_pending || 0)} helper={`ждёт: ${Number(totals.server_pdf_queued || 0)} · в работе: ${Number(totals.server_pdf_processing || 0)}`} /></Grid>
            <Grid item xs={12} sm={6} md={3}><Metric title="Обработано PDF" value={Number(totals.server_pdf_processed || 0)} helper={`чисто: ${Number(totals.server_pdf_done_clean || 0)} · инциденты: ${Number(totals.server_pdf_done_with_incident || 0)} · не проверено: ${Number(totals.server_pdf_incomplete || 0)} · ошибки: ${Number(totals.server_pdf_failed || 0)}`} /></Grid>
            <Grid item xs={12} sm={6} md={3}><Metric title="Производительность за 24 ч" value={Number(performance.completed || 0)} helper={`${Number(performance.throughput_per_hour || 0)} файлов/ч · замеров: ${Number(performance.samples || 0)}`} /></Grid>
            <Grid item xs={12} sm={6} md={3}><Metric title="Ожидание очереди p95" value={formatDurationMs(queueWait.p95)} helper={`p50: ${formatDurationMs(queueWait.p50)} · старейшее: ${formatAgeSeconds(performance.pending_oldest_age_sec)}`} /></Grid>
            <Grid item xs={12} sm={6} md={3}><Metric title="OCR p95" value={formatDurationMs(ocr.p95)} helper={`p50: ${formatDurationMs(ocr.p50)} · обработка p95: ${formatDurationMs(processing.p95)}`} /></Grid>
            <Grid item xs={12} sm={6} md={3}><Metric title="Крупные страницы" value={Number(performance.large_pages_downscaled || 0)} helper={`мин. DPI страницы: ${performance.full_effective_dpi_min ?? '—'} · зон: ${performance.focused_effective_dpi_min ?? '—'}`} /></Grid>
            <Grid item xs={12} sm={6} md={3}><Metric title="Очередь команд" value={Number(totals.queue_active || 0)} helper={`просрочено: ${Number(totals.queue_expired || 0)}`} /></Grid>
            <Grid item xs={12} sm={6} md={3}><Metric title="Не удалось проверить" value={incomplete} helper={`OCR-ошибки: ${Number(totals.ocr_timeout_jobs || 0)} · неподдерживаемые: ${Number(totals.unsupported_files || 0)}`} /></Grid>
          </Grid>
          {Array.isArray(dashboard?.skipped_by_extension) && dashboard.skipped_by_extension.length > 0 ? (
            <Alert severity="info" sx={{ mt: 1.5 }}>
              Пропуски по расширениям за 30 дней: {dashboard.skipped_by_extension.slice(0, 8).map((item) => `${item.extension}: ${item.count}`).join(' · ')}
            </Alert>
          ) : null}
        </AccordionDetails>
      </Accordion>

      <Alert severity="info" variant="outlined">
        Политика PDF: OCR — первые 3 страницы; текстовый слой — до 10 страниц. Страница 4 и далее вне области OCR по утверждённой политике.
      </Alert>
    </Stack>
  );
}
