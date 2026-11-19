import * as tokenStore from '../auth/tokenStore';
import apiClient, { withMobileAuthHeaders } from './client';

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
  /** Server-side total for the current filters; `items` may be capped. */
  total: number;
  /** True when `items` was truncated by the native cap — deeper entries need a narrower search. */
  truncated: boolean;
};

export type PasswordVaultRevealResult = {
  password: string;
  unlocked_until: string;
};

export type PasswordVaultEntryUpdate = {
  group: string;
  tags: string[];
  login: string;
  description: string;
  password?: string;
};

export type PasswordVaultEntryCreate = {
  group: string;
  tags: string[];
  login: string;
  description: string;
  password: string;
};

export type PasswordVaultGroup = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type PasswordVaultGroupUpdate = {
  name?: string;
  sort_order?: number;
  is_active?: boolean;
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

function normalizeGroupOrder(value: unknown): number {
  return Math.max(0, Math.min(10_000, Math.trunc(Number(value) || 0)));
}

function normalizeGroup(value: unknown): PasswordVaultGroup | null {
  const source = asRecord(value);
  const id = asString(source.id);
  const name = asString(source.name);
  if (!id || !name) return null;
  return {
    id,
    name: name.slice(0, 120),
    sort_order: normalizeGroupOrder(source.sort_order),
    is_active: source.is_active === undefined ? true : asBoolean(source.is_active),
  };
}

function requireEntry(value: unknown): PasswordVaultEntry {
  const entry = normalizeEntry(value);
  if (!entry) throw new Error('Сервер вернул некорректную запись пароля');
  return entry;
}

function requireGroup(value: unknown): PasswordVaultGroup {
  const group = normalizeGroup(value);
  if (!group) throw new Error('Сервер вернул некорректную группу паролей');
  return group;
}

// Mutations go through the mobile client identity so the backend can apply the
// same device-bound checks it already enforces for entry updates.
async function mobileAuthHeaders(): Promise<Record<string, string>> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  return withMobileAuthHeaders(clientDeviceId);
}

const PASSWORDS_PAGE_SIZE = 200;

export async function listPasswordVaultEntries(options: {
  q?: string;
  group?: string;
  tag?: string;
  includeArchived?: boolean;
  signal?: AbortSignal;
} = {}): Promise<PasswordVaultList> {
  const baseParams = {
    q: asString(options.q).slice(0, 200),
    group: asString(options.group).slice(0, 120),
    tag: asString(options.tag).replace(/^#+/, '').slice(0, 64),
    include_archived: options.includeArchived === true,
  };
  // The backend pages at limit=100 by default: fetch all pages up to the
  // native cap so large vaults are not silently truncated to the first 100.
  const items: PasswordVaultEntry[] = [];
  let groups: string[] = [];
  let tags: string[] = [];
  let unlockedUntil = '';
  let total = 0;
  let offset = 0;
  for (;;) {
    const response = await apiClient.get('/passwords', {
      params: { ...baseParams, limit: PASSWORDS_PAGE_SIZE, offset },
      signal: options.signal,
    });
    const source = asRecord(response.data);
    const page = (Array.isArray(source.items) ? source.items : [])
      .map(normalizeEntry)
      .filter((item): item is PasswordVaultEntry => item !== null);
    items.push(...page);
    total = Number(source.total);
    if (!Number.isFinite(total) || total < 0) total = offset + page.length;
    groups = asStringArray(source.groups, 500, 120);
    tags = asStringArray(source.tags, 500, 64);
    unlockedUntil = asString(source.unlocked_until) || unlockedUntil;
    offset += page.length;
    if (page.length < PASSWORDS_PAGE_SIZE || items.length >= MAX_NATIVE_PASSWORD_ENTRIES) break;
  }
  return {
    items: items.slice(0, MAX_NATIVE_PASSWORD_ENTRIES),
    groups,
    tags,
    unlocked_until: unlockedUntil,
    total,
    truncated: total > MAX_NATIVE_PASSWORD_ENTRIES,
  };
}

export async function unlockPasswordVaultWithBiometrics(renewalToken: string): Promise<{ unlocked_until: string }> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  const response = await apiClient.post('/passwords/unlock/mobile-biometric', {
    renewal_token: String(renewalToken || '').trim(),
  }, {
    headers: withMobileAuthHeaders(clientDeviceId),
  });
  return { unlocked_until: asString(asRecord(response.data).unlocked_until) };
}

