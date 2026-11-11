import apiClient from './client';

export type MonitoringDeviceInfo = {
  description?: string | null;
  sys_name?: string | null;
  cpu_pct?: number | null;
  memory_pct?: number | null;
  temperature_c?: number | null;
  resources_at?: string | null;
};

export type MonitoringTargetCurrent = {
  status?: string | null;
  snmp_status?: string | null;
  snmp_error?: string | null;
  checked_at?: string | null;
  icmp_checked_at?: string | null;
  last_success_at?: string | null;
  open_events?: number | null;
  ping?: { status?: string | null; latency_ms?: number | null } | null;
  device?: MonitoringDeviceInfo | null;
  availability?: {
    unreachable_since?: string | null;
    observed_since?: string | null;
    first_reachable_at?: string | null;
    ever_reachable?: boolean;
    initial_state_known?: boolean;
  } | null;
};

export type MonitoringEvent = {
  id: string;
  target_id: string;
  interface_id?: string | null;
  kind: string;
  title: string;
  severity: string;
  opened_at: string;
  closed_at?: string | null;
  interface_name?: string | null;
  interface_role?: string | null;
};

export type MonitoringSummaryPoint = { at: string; rx_bps?: number | null; tx_bps?: number | null };

export type MonitoringTargetSummary = {
  interface_id: string;
  name: string;
  pinned?: boolean;
  checked_at?: string | null;
  rx_bps?: number | null;
  tx_bps?: number | null;
  speed_bps?: number | null;
  points: MonitoringSummaryPoint[];
};

export type MonitoringInterface = {
  id: string;
  name: string;
  snmp_index?: number;
  settings?: { critical?: boolean; pinned?: boolean; role?: string | null; history_enabled?: boolean } | null;
  current?: {
    checked_at?: string | null;
    admin?: number | null;
    oper?: number | null;
    type?: number | null;
    alias?: string | null;
    speed_bps?: number | null;
    rx_bps?: number | null;
    tx_bps?: number | null;
    rx_util_pct?: number | null;
    tx_util_pct?: number | null;
  } | null;
};

export type MonitoringTarget = {
  id: string;
  name: string;
  address: string;
  port?: number;
  enabled: boolean;
  current?: MonitoringTargetCurrent | null;
  outages?: MonitoringEvent[];
  summary?: MonitoringTargetSummary | null;
};

export type MonitoringTargetDetail = MonitoringTarget & {
  interfaces: MonitoringInterface[];
  events: MonitoringEvent[];
};

export type MonitoringWorker = { enabled: boolean; heartbeat_at?: string | null };

export type MonitoringOverview = {
  targets: MonitoringTarget[];
  worker?: MonitoringWorker | null;
  checked_at?: string | null;
};

export type MonitoringHistoryPoint = {
  at: string;
  rx_bps?: number | null;
  tx_bps?: number | null;
  rx_util_pct?: number | null;
  tx_util_pct?: number | null;
  cpu_pct?: number | null;
  memory_pct?: number | null;
  latency_ms?: number | null;
};

export type MonitoringHistory = {
  points: MonitoringHistoryPoint[];
  has_data?: boolean;
  resolution_seconds?: number;
};

type RequestOptions = { signal?: AbortSignal };

export async function fetchMonitoringOverview(options: RequestOptions = {}): Promise<MonitoringOverview> {
  const { data } = await apiClient.get('/monitoring/overview', { signal: options.signal });
  return {
    targets: Array.isArray(data?.targets) ? data.targets : [],
    worker: data?.worker ?? null,
    checked_at: data?.checked_at ?? null,
  };
}

export async function fetchMonitoringTarget(targetId: string, options: RequestOptions = {}): Promise<MonitoringTargetDetail> {
  const { data } = await apiClient.get(`/monitoring/targets/${encodeURIComponent(targetId)}`, { signal: options.signal });
  return {
    ...data,
    interfaces: Array.isArray(data?.interfaces) ? data.interfaces : [],
    events: Array.isArray(data?.events) ? data.events : [],
  };
}

export async function fetchMonitoringHistory(
  targetId: string,
  options: RequestOptions & { interfaceId?: string; hours?: number } = {},
): Promise<MonitoringHistory> {
  const { data } = await apiClient.get(`/monitoring/targets/${encodeURIComponent(targetId)}/history`, {
    params: { interface_id: options.interfaceId || '', hours: options.hours ?? 24 },
    signal: options.signal,
  });
  return { ...data, points: Array.isArray(data?.points) ? data.points : [] };
}

export async function fetchMonitoringLatency(
  targetId: string,
  options: RequestOptions & { hours?: number } = {},
): Promise<MonitoringHistory> {
  const { data } = await apiClient.get(`/monitoring/targets/${encodeURIComponent(targetId)}/latency-history`, {
    params: { hours: options.hours ?? 24 },
    signal: options.signal,
  });
  return { ...data, points: Array.isArray(data?.points) ? data.points : [] };
}
