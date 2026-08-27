import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
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
  counters: ReleaseHealthCounters;
};

export type ReleaseHealthSnapshot = {
  schemaVersion: 1;
  periodStartedAt: string | null;
  updatedAt: string | null;
  currentVersion: string;
  currentBuild: string;
  crashFreeSessionPercent: number | null;
  counters: ReleaseHealthCounters;
};

export type DiagnosticCode =
  | 'ui_render_error'
  | 'native_file_error'
  | 'notification_action_error';

export type DiagnosticEvent = {
  code: DiagnosticCode;
  at: string;
};

export type DiagnosticReport = {
  schemaVersion: 3;
  generatedAt: string;
  app: {
    version: string;
    build: string;
    platform: string;
    osVersion: string;
  };
  privacy: 'no-user-content-no-credentials';
  events: DiagnosticEvent[];
  releaseHealth: ReleaseHealthSnapshot;
  androidProcessHealth: AndroidProcessHealthSnapshot;
};

let releaseHealthMutation = Promise.resolve();
let sessionStartedInProcess = false;

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
  const sessions = current.counters.sessions_started;
  const failures = Math.min(sessions, current.counters.ui_failures);
  return {
    schemaVersion: 1,
    periodStartedAt: current.periodStartedAt,
    updatedAt: current.updatedAt,
    currentVersion: String(Application.nativeApplicationVersion || 'unknown'),
    currentBuild: String(Application.nativeBuildVersion || 'unknown'),
    crashFreeSessionPercent: sessions > 0
      ? Math.round(((sessions - failures) / sessions) * 10_000) / 100
      : null,
    counters: { ...current.counters },
  };
}

export async function startReleaseHealthSession(): Promise<void> {
  if (sessionStartedInProcess) return;
  sessionStartedInProcess = true;
  const version = String(Application.nativeApplicationVersion || 'unknown').slice(0, 40);
  const build = String(Application.nativeBuildVersion || 'unknown').slice(0, 40);
  await mutateReleaseHealth((current) => {
    if (
      current.lastVersion
      && current.lastBuild
      && (current.lastVersion !== version || current.lastBuild !== build)
    ) {
      current.counters.update_completed += 1;
    }
    current.lastVersion = version;
    current.lastBuild = build;
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

function normalizeEvents(value: unknown): DiagnosticEvent[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<DiagnosticCode>([
    'ui_render_error',
    'native_file_error',
    'notification_action_error',
  ]);
  return value
    .map((raw) => raw as Partial<DiagnosticEvent>)
    .filter((item) => allowed.has(item.code as DiagnosticCode) && !Number.isNaN(new Date(String(item.at || '')).getTime()))
    .map((item) => ({ code: item.code as DiagnosticCode, at: String(item.at) }))
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

export async function recordDiagnosticEvent(code: DiagnosticCode): Promise<void> {
  const events = await readEvents();
  events.push({ code, at: new Date().toISOString() });
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS))).catch(() => undefined);
}

export async function getDiagnosticEventCount(): Promise<number> {
  return (await readEvents()).length;
}

export async function clearDiagnosticEvents(): Promise<void> {
  await releaseHealthMutation.catch(() => undefined);
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
): DiagnosticReport {
  return {
    schemaVersion: 3,
    generatedAt,
    app: {
      version: String(Application.nativeApplicationVersion || 'unknown'),
      build: String(Application.nativeBuildVersion || 'unknown'),
      platform: Platform.OS,
      osVersion: String(Platform.Version),
    },
    privacy: 'no-user-content-no-credentials',
    events: normalizeEvents(events),
    releaseHealth,
    androidProcessHealth,
  };
}

export async function shareDiagnosticReport(): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Системное меню «Поделиться» недоступно');
  const [events, releaseHealth, androidProcessHealth] = await Promise.all([
    readEvents(),
    getReleaseHealthSnapshot(),
    getAndroidProcessHealthSnapshot(),
  ]);
  const report = buildDiagnosticReport(
    events,
    new Date().toISOString(),
    releaseHealth,
    androidProcessHealth,
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