export async function revealPasswordVaultEntry(
  entryId: string,
  purpose: 'show' | 'copy',
): Promise<PasswordVaultRevealResult> {
  const response = await apiClient.post(
    `/passwords/${encodeURIComponent(asString(entryId))}/reveal`,
    { purpose },
  );
  const source = asRecord(response.data);
  return {
    password: String(source.password ?? ''),
    unlocked_until: asString(source.unlocked_until),
  };
}

export async function updatePasswordVaultEntry(
  entryId: string,
  payload: PasswordVaultEntryUpdate,
): Promise<PasswordVaultEntry> {
  const clientDeviceId = await tokenStore.getOrCreateClientDeviceId();
  const normalizedPayload: PasswordVaultEntryUpdate = {
    group: asString(payload.group).slice(0, 120),
    tags: asStringArray(payload.tags.map((tag) => asString(tag).replace(/^#+/, '')), 20, 64),
    login: asString(payload.login).slice(0, 255),
    description: asString(payload.description).slice(0, 4_000),
    ...(payload.password !== undefined ? { password: String(payload.password).slice(0, 4_096) } : {}),
  };
  const response = await apiClient.patch(
    `/passwords/${encodeURIComponent(asString(entryId))}`,
    normalizedPayload,
    { headers: withMobileAuthHeaders(clientDeviceId) },
  );
  const entry = normalizeEntry(response.data);
  if (!entry) throw new Error('Сервер вернул некорректную запись пароля');
  return entry;
}

export async function createPasswordVaultEntry(
  payload: PasswordVaultEntryCreate,
): Promise<PasswordVaultEntry> {
  const normalizedPayload = {
    group: asString(payload.group).slice(0, 120),
    tags: asStringArray(payload.tags.map((tag) => asString(tag).replace(/^#+/, '')), 20, 64),
    login: asString(payload.login).slice(0, 255),
    description: asString(payload.description).slice(0, 4_000),
    password: String(payload.password ?? '').slice(0, 4_096),
  };
  const response = await apiClient.post('/passwords', normalizedPayload, {
    headers: await mobileAuthHeaders(),
  });
  return requireEntry(response.data);
}

export async function archivePasswordVaultEntry(entryId: string): Promise<PasswordVaultEntry> {
  const response = await apiClient.post(
    `/passwords/${encodeURIComponent(asString(entryId))}/archive`,
    undefined,
    { headers: await mobileAuthHeaders() },
  );
  return requireEntry(response.data);
}

export async function listPasswordVaultGroups(options: {
  includeInactive?: boolean;
} = {}): Promise<PasswordVaultGroup[]> {
  const response = await apiClient.get('/passwords/groups', {
    params: { include_inactive: options.includeInactive === true },
  });
  const source = asRecord(response.data);
  return (Array.isArray(source.items) ? source.items : [])
    .map(normalizeGroup)
    .filter((item): item is PasswordVaultGroup => item !== null)
    .slice(0, 500);
}

export async function createPasswordVaultGroup(payload: {
  name: string;
  sort_order?: number;
}): Promise<PasswordVaultGroup> {
  const response = await apiClient.post('/passwords/groups', {
    name: asString(payload.name).slice(0, 120),
    sort_order: normalizeGroupOrder(payload.sort_order),
  }, { headers: await mobileAuthHeaders() });
  return requireGroup(response.data);
}

export async function updatePasswordVaultGroup(
  groupId: string,
  payload: PasswordVaultGroupUpdate,
): Promise<PasswordVaultGroup> {
  const normalizedPayload: Record<string, unknown> = {};
  if (payload.name !== undefined) normalizedPayload.name = asString(payload.name).slice(0, 120);
  if (payload.sort_order !== undefined) normalizedPayload.sort_order = normalizeGroupOrder(payload.sort_order);
  if (payload.is_active !== undefined) normalizedPayload.is_active = payload.is_active === true;
  const response = await apiClient.patch(
    `/passwords/groups/${encodeURIComponent(asString(groupId))}`,
    normalizedPayload,
    { headers: await mobileAuthHeaders() },
  );
  return requireGroup(response.data);
}

export async function archivePasswordVaultGroup(groupId: string): Promise<PasswordVaultGroup> {
  const response = await apiClient.post(
    `/passwords/groups/${encodeURIComponent(asString(groupId))}/archive`,
    undefined,
    { headers: await mobileAuthHeaders() },
  );
  return requireGroup(response.data);
}
