import type {
  MonitoringEvent,
  MonitoringHistoryPoint,
  MonitoringInterface,
  MonitoringTarget,
} from '../api/monitoringApi';

export type MonitoringTone = 'success' | 'warning' | 'error' | 'neutral';
export type MonitoringStatusKey = 'paused' | 'unknown' | 'stale' | 'offline' | 'snmp' | 'link' | 'warning' | 'online';
export type MonitoringStatus = { key: MonitoringStatusKey; label: string; tone: MonitoringTone };

export const MONITORING_REFRESH_MS = 15_000;

export const MONITORING_PERIOD_OPTIONS = [
  { value: '1', label: '1 час', hours: 1 },
  { value: '6', label: '6 часов', hours: 6 },
  { value: '24', label: 'Сутки', hours: 24 },
  { value: '168', label: '7 дней', hours: 168 },
] as const;

export const MONITORING_FILTER_OPTIONS = [
  { value: 'all', label: 'Все' },
  { value: 'issues', label: 'Проблемы' },
  { value: 'online', label: 'В сети' },
] as const;

export type MonitoringFilter = (typeof MONITORING_FILTER_OPTIONS)[number]['value'];

export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function formatNumber(value: unknown, digits = 1): string {
  if (!isNumber(value)) return '—';
  return value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}

export function formatBps(value: unknown): string {
  if (!isNumber(value)) return '—';
  if (value >= 1e9) return `${formatNumber(value / 1e9)} Гбит/с`;
  if (value >= 1e6) return `${formatNumber(value / 1e6)} Мбит/с`;
  if (value >= 1e3) return `${formatNumber(value / 1e3)} Кбит/с`;
  return `${formatNumber(value)} бит/с`;
}

