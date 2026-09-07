// Only technical metadata may cross this boundary. Never persist arbitrary error
// messages: JSON/native/HTTP exceptions can contain the complete input payload.
export type SnapshotDiagnostic = {
  scope: string;
  stage: string;
  errorType: string;
  errorCode: string | null;
  message: string;
  stack: string;
  sizes: Record<string, number>;
  files: Record<string, { exists: boolean | null; size: number | null }>;
};

export type SnapshotDiagnosticMetrics = Pick<SnapshotDiagnostic, 'sizes' | 'files'>;

const SCOPES = [
  'offline-coverage-manifest', 'address-book', 'dashboard', 'feed', 'tasks', 'chat', 'mail',
  'notifications', 'docflow', 'database', 'my-files', 'company-structure',
];

function technicalScope(value: string): string {
  // Drop entity IDs, revision IDs and filter keys, which may identify a person.
  const scope = value.replace(/^addressBook$/, 'address-book').replace(/^myFiles$/, 'my-files')
    .replace(/^companyStructure$/, 'company-structure');
  const prefix = SCOPES.find((item) => scope === item || scope.startsWith(`${item}-`));
  if (!prefix) return 'other';
  return prefix + (scope.includes('-shard') ? '-shard' : scope.includes('-collection') ? '-collection' : '');
}

function safeMessage(message: string): string {
  // The native converter includes the entire offending base64 argument in its
  // exception. Keep only its fixed explanation, never that argument.
  if (message.includes('fromCombined') && message.includes('expected an Object')) {
    return '[fromCombined] Cannot convert [redacted] to a Kotlin type; expected an Object (Uint8Array)';
  }
  const fixed = message.match(/Snapshot (?:staging verification failed|commit verification failed|size limit exceeded|shard verification failed|manifest verification failed|read returned a non-string)|Empty encrypted (?:snapshot|backup)|Offline coverage manifest write failed|EACCES: permission denied|ENOSPC: no space left on device|ENOENT: no such file or directory|Unsupported state or unable to authenticate data|Tag mismatch|mac check in GCM failed|AES decryption failed|AES encryption failed|Destination already exists/g);
  const bridge = message.match(/(?:FileSystemFile|FileSystemDirectory)\.(?:text|write|move|copy|delete|bytes|base64)\b/g);
  return [...(bridge || []), ...(fixed || [])].join('; ').slice(0, 240) || 'Exception message redacted (not an approved technical message)';
}

export function makeSnapshotDiagnostic(
  scope: string,
  stage: string,
  error: unknown,
  metrics: Partial<SnapshotDiagnosticMetrics> = {},
): SnapshotDiagnostic {
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown } | null;
  const errorType = String(candidate?.name || 'Error');
  const errorCode = String(candidate?.code || '');
  const sizes: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics.sizes || {}).slice(0, 10)) {
    if (/^[a-zA-Z]{1,32}$/.test(key) && Number.isSafeInteger(value) && value >= 0) sizes[key] = value;
  }
  const files: SnapshotDiagnostic['files'] = {};
  for (const key of ['pending', 'target', 'backup', 'legacy']) {
    const file = metrics.files?.[key];
    if (file) files[key] = {
      exists: typeof file.exists === 'boolean' ? file.exists : null,
      size: Number.isSafeInteger(file.size) && Number(file.size) >= 0 ? file.size : null,
    };
  }
  // Preserve stack frame names + line/column, never the message or a filesystem/URL path.
  const stack = String(candidate?.stack || '').split('\n').flatMap((line) => {
    const source = line.match(/\b(nativeSnapshotStorage\.ts|nativeSnapshotCache\.ts|nativeAddressBookSnapshot\.ts|nativeOfflineCoverage\.ts|nativeOfflinePreparation\.ts|nativeReadCacheRefresh\.ts|index\.android\.bundle)\b/)?.[1] || '<source>';
    const frame = line.match(/^\s*at ([A-Za-z_$][\w.$<>]*) (?:\(.*:)(\d+):(\d+)\)\s*$/)
      || line.match(/^([A-Za-z_$][\w.$<>]*)@.*:(\d+):(\d+)\s*$/);
    const anonymous = line.match(/^\s*at .*:(\d+):(\d+)\)?\s*$/);
    return frame ? [`at ${frame[1]} (${source}:${frame[2]}:${frame[3]})`]
      : anonymous ? [`at ${source}:${anonymous[1]}:${anonymous[2]}`] : [];
  }).slice(0, 8).join('\n');
  return {
    scope: technicalScope(scope),
    stage: /^[a-z][a-z-]{0,47}$/.test(stage) ? stage : 'unknown',
    errorType: /^[A-Za-z][A-Za-z0-9_.]{0,63}(?:Error|Exception)$/.test(errorType) || errorType === 'Error' ? errorType : 'Error',
    errorCode: /^(?:E_[A-Z0-9_]{1,60}|ERR_[A-Z0-9_]{1,60}|EACCES|ENOENT|ENOSPC)$/.test(errorCode) ? errorCode : null,
    message: safeMessage(String(candidate?.message || '')),
    stack, sizes, files,
  };
}

export function normalizeSnapshotDiagnostic(value: SnapshotDiagnostic): SnapshotDiagnostic {
  return makeSnapshotDiagnostic(value.scope || '', value.stage || '', {
    name: value.errorType, code: value.errorCode, message: value.message, stack: value.stack,
  }, value);
}
