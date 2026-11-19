import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { makeSnapshotDiagnostic, normalizeSnapshotDiagnostic, type SnapshotDiagnostic, type SnapshotDiagnosticMetrics } from './snapshotDiagnostic';
import { getChatSendTimingSummary, resetChatSendTiming, type ChatSendTimingSummary } from './chatSendTiming';
import { buildDiagnosticSummary, type DiagnosticSummary } from './diagnosticSummary';
import { getApiInflightSummary, resetApiInflight, type ApiInflightSummary } from './apiInflight';
import { getUiTimingSummary, resetUiTiming, type UiTimingSummary } from './uiTiming';
import {
  getChatDeviceLogSnapshot,
  readChatDeviceLog,
  resetChatDeviceLog,
  flushChatDeviceLog,
  type ChatDeviceLogEntry,
} from './chatDeviceLog';
import {
  getAndroidProcessHealthSnapshot,
  normalizeAndroidProcessHealth,
  type AndroidProcessHealthSnapshot,
} from './androidProcessHealth';

const STORAGE_KEY = 'hubit_diagnostics_v1';
const RELEASE_HEALTH_STORAGE_KEY = 'hubit_release_health_v1';
const MAX_EVENTS = 20;

const RELEASE_HEALTH_METRICS = [
  'sessions_started',
  'ui_failures',
  'push_registration_succeeded',
  'push_registration_failed',
  'push_received',
  'offline_recovered',
  'update_installer_opened',
  'update_flow_failed',
  'update_completed',
] as const;

export type ReleaseHealthMetric = (typeof RELEASE_HEALTH_METRICS)[number];
export type ReleaseHealthCounters = Record<ReleaseHealthMetric, number>;

type StoredReleaseHealth = {
  periodStartedAt: string | null;
  updatedAt: string | null;
  lastVersion: string;
  lastBuild: string;
  // First moment this app observed the running version/build. It is not the
  // installer timestamp and stays unknown for installs that predate the field
  // until the next update — never backfilled with a guess.
  currentBuildFirstSeenAt: string | null;
  counters: ReleaseHealthCounters;
};

export type ReleaseHealthSnapshot = {
  schemaVersion: 2;
  periodStartedAt: string | null;
  updatedAt: string | null;
  currentVersion: string;
  currentBuild: string;
  currentBuildFirstSeenAt: string | null;
  counters: ReleaseHealthCounters;
};

export type DiagnosticCode =
  | 'ui_render_error'
  | 'native_file_error'
  | 'native_chat_delivery_error'
  | 'native_snapshot_error'
  | 'notification_action_error';

export type DiagnosticEventContext = {
  source: 'chat-outbox' | 'chat-thread' | 'chat-attachment' | 'chat-delivery';
  stage: 'parse' | 'sanitize' | 'persist' | 'queue' | 'foreground' | 'background';
};

export type DiagnosticEvent = {
  code: DiagnosticCode;
  at: string;
  snapshot?: SnapshotDiagnostic;
  context?: DiagnosticEventContext;
};

export type DiagnosticReport = {
  schemaVersion: 8;
  generatedAt: string;
  app: {
    version: string;
    build: string;
    platform: string;
    osVersion: string;
  };
  privacy: 'no-user-content-no-credentials';
  summary: DiagnosticSummary;
  events: DiagnosticEvent[];
  releaseHealth: ReleaseHealthSnapshot;
  androidProcessHealth: AndroidProcessHealthSnapshot;
  chatSendTiming: ChatSendTimingSummary;
  uiTiming: UiTimingSummary;
  apiInflight: ApiInflightSummary;
  chatDeviceLog: ChatDeviceLogEntry[];
};

let releaseHealthMutation = Promise.resolve();
let sessionStartedInProcess = false;
let diagnosticMutation = Promise.resolve();

function emptyReleaseHealthCounters(): ReleaseHealthCounters {
  return {
    sessions_started: 0,
    ui_failures: 0,
    push_registration_succeeded: 0,
    push_registration_failed: 0,
    push_received: 0,
    offline_recovered: 0,
    update_installer_opened: 0,
    update_flow_failed: 0,
    update_completed: 0,
  };
}

function normalizeTimestamp(value: unknown): string | null {
  const normalized = String(value || '').trim();
  return normalized && !Number.isNaN(new Date(normalized).getTime()) ? normalized : null;
}

function normalizeCounter(value: unknown): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(normalized)));
}

function normalizeReleaseHealth(value: unknown): StoredReleaseHealth {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<StoredReleaseHealth>
    : {};
  const counters = emptyReleaseHealthCounters();
  for (const metric of RELEASE_HEALTH_METRICS) {
    counters[metric] = normalizeCounter(raw.counters?.[metric]);
  }
  return {
    periodStartedAt: normalizeTimestamp(raw.periodStartedAt),
    updatedAt: normalizeTimestamp(raw.updatedAt),
    lastVersion: String(raw.lastVersion || '').trim().slice(0, 40),
    lastBuild: String(raw.lastBuild || '').trim().slice(0, 40),
    currentBuildFirstSeenAt: normalizeTimestamp(raw.currentBuildFirstSeenAt),
    counters,
  };
}

