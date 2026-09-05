import {
  deleteEncryptedNativeSnapshot,
  readEncryptedNativeSnapshot,
  writeEncryptedNativeSnapshot,
} from '../cache/nativeSnapshotStorage';

const OFFLINE_COVERAGE_SCOPE = 'offline-coverage-manifest';
const MAX_COVERAGE_ENTRIES = 64;
const DEFAULT_ERROR_CODE = 'OFFLINE_SYNC_FAILED';

export type NativeOfflineCoverageStatus = 'complete' | 'partial' | 'failed';
export type NativeOfflineAvailableStatus = Exclude<NativeOfflineCoverageStatus, 'failed'>;

export type NativeOfflineCoverageEntry = {
  moduleId: string;
  status: NativeOfflineCoverageStatus;
  availableStatus: NativeOfflineAvailableStatus | null;
  loaded: number;
  total: number | null;
  unit: string;
  revision: number;
  savedAt: string | null;
  lastAttemptAt: string;
  errorCode: string | null;
  errorMessage: string | null;
};

export type NativeOfflineCoverageManifest = {
  version: 1;
  userId: number;
  updatedAt: string;
  entries: Record<string, NativeOfflineCoverageEntry>;
};

export type NativeOfflineCoverageSuccessMetric = {
  status: NativeOfflineAvailableStatus;
  loaded: number;
  total: number | null;
  unit: string;
  savedAt?: string;
  lastAttemptAt?: string;
};

export type NativeOfflineCoverageFailure = {
  errorCode: string;
  errorMessage: string;
  lastAttemptAt?: string;
  unit?: string;
};

const mutationQueues = new Map<number, Promise<void>>();

