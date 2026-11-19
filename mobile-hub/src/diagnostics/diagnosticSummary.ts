import type { ApiInflightSummary } from './apiInflight';
import type { AndroidProcessHealthSnapshot } from './androidProcessHealth';
import type { ChatSendTimingSummary } from './chatSendTiming';
import type { DiagnosticCode, DiagnosticEvent, DiagnosticEventContext, ReleaseHealthSnapshot } from './diagnostics';
import { endpointTemplate } from './perfProbes';
import type { UiTimingSummary } from './uiTiming';

export type DiagnosticSummary = {
  schemaVersion: 1;
  sections: Array<{
    id: 'periods' | 'events' | 'android' | 'network' | 'chat' | 'responsiveness' | 'push';
    title: string;
    lines: string[];
  }>;
};

type SummaryInputs = {
  releaseHealth: ReleaseHealthSnapshot;
  androidProcessHealth: AndroidProcessHealthSnapshot;
  chatSendTiming: ChatSendTimingSummary;
  uiTiming: UiTimingSummary;
  apiInflight: ApiInflightSummary;
  events: DiagnosticEvent[];
};

const EVENT_LABELS: Record<DiagnosticCode, string> = {
  ui_render_error: 'UI-сбой',
  native_file_error: 'Ошибка локального файла',
  native_chat_delivery_error: 'Ошибка доставки чата',
  native_snapshot_error: 'Ошибка локального снимка',
  notification_action_error: 'Ошибка действия уведомления',
};
const SOURCE_LABELS: Record<DiagnosticEventContext['source'], string> = {
  'chat-outbox': 'очередь чата',
  'chat-thread': 'история чата',
  'chat-attachment': 'вложение чата',
  'chat-delivery': 'доставка чата',
};
const STAGE_LABELS: Record<DiagnosticEventContext['stage'], string> = {
  parse: 'чтение',
  sanitize: 'проверка данных',
  persist: 'запись',
  queue: 'постановка в очередь',
  foreground: 'активное приложение',
  background: 'фон',
};

function isoOrUnknown(value: string | null): string {
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : 'неизвестно';
}

function buildIdentity(releaseHealth: ReleaseHealthSnapshot): string {
  const version = /^[0-9][0-9A-Za-z.+-]{0,31}$/.test(releaseHealth.currentVersion)
    ? releaseHealth.currentVersion : 'неизвестно';
  const build = /^\d{1,8}$/.test(releaseHealth.currentBuild)
    ? releaseHealth.currentBuild : 'неизвестно';
  return `${version} (${build})`;
}

function ms(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'нет замеров';
  const duration = Math.max(0, value);
  return duration >= 1000
    ? `${(duration / 1000).toFixed(1).replace('.', ',')} с`
    : `${Math.round(duration)} мс`;
}