export function formatTime(value?: string | null): string {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Ещё не было';
  return date.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function isStale(value: string | null | undefined, seconds = 120, now = Date.now()): boolean {
  if (!value) return true;
  const at = new Date(value).getTime();
  return Number.isNaN(at) || now - at > seconds * 1000;
}

export function formatDuration(start?: string | null, end: string | number = Date.now()): string {
  const milliseconds = new Date(end).getTime() - new Date(start || '').getTime();
  if (!start || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const minutes = Math.floor(milliseconds / 60000);
  if (!minutes) return 'менее минуты';
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  return `${Math.floor(minutes / 1440)} д ${Math.floor((minutes % 1440) / 60)} ч`;
}

/** Ярлыки узлов — те же, что в веб-разделе, чтобы названия совпадали на всех клиентах. */
const DEVICE_NAMES: Record<string, string> = {
  Gribordoeva_3: 'Грибоедова, 3', Kuznetcova13: 'Кузнецова, 13', Gercena_64: 'Герцена, 64', Gercena_55: 'Герцена, 55',
  MSK: 'Москва', SPB: 'Санкт-Петербург', Komsomolsk: 'Комсомольск', Kotelny_Island: 'Котельный', Magadan: 'Магадан',
  Velizhansky_6km: 'Велижанский, 6 км', Kosmodrom2_Vostochnyy: 'Восточный · 2', Kosmodrom_Vostochnyy: 'Восточный · 1',
  Teysin: 'Тейсин', Ykazchik1: 'Указчик · 1', Ykazchik2: 'Указчик · 2', Iskander: 'Искандер', Iturup: 'Итуруп',
  Severny_Island: 'Северный остров', 'Seyaha-YANAO': 'Сеяха', Vilyuchinsk: 'Вилючинск', Zegazification: 'Регазификация',
  Vologda: 'Вологда', ZFI: 'ЗФИ', Vladivostok: 'Владивосток', Vladivostok_vagon: 'Владивосток · вагон',
  Mozhaisk: 'Можайск', Sharapovo: 'Шарапово', Tiksi_ISP: 'Тикси · ISP', Tiksi: 'Тикси', 'Yu-Sakhalinsk': 'Южно-Сахалинск',
};

export function displayTargetName(target: Pick<MonitoringTarget, 'name'> | null | undefined): string {
  const raw = target?.name || 'Устройство';
  const prefix = raw.split(/_MikroTik-|\s·\sMikroTik/i)[0];
  const name = DEVICE_NAMES[prefix] || (prefix === 'Центральный' ? 'Центральный узел' : prefix);
  return /\(резерв\)\s*$/i.test(raw) && !/резерв/i.test(name) ? `${name} · резерв` : name;
}

const DEVICE_PRIORITY: Record<string, number> = { 'Центральный узел': 0, Москва: 1, 'Санкт-Петербург': 2 };

export function compareMonitoringTargets(a: MonitoringTarget, b: MonitoringTarget): number {
  const priority = (target: MonitoringTarget) => DEVICE_PRIORITY[displayTargetName(target).replace(/\s·\sрезерв$/i, '')] ?? 3;
  return priority(a) - priority(b) || displayTargetName(a).localeCompare(displayTargetName(b), 'ru');
}

export function targetStatus(target: MonitoringTarget | null | undefined, now = Date.now()): MonitoringStatus {
  if (!target?.enabled) return { key: 'paused', label: 'Приостановлен', tone: 'neutral' };
  const current = target.current || {};
  if (!current.checked_at) return { key: 'unknown', label: 'Ожидает опроса', tone: 'neutral' };
  if (isStale(current.checked_at, current.status === 'offline' ? 360 : 120, now)) {
    return { key: 'stale', label: 'Данные устарели', tone: 'warning' };
  }
  if (current.status === 'offline') return { key: 'offline', label: 'Нет связи', tone: 'error' };
  if (current.status === 'unknown') return { key: 'unknown', label: 'Проверяем связь', tone: 'warning' };
  if (current.snmp_status !== 'ok') return { key: 'snmp', label: 'Нет SNMP', tone: 'warning' };
  const link = target.outages?.find((event) => event.kind === 'link' && !event.closed_at);
  if (link) return { key: 'link', label: link.interface_role === 'wan' ? 'Упал WAN' : 'Нет линка', tone: 'error' };
  if ((current.open_events ?? 0) > 0) return { key: 'warning', label: 'Есть события', tone: 'warning' };
  return { key: 'online', label: 'В сети', tone: 'success' };
}

export const isIssue = (status: MonitoringStatus): boolean => !['online', 'paused'].includes(status.key);

export function countMonitoringIssues(targets: MonitoringTarget[], now = Date.now()): number {
  return targets.filter((target) => isIssue(targetStatus(target, now))).length;
}

export function filterMonitoringTargets(
  targets: MonitoringTarget[],
  query: string,
  filter: MonitoringFilter,
  now = Date.now(),
): MonitoringTarget[] {
  const needle = query.trim().toLowerCase();
  return targets
    .filter((target) => {
      const haystack = `${displayTargetName(target)} ${target.name} ${target.address} ${target.current?.device?.sys_name || ''}`.toLowerCase();
      if (needle && !haystack.includes(needle)) return false;
      const status = targetStatus(target, now);
      if (filter === 'issues') return isIssue(status);
      if (filter === 'online') return status.key === 'online';
      return true;
    })
    .sort(compareMonitoringTargets);
}

/** Текст о текущем или последнем обрыве; `null`, если обрывов не было. */
export function outageNotice(target: MonitoringTarget, now = Date.now()): string | null {
  const current = target.current || {};
  const availability = current.availability || {};
  const status = targetStatus(target, now);
  const episodes = target.outages || [];
  const stamp = (value?: string | null) => (value && !Number.isNaN(new Date(value).getTime())
    ? new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : 'время неизвестно');
  const active = episodes.find((event) => !event.closed_at && (status.key === 'offline' ? event.kind === 'unreachable' : event.kind === 'link'));
  if (status.key === 'offline') {
    const since = availability.unreachable_since || active?.opened_at;
    if (!since) return 'Начало недоступности неизвестно';
    const observedOnly = availability.initial_state_known && !availability.ever_reachable;
    const known = availability.ever_reachable || current.last_success_at;
    const text = observedOnly ? `Недоступен с начала наблюдения · ${stamp(availability.observed_since || since)}`
      : known ? `Обрыв: ${stamp(since)}` : `Начало неизвестно · зафиксировано ${stamp(since)}`;
    return `${text} · ${formatDuration(since, now)}`;
  }
  if (status.key === 'link' && active) {
    return `Обрыв ${active.interface_role === 'wan' ? 'WAN' : 'порта'}${active.interface_name ? ` · ${active.interface_name}` : ''}: ${stamp(active.opened_at)} · ${formatDuration(active.opened_at, now)}`;
  }
  const latest = episodes.find((event) => event.closed_at);
  if (latest) {
    return `Последний обрыв${latest.kind === 'link' ? ' порта' : ''}: ${stamp(latest.opened_at)} — ${stamp(latest.closed_at)} · ${formatDuration(latest.opened_at, latest.closed_at as string)}`;
  }
  return null;
}

export function interfaceStatus(item: MonitoringInterface, now = Date.now()): { label: string; tone: MonitoringTone } {
  const value = item.current || {};
  if (isStale(value.checked_at, 120, now)) return { label: 'Нет свежих данных', tone: 'neutral' };
  if (value.admin === 2) return { label: 'Выключен', tone: 'neutral' };
  if (value.oper === 1) return { label: 'Up', tone: 'success' };
  if (value.oper === 2) return { label: 'Нет линка', tone: item.settings?.critical ? 'error' : 'neutral' };
  return { label: 'Неизвестно', tone: 'neutral' };
}

/** Интерфейс по умолчанию для графиков: закреплённый → WAN/важный → работающий Ethernet → первый. */
export function defaultInterfaceId(items: MonitoringInterface[]): string {
  return items.find((row) => row.settings?.pinned)?.id
    || items.find((row) => row.settings?.role === 'wan' || row.settings?.critical)?.id
    || items.find((row) => row.current?.oper === 1 && row.current?.type === 6)?.id
    || items[0]?.id
    || '';
}

export function eventTone(event: Pick<MonitoringEvent, 'closed_at' | 'severity'>): MonitoringTone {
  if (event.closed_at) return 'success';
  return event.severity === 'critical' ? 'error' : 'warning';
}

export type ChartSeries = { key: keyof MonitoringHistoryPoint; label: string };

/** Сводит ряд точек к `count` столбцам (максимум в корзине); пропуски остаются `null`. */
export function bucketSeries(
  points: MonitoringHistoryPoint[],
  key: keyof MonitoringHistoryPoint,
  count = 48,
): Array<number | null> {
  if (!points.length) return [];
  const size = Math.max(1, Math.ceil(points.length / count));
  const result: Array<number | null> = [];
  for (let start = 0; start < points.length; start += size) {
    let best: number | null = null;
    for (const point of points.slice(start, start + size)) {
      const value = point[key];
      if (isNumber(value) && (best === null || value > best)) best = value;
    }
    result.push(best);
  }
  return result;
}
