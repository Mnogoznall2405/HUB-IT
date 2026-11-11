export type ChatGroupActivityItem = {
  id: string;
  action: string;
  actor_name?: string;
  target_name?: string;
  details?: { role?: string; fields?: string[] } | null;
  created_at?: string | null;
};

const ACTION_TEXT: Record<string, string> = {
  members_added: 'добавил(а) участников',
  member_removed: 'исключил(а)',
  role_changed: 'изменил(а) роль',
  ownership_transferred: 'передал(а) права владельца',
  owner_left: 'вышел(а), передав владение',
  profile_updated: 'изменил(а) профиль группы',
  invite_created: 'создал(а) ссылку-приглашение',
  invite_revoked: 'отозвал(а) ссылку-приглашение',
  assign_owner: 'назначен владелец администратором',
  auto_assign_owner: 'владелец назначен автоматически',
  remove_member: 'участник исключён администратором',
};

const PROFILE_FIELD_TEXT: Record<string, string> = {
  title: 'название',
  description: 'описание',
  posting_policy: 'правила отправки',
};

export function describeGroupActivity(item: ChatGroupActivityItem): string {
  const base = ACTION_TEXT[item.action] || item.action;
  const target = item.target_name ? `: ${item.target_name}` : '';
  if (item.action === 'role_changed') {
    return `${base}${target} (${item.details?.role === 'moderator' ? 'модератор' : 'участник'})`;
  }
  if (item.action === 'profile_updated') {
    const fields = (item.details?.fields || []).map((field) => PROFILE_FIELD_TEXT[field] || field);
    return fields.length ? `${base}: ${fields.join(', ')}` : base;
  }
  return `${base}${target}`;
}

export function buildInviteLink(origin: string, token: string): string {
  return `${String(origin || '').replace(/\/+$/, '')}/chat?join=${encodeURIComponent(token)}`;
}