async function readReleaseHealth(): Promise<StoredReleaseHealth> {
  try {
    const raw = await SecureStore.getItemAsync(RELEASE_HEALTH_STORAGE_KEY);
    return normalizeReleaseHealth(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeReleaseHealth(null);
  }
}

async function mutateReleaseHealth(
  mutate: (current: StoredReleaseHealth, now: string) => void,
): Promise<void> {
  const operation = releaseHealthMutation.then(async () => {
    const current = await readReleaseHealth();
    const now = new Date().toISOString();
    mutate(current, now);
    current.periodStartedAt ||= now;
    current.updatedAt = now;
    await SecureStore.setItemAsync(RELEASE_HEALTH_STORAGE_KEY, JSON.stringify(current));
  });
  releaseHealthMutation = operation.catch(() => undefined);
  await operation.catch(() => undefined);
}

function buildReleaseHealthSnapshot(current: StoredReleaseHealth): ReleaseHealthSnapshot {
  const currentVersion = String(Application.nativeApplicationVersion || 'unknown');
  const currentBuild = String(Application.nativeBuildVersion || 'unknown');
  return {
    schemaVersion: 2,
    periodStartedAt: current.periodStartedAt,
    updatedAt: current.updatedAt,
    currentVersion,
    currentBuild,
    // The stored boundary is honest only while it was written by this build;
    // before startReleaseHealthSession persists the swap it describes the
    // previous version and must not leak into the report.
    currentBuildFirstSeenAt: current.lastVersion === currentVersion && current.lastBuild === currentBuild
      ? current.currentBuildFirstSeenAt : null,
    counters: { ...current.counters },
  };
}

export async function startReleaseHealthSession(): Promise<void> {
  if (sessionStartedInProcess) return;
  sessionStartedInProcess = true;
  const version = String(Application.nativeApplicationVersion || 'unknown').slice(0, 40);
  const build = String(Application.nativeBuildVersion || 'unknown').slice(0, 40);
  await mutateReleaseHealth((current, now) => {
    const buildChanged = current.lastVersion !== version || current.lastBuild !== build;
    if (current.lastVersion && current.lastBuild && buildChanged) {
      current.counters.update_completed += 1;
    }
    current.lastVersion = version;
    current.lastBuild = build;
    if (buildChanged || !current.currentBuildFirstSeenAt) {
      current.currentBuildFirstSeenAt = now;
    }
    current.counters.sessions_started += 1;
  });
}

export async function recordReleaseHealthMetric(metric: ReleaseHealthMetric): Promise<void> {
  await mutateReleaseHealth((current) => {
    current.counters[metric] += 1;
  });
}

export async function getReleaseHealthSnapshot(): Promise<ReleaseHealthSnapshot> {
  await releaseHealthMutation.catch(() => undefined);
  return buildReleaseHealthSnapshot(await readReleaseHealth());
}

const DIAGNOSTIC_CONTEXT_SOURCES = new Set<DiagnosticEventContext['source']>([
  'chat-outbox',
  'chat-thread',
  'chat-attachment',
  'chat-delivery',
]);
const DIAGNOSTIC_CONTEXT_STAGES = new Set<DiagnosticEventContext['stage']>([
  'parse',
  'sanitize',
  'persist',
  'queue',
  'foreground',
  'background',
]);

// Context is only meaningful for file/storage and delivery failures and is
// revalidated on every boundary: a forged or free-text source/stage from disk
// or a caller must drop silently instead of entering the shared report.
function normalizeDiagnosticContext(
  code: DiagnosticCode,
  raw: unknown,
): DiagnosticEventContext | undefined {
  if (code !== 'native_file_error' && code !== 'native_chat_delivery_error') return undefined;
  const candidate = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Partial<DiagnosticEventContext>
    : null;
  const source = String(candidate?.source || '') as DiagnosticEventContext['source'];
  const stage = String(candidate?.stage || '') as DiagnosticEventContext['stage'];
  if (!DIAGNOSTIC_CONTEXT_SOURCES.has(source) || !DIAGNOSTIC_CONTEXT_STAGES.has(stage)) {
    return undefined;
  }
  return { source, stage };
}

function normalizeEvents(value: unknown): DiagnosticEvent[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<DiagnosticCode>([
    'ui_render_error',
    'native_file_error',
    'native_chat_delivery_error',
    'native_snapshot_error',
    'notification_action_error',
  ]);
  return value
    .map((raw) => raw as Partial<DiagnosticEvent>)
    .filter((item) => allowed.has(item.code as DiagnosticCode) && !Number.isNaN(new Date(String(item.at || '')).getTime()))
    .map((item) => {
      const context = normalizeDiagnosticContext(item.code as DiagnosticCode, item.context);
      return {
        code: item.code as DiagnosticCode, at: String(item.at),
        ...((item.code === 'native_snapshot_error' || item.code === 'ui_render_error') && item.snapshot
          ? { snapshot: normalizeSnapshotDiagnostic(item.snapshot) } : {}),
        ...(context ? { context } : {}),
      };
    })
    .slice(-MAX_EVENTS);
}

async function readEvents(): Promise<DiagnosticEvent[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return normalizeEvents(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function recordDiagnosticEvent(
  code: DiagnosticCode,
  snapshot?: SnapshotDiagnostic,
  context?: DiagnosticEventContext,
): Promise<void> {
  diagnosticMutation = diagnosticMutation.catch(() => undefined).then(async () => {
    const events = await readEvents();
    const boundedContext = normalizeDiagnosticContext(code, context);
    events.push({
      code,
      at: new Date().toISOString(),
      ...(snapshot ? { snapshot } : {}),
      ...(boundedContext ? { context: boundedContext } : {}),
    });
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalizeEvents(events)));
  }).catch(() => undefined);
  return diagnosticMutation;
}

export function recordSnapshotFailure(
  scope: string, stage: string, error: unknown, metrics?: Partial<SnapshotDiagnosticMetrics>,
): Promise<void> {
  // Diagnostics must never cause a cache failure, including malformed native errors.
  try {
    return recordDiagnosticEvent('native_snapshot_error', makeSnapshotDiagnostic(scope, stage, error, metrics));
  } catch {
    return Promise.resolve();
  }
}

export async function getDiagnosticEvents(): Promise<DiagnosticEvent[]> {
  await diagnosticMutation;
  return readEvents();
}

export async function getDiagnosticEventCount(): Promise<number> {
  return (await getDiagnosticEvents()).length;
}

export async function clearDiagnosticEvents(): Promise<void> {
  await diagnosticMutation;
  await releaseHealthMutation.catch(() => undefined);
  resetChatSendTiming();
  resetUiTiming();
  resetApiInflight();
  await resetChatDeviceLog();
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEY),
    SecureStore.deleteItemAsync(RELEASE_HEALTH_STORAGE_KEY),
  ]).catch(() => undefined);
}

