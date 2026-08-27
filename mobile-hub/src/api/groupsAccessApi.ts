import apiClient from './client';

type UnknownRecord = Record<string, unknown>;

export type GroupsAccessLevel = 'read' | 'write' | 'full' | 'member' | string;

export type GroupsAccessGroup = {
  dn: string;
  cn: string;
  branch: string;
  folder_label: string;
  folder_path: string;
  access_level: GroupsAccessLevel;
  member_count: number;
  description: string;
};

export type GroupsAccessStatus = {
  status: string;
  last_sync_at: string;
  error: string;
  branches: string[];
  summary: { group_count: number; user_count: number };
};

export type GroupsAccessGroupsPage = {
  items: GroupsAccessGroup[];
  total: number;
  page: number;
  limit: number;
  has_more: boolean;
  synced_at: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function boundedString(value: unknown, maxLength: number): string {
  return asString(value).slice(0, maxLength);
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asCount(value: unknown, max = 10_000_000): number {
  return Math.min(max, Math.max(0, Math.floor(asNumber(value))));
}

function asStringArray(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map(asString).filter(Boolean);
}

function compactParams(values: UnknownRecord): UnknownRecord {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));
}

export function normalizeGroupsAccessGroup(value: unknown): GroupsAccessGroup | null {
  const source = asRecord(value);
  const dn = boundedString(source.dn, 1024);
  const cn = boundedString(source.cn, 256);
  if (!dn || !cn) return null;
  return {
    dn,
    cn,
    branch: boundedString(source.branch, 128),
    folder_label: boundedString(source.folder_label, 512) || cn,
    folder_path: boundedString(source.folder_path, 1024) || boundedString(source.folder_label, 512) || cn,
    access_level: boundedString(source.access_level, 32) || 'member',
    member_count: asCount(source.member_count, 1_000_000),
    description: boundedString(source.description, 2000),
  };
}

export async function getGroupsAccessStatus(options: { signal?: AbortSignal } = {}): Promise<GroupsAccessStatus> {
  const response = await apiClient.get('/groups-access/status', { signal: options.signal });
  const source = asRecord(response.data);
  const summary = asRecord(source.summary);
  return {
    status: asString(source.status) || 'never',
    last_sync_at: asString(source.last_sync_at),
    error: asString(source.error),
    branches: [...new Set(asStringArray(source.branches).map((item) => item.slice(0, 128)))].slice(0, 50),
    summary: {
      group_count: asCount(summary.group_count),
      user_count: asCount(summary.user_count),
    },
  };
}

export async function listGroupsAccessGroups(options: {
  branch?: string;
  q?: string;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<GroupsAccessGroupsPage> {
  const page = Math.max(1, Math.floor(Number(options.page) || 1));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(options.limit) || 40)));
  const response = await apiClient.get('/groups-access/matrix', {
    params: compactParams({
      branch: asString(options.branch) || undefined,
      q: asString(options.q).slice(0, 200) || undefined,
      page,
      limit,
    }),
    signal: options.signal,
  });
  const source = asRecord(response.data);
  const items = (Array.isArray(source.items) ? source.items : [])
    .slice(0, limit)
    .map(normalizeGroupsAccessGroup)
    .filter((item): item is GroupsAccessGroup => item !== null);
  const total = Math.max(items.length, asCount(source.total));
  const responsePage = Math.max(1, asCount(source.page) || page);
  const responseLimit = Math.min(limit, Math.max(1, asCount(source.limit) || limit));
  return {
    items,
    total,
    page: responsePage,
    limit: responseLimit,
    has_more: responsePage * responseLimit < total && items.length > 0,
    synced_at: asString(source.synced_at),
  };
}
