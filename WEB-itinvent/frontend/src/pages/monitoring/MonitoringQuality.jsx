import { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { formatNumber, formatTime, isNumber } from './monitoringFormat';

const states = {
  online: ['Ответы получены', 'success.main'], partial: ['Частичные потери', 'warning.main'],
  offline: ['Нет ответа ICMP', 'error.main'], collector_error: ['Ошибка проверки', 'text.disabled'],
  missing: ['Проверка пропущена', 'text.disabled'], pending: ['Проверка ещё не завершена', 'action.disabledBackground'],
  backoff: ['Плановая пауза опроса', 'action.disabledBackground'], legacy: ['Ранняя история: полнота неизвестна', 'action.disabledBackground'],
  paused: ['Опрос приостановлен', 'action.disabledBackground'],
  unobserved: ['Нет достоверной истории проверок', 'action.disabledBackground'],
};
const errors = { collector_timeout: 'Истёк срок выполнения ping на сервере', process_error: 'Не удалось выполнить ping на сервере', collector_error: 'Ошибка сборщика' };
export const qualityLabel = (point) => states[point?.quality_status]?.[0] || 'Полнота проверки неизвестна';
export const qualityReason = (point) => errors[point?.error] || '';
export const packetLabel = (point) => isNumber(point?.sent) && isNumber(point?.received)
  ? `${point.received} из ${point.sent} ответов` : isNumber(point?.received) ? `Получено ответов: ${point.received}; проверка неполная` : 'Число пакетов неизвестно';

export default function MonitoringQuality({ points }) {
  const { counts, segments } = useMemo(() => {
    const counts = {}; const segments = [];
    for (const point of points) {
      const state = point.quality_status || 'legacy';
      const weight = (point.source_resolution_seconds || 10) / 10;
      counts[state] = (counts[state] || 0) + 1;
      const last = segments.at(-1);
      if (last?.state === state) { last.count += weight; last.end = point.at; }
      else segments.push({ state, count: weight, start: point.at, end: point.at });
    }
    return { counts, segments };
  }, [points]);
  const done = (counts.online || 0) + (counts.offline || 0) + (counts.partial || 0);
  const missing = counts.missing || 0; const failed = counts.collector_error || 0;
  const expected = done + missing + failed;
  const summary = expected ? `Выполнено ${done} из ${expected} проверок · пропущено ${missing} · ошибок проверки ${failed}` : 'Полнота проверок за этот период неизвестна';
  return <Stack spacing={.75} sx={{ mb: 1.5 }} aria-label="Качество наблюдения">
    <Typography variant="caption" fontWeight={600}>{summary}</Typography>
    {expected > 0 && <Typography variant="caption" color="text.secondary">Полнота: {formatNumber(done / expected * 100)}%. {missing || failed ? 'Есть пробелы наблюдения.' : 'Все завершённые окна содержат результат проверки.'} {counts.offline ? `Без ответа ICMP: ${counts.offline}.` : ''} {counts.partial ? `С частичными потерями: ${counts.partial}.` : ''}</Typography>}
    <Box role="img" aria-label={`История результатов: ${summary}`} sx={{ display: 'flex', height: 12, overflow: 'hidden', borderRadius: 1, minWidth: 0 }}>
      {segments.map((segment) => <Box key={segment.start} title={`${states[segment.state]?.[0] || 'Нет данных'} · ${formatTime(segment.start)} — ${formatTime(segment.end)}`}
        sx={{ flex: segment.count, minWidth: 0, bgcolor: states[segment.state]?.[1] || 'text.disabled' }} />)}
    </Box>
    <Stack direction="row" flexWrap="wrap" gap={1.5}>{['online', 'offline', 'partial', 'missing'].map((state) => <Typography key={state} variant="caption" color="text.secondary"><Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', mr: .5, bgcolor: states[state][1] }} />{state === 'missing' ? 'Серый: нет достоверной проверки' : states[state][0]}</Typography>)}</Stack>
    {counts.backoff > 0 && <Typography variant="caption" color="text.secondary">Плановых пауз: {counts.backoff}. Во время паузы состояние связи не измерялось.</Typography>}
    {counts.paused > 0 && <Typography variant="caption" color="text.secondary">Опрос был приостановлен: {counts.paused} интервалов. Состояние связи не измерялось.</Typography>}
    {(counts.legacy || counts.unobserved) > 0 && <Typography variant="caption" color="text.secondary">Ранняя история и время до начала учёта полноты не включены в расчёт. Отсутствие данных не подтверждает обрыв связи.</Typography>}
    <Typography variant="caption" color="text.secondary">Результаты относятся к моментам проверки. Короткие сбои между проверками могут остаться незамеченными.</Typography>
  </Stack>;
}
