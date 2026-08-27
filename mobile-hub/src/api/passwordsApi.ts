import apiClient from './client';

type UnknownRecord = Record<string, unknown>;

const MAX_NATIVE_PASSWORD_ENTRIES = 500;

export type PasswordVaultEntry = {
  id: string;
  group: string;
  tags: string[];
  login: string;
  description: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  password_configured: boolean;
};

export type PasswordVaultList = {
  items: PasswordVaultEntry[];
  groups: string[];
  tags: string[];
  unlocked_until: string;
};

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function asString(value: unknown): string {
  return String(value ?? '').trim();
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes'].includes(asString(value).toLowerCase());
}

function asStringArray(value: unknown, maxLength: number, itemLength: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = asString(item).slice(0, itemLength);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length >= maxLength) break;
  }
  return result;
}

function normalizeEntry(value: unknown): PasswordVaultEntry | null {
  const source = asRecord(value);
  const id = asString(source.id);
  const login = asString(source.login);
  if (!id || !login) return null;
  return {
    id,
    group: asString(source.group).slice(0, 120),
    tags: asStringArray(source.tags, 20, 64),
    login: login.slice(0, 255),
    description: asString(source.description).slice(0, 4_000),
    is_archived: asBoolean(source.is_archived),
    created_at: asString(source.created_at),
    updated_at: asString(source.updated_at),
    created_by: asString(source.created_by),
    updated_by: asString(source.updated_by),
    password_configured: source.password_configured === undefined ? true : asBoolean(source.password_configured),
  };
}

export async function listPasswordVaultEntries(options: {
  q?: string;
  group?: string;
  tag?: string;
  includeArchived?: boolean;
  signal?: AbortSignal;
} = {}): Promise<PasswordVaultList> {
  const response = await apiClient.get('/passwords', {
    params: {
      q: asString(options.q).slice(0, 200),
      group: asString(options.group).slice(0, 120),
      tag: asString(options.tag).replace(/^#+/, '').slice(0, 64),
      include_archived: options.includeArchived === true,
    },
    signal: options.signal,
  });
  const source = asRecord(response.data);
  return {
    items: (Array.isArray(source.items) ? source.items : [])
      .slice(0, MAX_NATIVE_PASSWORD_ENTRIES)
      .map(normalizeEntry)
      .filter((item): item is PasswordVaultEntry => item !== null),
    groups: asStringArray(source.groups, 500, 120),
    tags: asStringArray(source.tags, 500, 64),
    unlocked_until: asString(source.unlocked_until),
  };
}