export function buildDiagnosticReport(
  events: DiagnosticEvent[],
  generatedAt = new Date().toISOString(),
  releaseHealth = buildReleaseHealthSnapshot(normalizeReleaseHealth(null)),
  androidProcessHealth = normalizeAndroidProcessHealth({ supported: false, entries: [] }),
  chatSendTiming = getChatSendTimingSummary(),
  uiTiming = getUiTimingSummary(),
  apiInflight = getApiInflightSummary(),
  chatDeviceLog: ChatDeviceLogEntry[] = getChatDeviceLogSnapshot(),
): DiagnosticReport {
  const boundedEvents = normalizeEvents(events);
  return {
    schemaVersion: 8,
    generatedAt,
    app: {
      version: String(Application.nativeApplicationVersion || 'unknown'),
      build: String(Application.nativeBuildVersion || 'unknown'),
      platform: Platform.OS,
      osVersion: String(Platform.Version),
    },
    privacy: 'no-user-content-no-credentials',
    summary: buildDiagnosticSummary({
      releaseHealth, androidProcessHealth, chatSendTiming, uiTiming, apiInflight,
      events: boundedEvents,
    }),
    events: boundedEvents,
    releaseHealth,
    androidProcessHealth,
    chatSendTiming,
    uiTiming,
    apiInflight,
    chatDeviceLog,
  };
}

export async function shareDiagnosticReport(): Promise<void> {
  await diagnosticMutation;
  if (!(await Sharing.isAvailableAsync())) throw new Error('Системное меню «Поделиться» недоступно');
  await flushChatDeviceLog();
  // Release health must resolve first: its build boundary scopes the exit
  // history observation window inside the process-health snapshot.
  const releaseHealth = await getReleaseHealthSnapshot();
  const [events, androidProcessHealth, chatDeviceLog] = await Promise.all([
    readEvents(),
    getAndroidProcessHealthSnapshot(releaseHealth.currentBuildFirstSeenAt),
    readChatDeviceLog(),
  ]);
  const report = buildDiagnosticReport(
    events,
    new Date().toISOString(),
    releaseHealth,
    androidProcessHealth,
    undefined,
    undefined,
    undefined,
    chatDeviceLog,
  );
  const file = new File(Paths.cache, `hubit-diagnostics-${Date.now()}.json`);
  try {
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(report, null, 2));
    await Sharing.shareAsync(file.uri, {
      dialogTitle: 'Поделиться диагностикой HUB-IT',
      mimeType: 'application/json',
    });
  } finally {
    if (file.exists) file.delete();
  }
}
