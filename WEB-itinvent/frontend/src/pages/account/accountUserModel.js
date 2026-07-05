export function normalizePermissions(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function normalizeTaskDelegateLinks(value) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  return list
    .map((item) => ({
      delegate_user_id: String(item?.delegate_user_id || '').trim(),
      role_type: String(item?.role_type || 'assistant').trim() === 'deputy' ? 'deputy' : 'assistant',
      is_active: item?.is_active !== false,
      delegate_username: item?.delegate_username || '',
      delegate_full_name: item?.delegate_full_name || '',
      delegate_department: item?.delegate_department || '',
      delegate_job_title: item?.delegate_job_title || '',
      delegate_is_active: item?.delegate_is_active !== false,
    }))
    .filter((item) => {
      if (!item.delegate_user_id || seen.has(item.delegate_user_id)) return false;
      seen.add(item.delegate_user_id);
      return true;
    });
}

export function mergeTaskDelegatesIntoUsers(baseUsers, bulkPayload) {
  const users = Array.isArray(baseUsers) ? baseUsers : [];
  const linksByOwnerId = new Map(
    (Array.isArray(bulkPayload?.items) ? bulkPayload.items : []).map((item) => [
      Number(item?.owner_user_id),
      normalizeTaskDelegateLinks(item?.task_delegate_links),
    ]),
  );
  return users.map((item) => ({
    ...item,
    task_delegate_links: linksByOwnerId.get(Number(item?.id)) || [],
  }));
}

export function createEmptyUserDraft() {
  return {
    id: null,
    username: '',
    password: '',
    full_name: '',
    department: '',
    job_title: '',
    email: '',
    mailbox_email: '',
    mailbox_login: '',
    mailbox_password: '',
    telegram_id: '',
    auth_source: 'local',
    assigned_database: '',
    role: 'viewer',
    is_active: true,
    use_custom_permissions: false,
    custom_permissions: [],
    task_delegate_links: [],
  };
}

export function createUserDraftFromItem(item) {
  if (!item) return createEmptyUserDraft();
  return {
    id: item.id,
    username: item.username || '',
    password: '',
    full_name: item.full_name || '',
    department: item.department || '',
    job_title: item.job_title || '',
    email: item.email || '',
    mailbox_email: item.mailbox_email || '',
    mailbox_login: item.mailbox_login || '',
    mailbox_password: '',
    telegram_id: item.telegram_id ?? '',
    auth_source: item.auth_source || 'local',
    assigned_database: item.assigned_database || '',
    role: item.role || 'viewer',
    is_active: Boolean(item.is_active),
    use_custom_permissions: Boolean(item.use_custom_permissions),
    custom_permissions: normalizePermissions(item.custom_permissions),
    task_delegate_links: normalizeTaskDelegateLinks(item.task_delegate_links),
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    mail_updated_at: item.mail_updated_at || null,
  };
}

export function buildDefaultExchangeLoginPreview(username) {
  let normalized = String(username || '').trim().toLowerCase();
  if (!normalized) return 'username@zsgp.corp';
  if (normalized.includes('\\')) normalized = normalized.split('\\').pop() || normalized;
  if (normalized.includes('/') && !normalized.includes('@')) normalized = normalized.split('/').pop() || normalized;
  if (normalized.includes('@')) return normalized;
  return `${normalized}@zsgp.corp`;
}

export const MAILBOX_AUTH_LABELS = {
  primary_credentials: '\u041e\u0431\u0449\u0438\u0439 \u0447\u0435\u0440\u0435\u0437 AD-\u0443\u0447\u0435\u0442\u043a\u0443',
  primary_session: '\u0422\u0435\u043a\u0443\u0449\u0438\u0439 \u0432\u0445\u043e\u0434 AD',
  stored_credentials: '\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043d\u044b\u0439 \u043b\u043e\u0433\u0438\u043d/\u043f\u0430\u0440\u043e\u043b\u044c',
};

export const MAILBOX_AUTH_SHORT_LABELS = {
  primary_credentials: 'AD-учётка',
  primary_session: 'Текущий вход',
  stored_credentials: 'Личный вход',
};

export function normalizeMailboxAuthMode(value, fallback = 'stored_credentials') {
  const normalized = String(value || '').trim();
  return ['primary_credentials', 'primary_session', 'stored_credentials'].includes(normalized)
    ? normalized
    : fallback;
}

export function getDefaultMailboxAuthMode(user) {
  return String(user?.auth_source || '').trim().toLowerCase() === 'ldap'
    ? 'primary_credentials'
    : 'stored_credentials';
}

export function createEmptyMailboxDraft(user) {
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

export function createMailboxDraftFromEntry(entry, user) {
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

export function formatDateTime(value) {
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

export function summarizePermissions(item) {
  return item?.use_custom_permissions
    ? `${normalizePermissions(item.custom_permissions).length} прав`
    : 'По роли';
}

export function getDbName(dbOptions, databaseId) {
  if (!databaseId) return 'Не ограничивать';
  return dbOptions.find((item) => String(item.id) === String(databaseId))?.name || String(databaseId);
}

export function matchesUserSearch(item, search) {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return [
    item?.username,
    item?.full_name,
    item?.department,
    item?.job_title,
    item?.email,
    item?.mailbox_email,
    item?.telegram_id,
  ].some((value) => String(value || '').toLowerCase().includes(needle));
}
