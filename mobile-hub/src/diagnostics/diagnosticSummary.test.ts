import type { ApiInflightSummary } from './apiInflight';
import type { AndroidProcessHealthSnapshot } from './androidProcessHealth';
import type { ChatSendTimingSummary } from './chatSendTiming';
import { buildDiagnosticSummary } from './diagnosticSummary';
import type { ReleaseHealthSnapshot } from './diagnostics';
import type { UiTimingSummary } from './uiTiming';

const releaseHealth = {
  periodStartedAt: '2026-11-16T07:00:00.000Z',
  currentVersion: '1.1.81',
  currentBuild: '83',
  counters: { sessions_started: 3, ui_failures: 1, push_registration_succeeded: 82, push_registration_failed: 46 },
} as ReleaseHealthSnapshot;
const exitCounts = {
  anr: 0, crash: 8, nativeCrash: 0, lowMemory: 0, excessiveResource: 0, otherUnexpected: 0, expected: 0,
};
const androidProcessHealth = {
  status: 'available',
  counts: exitCounts,
  recent: Array.from({ length: 8 }, () => ({ at: '2026-11-16T06:00:00.000Z', reason: 'crash' })),
  sinceCurrentBuildFirstSeen: { at: '2026-11-16T09:00:00.000Z', counts: { ...exitCounts, crash: 0 } },
} as AndroidProcessHealthSnapshot;
const chatSendTiming = {
  sends: 2,
  intervals: {
    tap_to_ack: { count: 2, p50: 284, p95: 6500 },
    tap_to_bubble: { count: 2, p50: 50, p95: 60 },
  },
  storageOps: { write: { count: 2, p50: 5, p95: 20 } },
} as ChatSendTimingSummary;
const uiTiming = {
  loopLag: { sampledSeconds: 244, stalls150: 12, stalls500: 8, stalls1500: 3, maxLagMs: 2000 },
  threadOpens: {
    count: 6, fromCache: 4,
    intervals: { tap_to_mount: { count: 6, p50: 90 }, mount_to_ready: { count: 6, p50: 145 } },
  },
  perf: { endpoints: {
    'GET /settings/ivan/private?token=secret': {
      count: 16, total: 16, errors: 4, maxMs: 76_600,
    },
  } },
} as unknown as UiTimingSummary;
const apiInflight = {
  started: 242, completed: 241, current: 4,
} as ApiInflightSummary;
const events = [
  { code: 'native_file_error', at: '2026-11-16T07:20:00.000Z' },
  { code: 'native_file_error', at: '2026-11-16T07:21:00.000Z' },
  {
    code: 'native_chat_delivery_error',
    at: '2026-11-16T07:22:00.000Z',
    context: { source: 'chat-delivery', stage: 'background' },
  },
] as const;

it('separates release counters, Android exit history and process samples without leaking endpoint IDs', () => {
  const summary = buildDiagnosticSummary({
    releaseHealth, androidProcessHealth, chatSendTiming, uiTiming, apiInflight,
    events: [...events],
  });
  const sections = Object.fromEntries(summary.sections.map((section) => [section.id, section.lines.join('\n')]));

  expect(sections.periods).toContain('может включать предыдущие версии APK');
  expect(sections.periods).toContain('Версия APK: 1.1.81 (83)');
  expect(sections.periods).toContain('Запусков: 3; UI-сбоев: 1');
  expect(sections.periods).toContain('не системную историю завершений Android');
  expect(sections.events).toContain('локальные файлы: 2; доставка чата: 1');
  expect(sections.events).toContain('У 2 файловых ошибок источник и этап неизвестны');
  expect(sections.events).toContain('Ошибка доставки чата (доставка чата, фон)');
  expect(sections.android).toContain('Java crash 8');
  expect(sections.android).toContain('Java crash 0');
  expect(sections.android).toContain('не подтверждение версии упавшего процесса');
  expect(sections.network).toContain('начато 242, завершено 241, сейчас выполняется 4');
  expect(sections.network).toContain('GET /settings/:id/:id: максимум 76,6 с (выборка 16 из 16; ошибок за период 4)');
  expect(sections.chat).toContain('подтверждений HTTP среди них: 2, тап → подтверждение p50 284 мс, p95 6,5 с');
  expect(sections.chat).toContain('Появление сообщения на экране: p50 50 мс');
  expect(sections.chat).toContain('Запись в локальную очередь: p95 20 мс');
  expect(sections.responsiveness).toContain('от 150 мс 23, от 500 мс 11, от 1500 мс 3');
  expect(sections.responsiveness).toContain('тап → экран p50 90 мс, экран → данные p50 145 мс; из кэша 4 из 6');
  expect(sections.push).toContain('Успешных попыток: 82; неудачных: 46');
  for (const privateValue of ['ivan', 'private', 'token=secret', 'crash-free']) {
    expect(JSON.stringify(summary)).not.toContain(privateValue);
  }
});

it('does not turn missing Android and JS observations into a clean-health claim', () => {
  const summary = buildDiagnosticSummary({
    releaseHealth,
    androidProcessHealth: {
      ...androidProcessHealth, status: 'unavailable', sinceCurrentBuildFirstSeen: null,
    },
    chatSendTiming,
    uiTiming: { ...uiTiming, loopLag: { ...uiTiming.loopLag, sampledSeconds: 0 } },
    apiInflight,
    events: [],
  });
  const sections = Object.fromEntries(summary.sections.map((section) => [section.id, section.lines.join('\n')]));
  expect(sections.android).toContain('не означают отсутствия падений');
  expect(sections.events).toContain('это не подтверждает отсутствие системных сбоев');
  expect(sections.responsiveness).toContain('отсутствие замеров не означает отсутствия задержек');
  expect(sections.responsiveness).toContain('Открытие диалога: тап → экран p50 90 мс');
});

it('does not hide unexpected Android exits outside the Java/native crash categories', () => {
  const summary = buildDiagnosticSummary({
    releaseHealth,
    androidProcessHealth: {
      ...androidProcessHealth,
      counts: { ...exitCounts, otherUnexpected: 2 },
      sinceCurrentBuildFirstSeen: null,
    },
    chatSendTiming, uiTiming, apiInflight, events: [],
  });
  const android = summary.sections.find((section) => section.id === 'android')?.lines.join(' ');
  expect(android).toContain('другие неожиданные 2');
  expect(android).toContain('приписать ей исторические завершения нельзя');
});

it('uses only fixed labels for event source, stage and code', () => {
  const summary = buildDiagnosticSummary({
    releaseHealth: { ...releaseHealth, currentVersion: '1.1.81 private-person-name', currentBuild: 'token=secret' },
    androidProcessHealth, chatSendTiming, uiTiming, apiInflight,
    events: [
      {
        code: 'native_file_error', at: '2026-11-16T07:25:00.000Z',
        context: { source: 'token=synthetic-secret', stage: 'private-person-name' },
      } as never,
      { code: 'raw-secret' as never, at: '2026-11-16T07:26:00.000Z' },
    ],
  });
  const serialized = JSON.stringify(summary);
  expect(serialized).not.toContain('synthetic-secret');
  expect(serialized).not.toContain('private-person-name');
  expect(serialized).not.toContain('raw-secret');
  expect(serialized).not.toContain('token=secret');
  expect(serialized).toContain('Версия APK: неизвестно (неизвестно)');
  expect(serialized).toContain('Другое событие');
});