function normalizeUserId(userId: number): number | null {
  const value = Number(userId || 0);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeModuleId(moduleId: string): string | null {
  const value = String(moduleId || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) return null;
  if (value === 'constructor' || value === 'prototype') return null;
  return value;
}

function normalizeCount(value: unknown): number | null {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return count;
}

function normalizeTotal(value: unknown): number | null | undefined {
  if (value === null) return null;
  const total = normalizeCount(value);
  return total === null ? undefined : total;
}

function normalizeUnit(value: unknown, fallback = 'items'): string {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return normalized || fallback;
}

function normalizeTimestamp(value: unknown, fallback: string | null): string | null {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function normalizeErrorCode(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return normalized || DEFAULT_ERROR_CODE;
}

function normalizeErrorMessage(value: unknown): string {
  const normalized = String(value || '')
    .replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, '[redacted]')
    .replace(/\b(access[_-]?token|refresh[_-]?token|token|password|secret|authorization|cookie|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[endpoint]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
  return normalized || 'Не удалось обновить автономные данные';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEntry(moduleId: string, value: unknown): NativeOfflineCoverageEntry | null {
  if (!isRecord(value) || value.moduleId !== moduleId) return null;
  const normalizedModuleId = normalizeModuleId(moduleId);
  const status = value.status;
  const loaded = normalizeCount(value.loaded);
  const total = normalizeTotal(value.total);
  const revision = normalizeCount(value.revision);
  const lastAttemptAt = normalizeTimestamp(value.lastAttemptAt, null);
  if (
    !normalizedModuleId
    || (status !== 'complete' && status !== 'partial' && status !== 'failed')
    || loaded === null
    || total === undefined
    || revision === null
    || !lastAttemptAt
  ) return null;

  const unit = normalizeUnit(value.unit);
  const savedAt = normalizeTimestamp(value.savedAt, null);
  if (status === 'complete' || status === 'partial') {
    if (revision < 1 || !savedAt) return null;
    return {
      moduleId: normalizedModuleId,
      status,
      availableStatus: status,
      loaded,
      total,
      unit,
      revision,
      savedAt,
      lastAttemptAt,
      errorCode: null,
      errorMessage: null,
    };
  }

  const availableStatus = value.availableStatus === 'complete' || value.availableStatus === 'partial'
    ? value.availableStatus
    : null;
  if ((revision > 0 && (!savedAt || !availableStatus)) || (revision === 0 && (savedAt || availableStatus))) {
    return null;
  }
  return {
    moduleId: normalizedModuleId,
    status: 'failed',
    availableStatus,
    loaded,
    total,
    unit,
    revision,
    savedAt,
    lastAttemptAt,
    errorCode: normalizeErrorCode(value.errorCode),
    errorMessage: normalizeErrorMessage(value.errorMessage),
  };
}

function normalizeManifest(value: unknown, userId: number): NativeOfflineCoverageManifest | null {
  if (!isRecord(value) || value.version !== 1 || value.userId !== userId || !isRecord(value.entries)) {
    return null;
  }
  const updatedAt = normalizeTimestamp(value.updatedAt, null);
  if (!updatedAt) return null;
  const entries: Record<string, NativeOfflineCoverageEntry> = {};
  for (const [moduleId, rawEntry] of Object.entries(value.entries).slice(0, MAX_COVERAGE_ENTRIES)) {
    const entry = normalizeEntry(moduleId, rawEntry);
    if (entry) entries[moduleId] = entry;
  }
  return { version: 1, userId, updatedAt, entries };
}

async function readManifest(userId: number): Promise<NativeOfflineCoverageManifest | null> {
  let raw: string | null;
  try {
    raw = await readEncryptedNativeSnapshot(OFFLINE_COVERAGE_SCOPE, userId);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const manifest = normalizeManifest(JSON.parse(raw), userId);
    if (manifest) return manifest;
  } catch {
    // The encrypted value is readable but its payload is no longer a valid manifest.
  }
  await deleteEncryptedNativeSnapshot(OFFLINE_COVERAGE_SCOPE, userId).catch(() => undefined);
  return null;
}

function emptyManifest(userId: number, updatedAt: string): NativeOfflineCoverageManifest {
  return { version: 1, userId, updatedAt, entries: {} };
}

async function storeManifest(manifest: NativeOfflineCoverageManifest): Promise<boolean> {
  try {
    return await writeEncryptedNativeSnapshot(
      OFFLINE_COVERAGE_SCOPE,
      manifest.userId,
      JSON.stringify(manifest),
    );
  } catch {
    return false;
  }
}

function withManifestMutation<T>(userId: number, operation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(userId) || Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  let marker: Promise<void>;
  marker = result.then(() => undefined, () => undefined).finally(() => {
    if (mutationQueues.get(userId) === marker) mutationQueues.delete(userId);
  });
  mutationQueues.set(userId, marker);
  return result;
}

export async function readNativeOfflineCoverage(
  userId: number,
): Promise<NativeOfflineCoverageManifest | null> {
  const owner = normalizeUserId(userId);
  if (!owner) return null;
  await mutationQueues.get(owner)?.catch(() => undefined);
  return readManifest(owner);
}

export function recordNativeOfflineCoverageSuccess(
  userId: number,
  moduleId: string,
  metric: NativeOfflineCoverageSuccessMetric,
): Promise<boolean> {
  const owner = normalizeUserId(userId);
  const module = normalizeModuleId(moduleId);
  const loaded = normalizeCount(metric?.loaded);
  const total = normalizeTotal(metric?.total);
  if (
    !owner
    || !module
    || !metric
    || (metric.status !== 'complete' && metric.status !== 'partial')
    || loaded === null
    || total === undefined
  ) return Promise.resolve(false);

  return withManifestMutation(owner, async () => {
    const now = currentTimestamp();
    const lastAttemptAt = normalizeTimestamp(metric.lastAttemptAt, now) || now;
    const savedAt = normalizeTimestamp(metric.savedAt, lastAttemptAt) || lastAttemptAt;
    const previous = await readManifest(owner);
    const previousRevision = previous?.entries[module]?.revision || 0;
    const manifest = previous || emptyManifest(owner, lastAttemptAt);
    manifest.updatedAt = lastAttemptAt;
    manifest.entries[module] = {
      moduleId: module,
      status: metric.status,
      availableStatus: metric.status,
      loaded,
      total,
      unit: normalizeUnit(metric.unit),
      revision: previousRevision + 1,
      savedAt,
      lastAttemptAt,
      errorCode: null,
      errorMessage: null,
    };
    return storeManifest(manifest);
  });
}

export function recordNativeOfflineCoverageFailure(
  userId: number,
  moduleId: string,
  error: NativeOfflineCoverageFailure,
): Promise<boolean> {
  const owner = normalizeUserId(userId);
  const module = normalizeModuleId(moduleId);
  if (!owner || !module || !error) return Promise.resolve(false);

  return withManifestMutation(owner, async () => {
    const now = currentTimestamp();
    const lastAttemptAt = normalizeTimestamp(error.lastAttemptAt, now) || now;
    const previous = await readManifest(owner);
    const available = previous?.entries[module];
    const manifest = previous || emptyManifest(owner, lastAttemptAt);
    manifest.updatedAt = lastAttemptAt;
    manifest.entries[module] = {
      moduleId: module,
      status: 'failed',
      availableStatus: available?.availableStatus || null,
      loaded: available?.loaded || 0,
      total: available?.total ?? null,
      unit: available?.unit || normalizeUnit(error.unit),
      revision: available?.revision || 0,
      savedAt: available?.savedAt || null,
      lastAttemptAt,
      errorCode: normalizeErrorCode(error.errorCode),
      errorMessage: normalizeErrorMessage(error.errorMessage),
    };
    return storeManifest(manifest);
  });
}

export async function clearNativeOfflineCoverage(userId: number): Promise<void> {
  const owner = normalizeUserId(userId);
  if (!owner) return;
  await withManifestMutation(owner, async () => {
    await deleteEncryptedNativeSnapshot(OFFLINE_COVERAGE_SCOPE, owner);
  });
}
