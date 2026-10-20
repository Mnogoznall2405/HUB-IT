export const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
export const formatNumber = (value, digits = 1) => isNumber(value) ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value) : '—';
export const formatBps = (value) => {
  if (!isNumber(value)) return '—';
  if (value >= 1e9) return `${formatNumber(value / 1e9)} Гбит/с`;
  if (value >= 1e6) return `${formatNumber(value / 1e6)} Мбит/с`;
  if (value >= 1e3) return `${formatNumber(value / 1e3)} Кбит/с`;
  return `${formatNumber(value)} бит/с`;
};
export const formatBytes = (value) => isNumber(value) ? `${formatNumber(value / 1e9, 2)} ГБ` : '—';
export const formatTime = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Ещё не было';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
};
export const isStale = (value, seconds = 120) => !value || Date.now() - new Date(value).getTime() > seconds * 1000;
const DEVICE_NAMES = {
  Gribordoeva_3: 'Грибоедова, 3', Kuznetcova13: 'Кузнецова, 13', Gercena_64: 'Герцена, 64', Gercena_55: 'Герцена, 55',
  MSK: 'Москва', SPB: 'Санкт-Петербург', Komsomolsk: 'Комсомольск', Kotelny_Island: 'Котельный', Magadan: 'Магадан',
  Velizhansky_6km: 'Велижанский, 6 км', Kosmodrom2_Vostochnyy: 'Восточный · 2', Kosmodrom_Vostochnyy: 'Восточный · 1',
  Teysin: 'Тейсин', Ykazchik1: 'Указчик · 1', Ykazchik2: 'Указчик · 2', Iskander: 'Искандер', Iturup: 'Итуруп',
  Severny_Island: 'Северный остров', 'Seyaha-YANAO': 'Сеяха', Vilyuchinsk: 'Вилючинск', Zegazification: 'Регазификация',
  Vologda: 'Вологда', ZFI: 'ЗФИ', Vladivostok: 'Владивосток', Vladivostok_vagon: 'Владивосток · вагон',
  Mozhaisk: 'Можайск', Sharapovo: 'Шарапово', Tiksi_ISP: 'Тикси · ISP', Tiksi: 'Тикси', 'Yu-Sakhalinsk': 'Южно-Сахалинск',
};
export function displayTargetName(target) {
  const raw = target?.name || 'Устройство';
  const prefix = raw.split(/_MikroTik-|\s·\sMikroTik/i)[0];
  const name = DEVICE_NAMES[prefix] || (prefix === 'Центральный' ? 'Центральный узел' : prefix);
  return /\(резерв\)\s*$/i.test(raw) && !/резерв/i.test(name) ? `${name} · резерв` : name;
}
const DEVICE_PRIORITY = { 'Центральный узел': 0, 'Москва': 1, 'Санкт-Петербург': 2 };
export const isCentralTarget = (target) => displayTargetName(target) === 'Центральный узел';
export function compareMonitoringTargets(a, b) {
  const priority = (target) => DEVICE_PRIORITY[displayTargetName(target).replace(/\s·\sрезерв$/i, '')] ?? 3;
  return priority(a) - priority(b) || displayTargetName(a).localeCompare(displayTargetName(b), 'ru');
}
export const formatOutageTime = (value) => value && !Number.isNaN(new Date(value).getTime())
  ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'Время неизвестно';
export function formatDuration(start, end = Date.now()) {
  const milliseconds = new Date(end).getTime() - new Date(start).getTime();
  if (!start || !Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const minutes = Math.floor(milliseconds / 60000);
  if (!minutes) return 'менее минуты';
  if (minutes < 60) return `${minutes} мин`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  return `${Math.floor(minutes / 1440)} д ${Math.floor(minutes % 1440 / 60)} ч`;
}
export function outageNotice(target) {
  const current = target?.current || {};
  const availability = current.availability || {};
  const status = targetStatus(target);
  const episodes = target?.outages || [];
  const active = episodes.find((e) => !e.closed_at && (status.key === 'offline' ? e.kind === 'unreachable' : e.kind === 'link'));
  if (status.key === 'offline') {
    const since = availability.unreachable_since || active?.opened_at;
    if (!since) return { text: 'Начало недоступности неизвестно' };
    const observedOnly = availability.initial_state_known && !availability.ever_reachable;
    const knownConnection = availability.ever_reachable || current.last_success_at;
    return { duration: since ? formatDuration(since) : '',
      text: observedOnly ? `Недоступен с начала наблюдения · ${formatOutageTime(availability.observed_since || since)}`
        : knownConnection ? `Обрыв: ${formatOutageTime(since)}` : `Начало неизвестно · зафиксировано ${formatOutageTime(since)}`,
      exact: Boolean(knownConnection), observedOnly };
  }
  if (status.key === 'link' && active) return { duration: formatDuration(active.opened_at), exact: true,
    text: `Обрыв ${active.interface_role === 'wan' ? 'WAN' : 'порта'}${active.interface_name ? ` · ${active.interface_name}` : ''}: ${formatOutageTime(active.opened_at)}` };
  const latest = episodes.find((e) => e.closed_at);
  if (latest) {
    const initial = latest.kind === 'unreachable' && availability.first_reachable_at && new Date(latest.opened_at) < new Date(availability.first_reachable_at);
    return { text: `${initial ? 'До первого подключения' : `Последний обрыв${latest.kind === 'link' ? ' порта' : ''}`}: ${formatOutageTime(latest.opened_at)} — ${formatOutageTime(latest.closed_at)} · ${formatDuration(latest.opened_at, latest.closed_at)}` };
  }
  return null;
}
export function targetStatus(target) {
  if (!target?.enabled) return { label: 'Приостановлен', color: 'default', key: 'paused' };
  const current = target?.current || {};
  if (!current.checked_at) return { label: 'Ожидает опроса', color: 'default', key: 'unknown' };
  if (isStale(current.checked_at, current.status === 'offline' ? 360 : 120)) return { label: 'Данные устарели', color: 'warning', key: 'stale' };
  if (current.status === 'offline') return { label: 'Нет связи', color: 'error', key: 'offline' };
  if (current.status === 'unknown') return { label: 'Проверяем связь', color: 'warning', key: 'unknown' };
  if (current.snmp_status !== 'ok') return { label: 'Нет SNMP', color: 'warning', key: 'snmp' };
  const link = target.outages?.find((event) => event.kind === 'link' && !event.closed_at);
  if (link) return { label: link.interface_role === 'wan' ? 'Упал WAN' : 'Нет линка', color: 'error', key: 'link' };
  if (current.open_events > 0) return { label: 'Есть события', color: 'warning', key: 'warning' };
  return { label: 'В сети', color: 'success', key: 'online' };
}
export function interfaceStatus(item) {
  const value = item?.current || {};
  if (isStale(value.checked_at)) return { label: 'Нет свежих данных', color: 'default' };
  if (value.admin === 2) return { label: 'Выключен', color: 'default' };
  if (value.oper === 1) return { label: 'Up', color: 'success' };
  if (value.oper === 2) return { label: 'Нет линка', color: item.settings?.critical ? 'error' : 'default' };
  return { label: 'Неизвестно', color: 'default' };
}
export const errorMessage = (error) => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((entry) => entry.msg).join('. ');
  return 'Не удалось обновить данные. Проверьте подключение и повторите.';
};
