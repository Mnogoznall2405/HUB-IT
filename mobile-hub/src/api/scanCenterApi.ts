import apiClient from './client';

type UnknownRecord = Record<string, unknown>;

export type ScanCenterSection = 'overview' | 'incidents' | 'review' | 'agents' | 'hosts';
export type ScanIncidentStatus = 'new' | 'ack';
export type ScanSeverity = 'high' | 'medium' | 'low' | 'none';

export type ScanDashboard = {
  totals: Record<string, number>;
  performance: UnknownRecord & {
    completed: number;
    throughput_per_hour: number;
    pending_oldest_age_sec: number;
  };
  ingest_limits: Record<string, number>;
  expected_agent_version: string;
  cached: boolean;
  degraded: boolean;
  cache_age_sec: number;
  daily: unknown[];
  by_severity: unknown[];
  by_branch: unknown[];
};

export type ScanReviewItem = {
  id: string;
  hostname: string;
  agent_id: string;
  branch: string;
  file_name: string;
  source_kind: string;
  reason: string;
  created_at: string | number;
};

export type ScanIncident = {
  id: string;
  hostname: string;
  branch: string;
  file_name: string;
  file_ext: string;
  source_kind: string;
  status: string;
  severity: string;
  category: string;
  short_reason: string;
  user: string;
  created_at: string | number;
};

export type ScanAgent = {
  agent_id: string;
  hostname: string;
  branch: string;
  ip_address: string;
  version: string;
  is_online: boolean;
  last_seen_at: string | number;
  queue_size: number;
  active_task: { command?: string; status?: string } | null;
};

export type ScanHost = {
  hostname: string;
  branch: string;
  ip_address: string;
  incidents_total: number;
  incidents_new: number;
  top_severity: string;
  last_incident_at: string | number;
  top_exts: string[];
  top_source_kinds: string[];
};

export type ScanList<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset: number | null;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'online'].includes(asString(value).toLowerCase());
}

function asTimestamp(value: unknown): string | number {
  return typeof value === 'number' && Number.isFinite(value) ? value : asString(value);
}

function numericRecord(value: unknown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(asRecord(value)).map(([key, item]) => [key, asNumber(item)]),
  );
}

function normalizePage<T>(
  value: unknown,
  normalize: (item: unknown) => T | null,
  fallback: { limit: number; offset: number },
): ScanList<T> {
  const source = asRecord(value);
  const items = (Array.isArray(source.items) ? source.items : [])
    .map(normalize)
    .filter((item): item is T => item !== null);
  const limit = Math.max(1, source.limit === undefined ? fallback.limit : asNumber(source.limit) || fallback.limit);
  const offset = Math.max(0, source.offset === undefined ? fallback.offset : asNumber(source.offset));
  const total = Math.max(items.length, asNumber(source.total));
  const nextOffsetRaw = source.next_offset;
  const nextOffset = nextOffsetRaw === null || nextOffsetRaw === undefined || nextOffsetRaw === ''
    ? null
    : Math.max(0, asNumber(nextOffsetRaw));
  return {
    items,
    total,
    limit,
    offset,
    has_more: typeof source.has_more === 'boolean' ? source.has_more : offset + items.length < total,
    next_offset: nextOffset ?? (offset + items.length < total ? offset + items.length : null),
  };
}

function normalizeReviewItem(value: unknown): ScanReviewItem | null {
  const source = asRecord(value);
  const id = asString(source.id || source.job_id || source.event_id);
  if (!id) return null;
  return {
    id,
    hostname: asString(source.hostname),
    agent_id: asString(source.agent_id),
    branch: asString(source.branch),
    file_name: asString(source.file_name),
    source_kind: asString(source.source_kind),
    reason: asString(source.reason || source.error_text || source.summary),
    created_at: asTimestamp(source.created_at || source.updated_at),
  };
}

function normalizeIncident(value: unknown): ScanIncident | null {
  const source = asRecord(value);
  const id = asString(source.id || source.incident_id);
  if (!id) return null;
  return {
    id,
    hostname: asString(source.hostname || source.agent_id),
    branch: asString(source.branch),
    file_name: asString(source.file_name),
    file_ext: asString(source.file_ext),
    source_kind: asString(source.source_kind),
    status: asString(source.status),
    severity: asString(source.severity),
    category: asString(source.category),
    short_reason: asString(source.short_reason || source.reason),
    user: asString(source.user_full_name || source.user_login || source.user),
    created_at: asTimestamp(source.created_at),
  };
}