function slowEndpoints(perf: UiTimingSummary['perf']): string[] {
  return Object.entries(perf.endpoints)
    .map(([key, stats]) => {
      const match = /^([A-Z]{3,7}) (\/.*)$/.exec(key);
      const route = match ? endpointTemplate(match[1], match[2]) : null;
      return route && stats.count > 0 && stats.maxMs !== null && Number.isFinite(stats.maxMs)
        ? { route, samples: stats.count, total: stats.total, maxMs: stats.maxMs, errors: stats.errors }
        : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.maxMs - left.maxMs || left.route.localeCompare(right.route))
    .slice(0, 5)
    .map(({ route, samples, total, maxMs, errors }) =>
      `${route}: максимум ${ms(maxMs)} (выборка ${samples} из ${total}; ошибок за период ${errors}).`);
}

function eventLines(events: DiagnosticEvent[]): string[] {
  if (!events.length) {
    return ['Локальных служебных событий нет; это не подтверждает отсутствие системных сбоев.'];
  }
  const count = (code: DiagnosticCode) => events.filter((event) => event.code === code).length;
  const fileWithoutContext = events.filter((event) => event.code === 'native_file_error' && !event.context).length;
  const latest = events.slice(-3).reverse().map((event) => {
    const source = SOURCE_LABELS[event.context?.source as DiagnosticEventContext['source']];
    const stage = STAGE_LABELS[event.context?.stage as DiagnosticEventContext['stage']];
    const context = (event.code === 'native_file_error' || event.code === 'native_chat_delivery_error')
      && source && stage ? ` (${source}, ${stage})` : '';
    return `${isoOrUnknown(event.at)} — ${EVENT_LABELS[event.code] || 'Другое событие'}${context}.`;
  });
  return [
    `Сохранено ${events.length} последних событий (лимит — 20); остальные события за период неизвестны.`,
    `UI: ${count('ui_render_error')}; локальные файлы: ${count('native_file_error')}; доставка чата: ${count('native_chat_delivery_error')}; снимки: ${count('native_snapshot_error')}; уведомления: ${count('notification_action_error')}.`,
    ...(fileWithoutContext ? [`У ${fileWithoutContext} файловых ошибок источник и этап неизвестны (старый формат).`] : []),
    'Три последних события:',
    ...latest,
  ];
}

export function buildDiagnosticSummary({
  releaseHealth, androidProcessHealth, chatSendTiming, uiTiming, apiInflight, events,
}: SummaryInputs): DiagnosticSummary {
  const exits = androidProcessHealth.counts;
  const since = androidProcessHealth.sinceCurrentBuildFirstSeen;
  const lag = uiTiming.loopLag;
  const ack = chatSendTiming.intervals.tap_to_ack;
  const endpointLines = slowEndpoints(uiTiming.perf);
  const androidLines = androidProcessHealth.status === 'available'
    ? [
      `В последних ${androidProcessHealth.recent.length} записях Android: ANR ${exits.anr}, Java crash ${exits.crash}, native crash ${exits.nativeCrash}, нехватка памяти ${exits.lowMemory}, избыток ресурсов ${exits.excessiveResource}, другие неожиданные ${exits.otherUnexpected}, ожидаемые ${exits.expected}.`,
      since
        ? `После первого наблюдения этой сборки (${isoOrUnknown(since.at)}): ANR ${since.counts.anr}, Java crash ${since.counts.crash}, native crash ${since.counts.nativeCrash}, нехватка памяти ${since.counts.lowMemory}, избыток ресурсов ${since.counts.excessiveResource}, другие неожиданные ${since.counts.otherUnexpected}. Это граница по времени, а не подтверждение версии упавшего процесса.`
        : 'Граница наблюдения текущей сборки неизвестна; приписать ей исторические завершения нельзя.',
    ]
    : ['История завершений Android недоступна: нулевые поля не означают отсутствия падений.'];

  return {
    schemaVersion: 1,
    sections: [
      {
        id: 'periods',
        title: 'Периоды измерений',
        lines: [
          `Версия APK: ${buildIdentity(releaseHealth)}.`,
          `Счётчики запусков, UI и push — с ${isoOrUnknown(releaseHealth.periodStartedAt)}; этот период может включать предыдущие версии APK.`,
          `Запусков: ${releaseHealth.counters.sessions_started}; UI-сбоев: ${releaseHealth.counters.ui_failures}. UI-сбои нельзя использовать для оценки числа аварий Android.`,
          'Задержки экрана, чата, API и паузы JS — только из текущего процесса; отдельные группы также сбрасываются при выходе или очистке. Это не весь срок работы APK.',
          'Локальные события сохраняются в пределах последних 20 записей; журнал устройства ограничен последними 400 событиями.',
          'Очистка сбрасывает локальные измерения, но не системную историю завершений Android.',
        ],
      },
      {
        id: 'events',
        title: 'События и ошибки',
        lines: eventLines(events),
      },
      {
        id: 'android',
        title: 'Завершения Android',
        lines: [
          ...androidLines,
          'История содержит не более 20 завершений; причина конкретного crash требует Android logcat.',
        ],
      },
      {
        id: 'network',
        title: 'Сеть и API',
        lines: [
          `Запросы в этой эпохе: начато ${apiInflight.started}, завершено ${apiInflight.completed}, сейчас выполняется ${apiInflight.current}. Несовпадение счётчиков само по себе не доказывает утечку.`,
          ...(endpointLines.length ? [
            'Самые долгие запросы по максимуму среди сохранённых замеров (идентификаторы в маршрутах скрыты):',
            ...endpointLines,
          ] : ['Нет замеров HTTP-запросов.']),
          'Максимум и p95 при малой выборке не описывают типичную скорость или причину сетевого сбоя.',
        ],
      },
      {
        id: 'chat',
        title: 'Отправка чата',
        lines: [
          `Сохранено трасс отправки: ${chatSendTiming.sends} (не более 32 за текущий процесс); подтверждений HTTP среди них: ${ack.count}, тап → подтверждение p50 ${ms(ack.p50)}, p95 ${ms(ack.p95)}.`,
          ...(Number(chatSendTiming.intervals.tap_to_bubble?.count || 0) > 0 ? [
            `Появление сообщения на экране: p50 ${ms(chatSendTiming.intervals.tap_to_bubble.p50)} (${chatSendTiming.intervals.tap_to_bubble.count} замеров).`,
          ] : []),
          ...(Number(chatSendTiming.storageOps?.write?.count || 0) > 0 ? [
            `Запись в локальную очередь: p95 ${ms(chatSendTiming.storageOps.write.p95)} (${chatSendTiming.storageOps.write.count} замеров).`,
          ] : []),
          'Подтверждённые отправки и неудачные попытки учитываются по-разному; отсутствие замера подтверждения не означает потерю сообщения.',
        ],
      },
      {
        id: 'responsiveness',
        title: 'Отзывчивость',
        lines: [
          ...(lag.sampledSeconds > 0 ? [
            `JS-паузы за ${lag.sampledSeconds} с активного наблюдения: от 150 мс ${lag.stalls150 + lag.stalls500 + lag.stalls1500}, от 500 мс ${lag.stalls500 + lag.stalls1500}, от 1500 мс ${lag.stalls1500}; максимум ${ms(lag.maxLagMs)}.`,
          ] : ['Паузы JS ещё не измерены; отсутствие замеров не означает отсутствия задержек.']),
          ...(Number(uiTiming.threadOpens?.count || 0) > 0 ? [
            `Открытие диалога: тап → экран p50 ${ms(uiTiming.threadOpens.intervals.tap_to_mount.p50)}, экран → данные p50 ${ms(uiTiming.threadOpens.intervals.mount_to_ready.p50)}; из кэша ${uiTiming.threadOpens.fromCache} из ${uiTiming.threadOpens.count}.`,
          ] : []),
          ...(lag.sampledSeconds > 0
            ? ['Пересечение паузы с чтением снимка или сетевым запросом не доказывает, что он вызвал задержку.']
            : []),
        ],
      },
      {
        id: 'push',
        title: 'Регистрация push',
        lines: [
          `Успешных попыток: ${releaseHealth.counters.push_registration_succeeded}; неудачных: ${releaseHealth.counters.push_registration_failed}. Это попытки за период учёта, не число устройств.`,
          'Этап и безопасный код будущих ошибок доступны в журнале push_registration; старые попытки нельзя классифицировать задним числом.',
        ],
      },
    ],
  };
}
