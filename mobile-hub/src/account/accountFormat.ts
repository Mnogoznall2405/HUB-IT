import { HUB_WEB_ORIGIN } from '../api/config';
import type { HubUser } from '../api/types';

export const DEFAULT_NOTIFICATION_CHANNELS = {
  mail: true,
  tasks: true,
  task_email: true,
  announcements: true,
  chat: true,
  chat_direct: true,
  chat_group: true,
  chat_task: true,
} as const;

export type NotificationChannels = {
  mail: boolean;
  tasks: boolean;
  task_email: boolean;
  announcements: boolean;
  chat: boolean;
  chat_direct: boolean;
  chat_group: boolean;
  chat_task: boolean;
};

export type MailboxAuthMode = 'stored_credentials' | 'primary_credentials' | 'primary_session';

export type MailboxDraft = {
  id: string;
  label: string;
  mailbox_email: string;
  mailbox_login: string;
  mailbox_password: string;
  auth_mode: MailboxAuthMode;
  is_primary: boolean;
  is_active: boolean;
};

export type DatabaseOption = {
  id: string;
  name: string;
};

export function normalizePermissions(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function summarizePermissions(item: {
  use_custom_permissions?: boolean;
  custom_permissions?: unknown;
} | null | undefined): string {
  return item?.use_custom_permissions
    ? `${normalizePermissions(item.custom_permissions).length} прав`
    : 'По роли';
}

export function getDbName(dbOptions: DatabaseOption[], databaseId: unknown): string {
  if (!databaseId) return 'Не ограничивать';
  return dbOptions.find((item) => String(item.id) === String(databaseId))?.name || String(databaseId);
}

export function matchesUserSearch(item: Record<string, unknown> | null | undefined, search: string): boolean {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return [
    item?.username,
    item?.full_name,
    item?.department,
    item?.job_title,
    item?.email,
    item?.telegram_id,
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}

export function formatDateTime(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '—';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function authSourceLabel(value: unknown): string {
  return String(value || '').trim().toLowerCase() === 'ldap' ? 'AD / LDAP' : 'Локальный вход';
}

export function roleLabel(value: unknown): string {
  if (value === 'admin') return 'Админ';
  if (value === 'operator') return 'Оператор';
  if (value === 'viewer') return 'Просмотр';
  return String(value || '—');
}

export function twoFaPolicyLabel(value: unknown): string {
  if (value === 'external_only') return 'Только для внешней сети';
  if (value === 'all') return 'Для всех входов';
  return 'Отключена';
}

export function buildDefaultExchangeLoginPreview(username: unknown): string {
  let normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return 'username@zsgp.corp';
  if (normalized.includes('\\')) normalized = normalized.split('\\').pop() || normalized;
  if (normalized.includes('/') && !normalized.includes('@')) normalized = normalized.split('/').pop() || normalized;
  if (normalized.includes('@')) return normalized;
  return `${normalized}@zsgp.corp`;
}

export const MAILBOX_AUTH_LABELS: Record<MailboxAuthMode, string> = {
  primary_credentials: 'Общий через AD-учётку',
  primary_session: 'Текущий вход AD',
  stored_credentials: 'Сохранённый логин/пароль',
};

export function normalizeMailboxAuthMode(value: unknown, fallback: MailboxAuthMode = 'stored_credentials'): MailboxAuthMode {
  const normalized = String(value || '').trim();
  return ['primary_credentials', 'primary_session', 'stored_credentials'].includes(normalized)
    ? normalized as MailboxAuthMode
    : fallback;
}

export function getDefaultMailboxAuthMode(user: { auth_source?: string | null } | null | undefined): MailboxAuthMode {
  return String(user?.auth_source || '').trim().toLowerCase() === 'ldap'
    ? 'primary_credentials'
    : 'stored_credentials';
}

export function createEmptyMailboxDraft(user: { username?: string | null; auth_source?: string | null } | null | undefined): MailboxDraft {
  const authMode = getDefaultMailboxAuthMode(user);
  return {
    id: '',
    label: '',
    mailbox_email: '',
    mailbox_login: authMode === 'stored_credentials' ? buildDefaultExchangeLoginPreview(user?.username) : '',
    mailbox_password: '',
    auth_mode: authMode,
    is_primary: false,
    is_active: true,
  };
}

export function createMailboxDraftFromEntry(
  entry: Record<string, unknown> | null | undefined,
  user: { username?: string | null; auth_source?: string | null } | null | undefined,
): MailboxDraft {
  if (!entry) return createEmptyMailboxDraft(user);
  return {
    id: String(entry.id || ''),
    label: String(entry.label || ''),
    mailbox_email: String(entry.mailbox_email || ''),
    mailbox_login: String(entry.mailbox_login || entry.effective_mailbox_login || buildDefaultExchangeLoginPreview(user?.username)),
    mailbox_password: '',
    auth_mode: normalizeMailboxAuthMode(entry.auth_mode, getDefaultMailboxAuthMode(user)),
    is_primary: Boolean(entry.is_primary),
    is_active: entry.is_active !== false,
  };
}

export function normalizeNotificationChannels(value: unknown = {}): NotificationChannels {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const legacyChatEnabled = Boolean(source.chat ?? DEFAULT_NOTIFICATION_CHANNELS.chat);
  return {
    mail: Boolean(source.mail ?? DEFAULT_NOTIFICATION_CHANNELS.mail),
    tasks: Boolean(source.tasks ?? DEFAULT_NOTIFICATION_CHANNELS.tasks),
    task_email: Boolean(source.task_email ?? DEFAULT_NOTIFICATION_CHANNELS.task_email),
    announcements: Boolean(source.announcements ?? DEFAULT_NOTIFICATION_CHANNELS.announcements),
    chat: legacyChatEnabled,
    chat_direct: Boolean(source.chat_direct ?? legacyChatEnabled),
    chat_group: Boolean(source.chat_group ?? legacyChatEnabled),
    chat_task: Boolean(source.chat_task ?? legacyChatEnabled),
  };
}

export function resolveAvatarUrl(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${HUB_WEB_ORIGIN}${raw}`;
  return raw;
}

export function permissionSummaryForUser(user: HubUser | null | undefined): string {
  if (!user) return '—';
  if (user.use_custom_permissions) {
    return `${normalizePermissions(user.custom_permissions || user.permissions).length} своих прав`;
  }
  const count = Array.isArray(user.permissions) ? user.permissions.length : 0;
  return `По роли «${roleLabel(user.role)}» · ${count} прав`;
}