function normalizeAgent(value: unknown): ScanAgent | null {
  const source = asRecord(value);
  const agentId = asString(source.agent_id);
  if (!agentId) return null;
  const activeTask = asRecord(source.active_task);
  const safeActiveTask = Object.keys(activeTask).length ? {
    command: asString(activeTask.command),
    status: asString(activeTask.status),
  } : null;
  return {
    agent_id: agentId,
    hostname: asString(source.hostname || agentId),
    branch: asString(source.branch),
    ip_address: asString(source.ip_address),
    version: asString(source.version),
    is_online: asBoolean(source.is_online),
    last_seen_at: asTimestamp(source.last_seen_at),
    queue_size: Math.max(0, asNumber(source.queue_size || source.queue_pending)),
    active_task: safeActiveTask,
  };
}

function normalizeHost(value: unknown): ScanHost | null {
  const source = asRecord(value);
  const hostname = asString(source.hostname);
  if (!hostname) return null;
  return {
    hostname,
    branch: asString(source.branch),
    ip_address: asString(source.ip_address),
    incidents_total: Math.max(0, asNumber(source.incidents_total)),
    incidents_new: Math.max(0, asNumber(source.incidents_new)),
    top_severity: asString(source.top_severity || 'none'),
    last_incident_at: asTimestamp(source.last_incident_at),
    top_exts: (Array.isArray(source.top_exts) ? source.top_exts : []).map(asString).filter(Boolean),
    top_source_kinds: (Array.isArray(source.top_source_kinds) ? source.top_source_kinds : []).map(asString).filter(Boolean),
  };
}

function compactParams(values: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));
}

export async function getScanDashboard(options: { signal?: AbortSignal } = {}): Promise<ScanDashboard> {
  const response = await apiClient.get('/scan/dashboard', { signal: options.signal });
  const source = asRecord(response.data);
  const performance = asRecord(source.performance);
  return {
    totals: numericRecord(source.totals),
    performance: {
      ...performance,
      completed: asNumber(performance.completed),
      throughput_per_hour: asNumber(performance.throughput_per_hour),
      pending_oldest_age_sec: asNumber(performance.pending_oldest_age_sec),
    },
    ingest_limits: numericRecord(source.ingest_limits),
    expected_agent_version: asString(source.expected_agent_version),
    cached: asBoolean(source.cached),
    degraded: asBoolean(source.degraded),
    cache_age_sec: Math.max(0, asNumber(source.cache_age_sec)),
    daily: Array.isArray(source.daily) ? source.daily : [],
    by_severity: Array.isArray(source.by_severity) ? source.by_severity : [],
    by_branch: Array.isArray(source.by_branch) ? source.by_branch : [],
  };
}

export async function listScanReviewItems(options: { limit?: number; offset?: number; signal?: AbortSignal } = {}): Promise<ScanList<ScanReviewItem>> {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const response = await apiClient.get('/scan/review-items', { params: { view: 'mobile', limit, offset }, signal: options.signal });
  return normalizePage(response.data, normalizeReviewItem, { limit, offset });
}

export async function listScanIncidents(options: {
  status?: 'new' | 'ack' | '';
  q?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}): Promise<ScanList<ScanIncident>> {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const response = await apiClient.get('/scan/incidents', {
    params: compactParams({
      view: 'mobile',
      status: options.status,
      q: asString(options.q).slice(0, 200) || undefined,
      limit,
      offset,
    }),
    signal: options.signal,
  });
  return normalizePage(response.data, normalizeIncident, { limit, offset });
}

export async function listScanAgents(options: {
  q?: string;
  online?: 'online' | 'offline' | '';
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}): Promise<ScanList<ScanAgent>> {
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const response = await apiClient.get('/scan/agents/table', {
    params: compactParams({
      q: asString(options.q).slice(0, 200) || undefined,
      online: options.online,
      limit,
      offset,
      sort_by: 'online',
      sort_dir: 'desc',
      view: 'mobile',
    }),
    signal: options.signal,
  });
  return normalizePage(response.data, normalizeAgent, { limit, offset });
}

export async function listScanHosts(options: {
  q?: string;
  status?: 'new' | 'ack' | '';
  severity?: 'high' | 'medium' | 'low' | '';
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}): Promise<ScanList<ScanHost>> {
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 50));
  const offset = Math.max(0, Number(options.offset) || 0);
  const response = await apiClient.get('/scan/hosts/table', {
    params: compactParams({
      q: asString(options.q).slice(0, 200) || undefined,
      status: options.status,
      severity: options.severity,
      limit,
      offset,
      sort_by: 'incidents_new',
      sort_dir: 'desc',
      view: 'mobile',
    }),
    signal: options.signal,
  });
  return normalizePage(response.data, normalizeHost, { limit, offset });
}
