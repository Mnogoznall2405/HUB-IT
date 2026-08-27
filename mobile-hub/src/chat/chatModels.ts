import type {
  ChatAttachment,
  ChatConversationKind,
  ChatMember,
  ChatConversationSummary,
  ChatGlobalMessageSearchHit,
  ChatMessage,
  ChatMessagePage,
  ChatThreadBootstrapPage,
  ChatUserSummary,
} from '../api/types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeChatUser(value: unknown): ChatUserSummary | null {
  const item = record(value);
  const id = finiteNumber(item.id);
  if (id <= 0) return null;
  return {
    id,
    username: String(item.username || ''),
    full_name: optionalText(item.full_name),
    avatar_url: optionalText(item.avatar_url),
    role: optionalText(item.role) || undefined,
    department: optionalText(item.department),
    job_title: optionalText(item.job_title),
    city: optionalText(item.city),
    corporate_email: optionalText(item.corporate_email),
    corporate_phone: optionalText(item.corporate_phone),
    is_active: typeof item.is_active === 'boolean' ? item.is_active : undefined,
    presence: item.presence && typeof item.presence === 'object'
      ? (() => {
        const presence = record(item.presence);
        const isOnline = presence.is_online === true || optionalText(presence.status) === 'online';
        return {
          status: isOnline ? 'online' : (optionalText(presence.status) || 'offline'),
          is_online: isOnline,
          last_seen_at: optionalText(presence.last_seen_at),
        };
      })()
      : null,
  };
}

function normalizeChatMember(value: unknown): ChatMember | null {
  const item = record(value);
  const user = normalizeChatUser(item.user);
  if (!user) return null;
  return {
    user,
    member_role: optionalText(item.member_role) || 'member',
    joined_at: optionalText(item.joined_at),
  };
}

function normalizeConversationKind(value: unknown): ChatConversationKind | undefined {
  const kind = String(value || '');
  if (['direct', 'group', 'ai', 'notes', 'task'].includes(kind)) {
    return kind as ChatConversationKind;
  }
  return undefined;
}

export function normalizeChatConversation(value: unknown): ChatConversationSummary | null {
  const item = record(value);
  const id = String(item.id || '').trim();
  if (!id) return null;
  const kind = normalizeConversationKind(item.kind);
  const directPeer = normalizeChatUser(item.direct_peer);
  const members = Array.isArray(item.members)
    ? item.members.map(normalizeChatMember).filter((member): member is ChatMember => Boolean(member))
    : undefined;
  const memberPreview = Array.isArray(item.member_preview)
    ? item.member_preview.map(normalizeChatMember).filter((member): member is ChatMember => Boolean(member))
    : undefined;
  return {
    id,
    kind,
    title: optionalText(item.title),
    peer_user_id: finiteNumber(item.peer_user_id || directPeer?.id) || null,
    last_message_preview: optionalText(item.last_message_preview),
    last_message_at: optionalText(item.last_message_at),
    last_message_seq: finiteNumber(item.last_message_seq),
    viewer_last_read_seq: finiteNumber(item.viewer_last_read_seq),
    unread_count: Math.max(0, finiteNumber(item.unread_count)),
    avatar_url: optionalText(item.avatar_url || directPeer?.avatar_url),
    is_group: typeof item.is_group === 'boolean' ? item.is_group : kind === 'group',
    is_pinned: Boolean(item.is_pinned),
    is_muted: Boolean(item.is_muted),
    is_archived: Boolean(item.is_archived),
    pinned_message_id: Object.prototype.hasOwnProperty.call(item, 'pinned_message_id')
      ? optionalText(item.pinned_message_id)
      : undefined,
    online_member_count: Math.max(0, finiteNumber(item.online_member_count)),
    member_count: Math.max(0, finiteNumber(item.member_count)),
    viewer_member_role: optionalText(item.viewer_member_role),
    members,
    member_preview: memberPreview,
    direct_peer: directPeer,
  };
}

function normalizeAttachment(value: unknown): ChatAttachment | null {
  const item = record(value);
  const id = String(item.id || '').trim();
  if (!id) return null;
  const variants = record(item.variant_urls);
  return {
    ...item,
    id,
    file_name: optionalText(item.file_name) || undefined,
    mime_type: optionalText(item.mime_type),
    file_size: finiteNumber(item.file_size),
    original_url: optionalText(item.original_url),
    download_url: optionalText(item.download_url),
    variant_urls: Object.fromEntries(
      Object.entries(variants).map(([key, url]) => [key, String(url || '')]).filter(([, url]) => url),
    ),
  } as ChatAttachment;
}

export function normalizeChatReactions(value: unknown): NonNullable<ChatMessage['reactions']> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const emoji = String(item.emoji || '').trim();
    if (!emoji) return [];
    const userIds = Array.isArray(item.user_ids)
      ? item.user_ids.map((id) => finiteNumber(id)).filter((id) => id > 0)
      : undefined;
    return [{
      emoji,
      count: Math.max(0, finiteNumber(item.count)),
      user_ids: userIds,
      reacted_by_me: typeof item.reacted_by_me === 'boolean' ? item.reacted_by_me : undefined,
    }];
  });
}

export function normalizeChatMessage(value: unknown): ChatMessage | null {
  const item = record(value);
  const id = String(item.id || '').trim();
  const conversationId = String(item.conversation_id || '').trim();
  if (!id || !conversationId) return null;
  const sender = normalizeChatUser(item.sender);
  const body = optionalText(item.body_text ?? item.body) || '';
  const attachments = Array.isArray(item.attachments)
    ? item.attachments.map(normalizeAttachment).filter((entry): entry is ChatAttachment => Boolean(entry))
    : [];
  return {
    ...item,
    id,
    conversation_id: conversationId,
    sender_user_id: finiteNumber(item.sender_user_id || sender?.id),
    conversation_seq: finiteNumber(item.conversation_seq),
    client_message_id: optionalText(item.client_message_id),
    body_text: body,
    body,
    body_format: item.body_format === 'markdown'
      ? 'markdown'
      : item.body_format === 'plain'
        ? 'plain'
        : undefined,
    sender,
    created_at: optionalText(item.created_at),
    edited_at: optionalText(item.edited_at),
    is_own: typeof item.is_own === 'boolean' ? item.is_own : undefined,
    is_deleted: Boolean(item.is_deleted),
    deleted_at: optionalText(item.deleted_at),
    deleted_by_user_id: finiteNumber(item.deleted_by_user_id) || null,
    deleted_reason: optionalText(item.deleted_reason),
    attachments,
    reactions: normalizeChatReactions(item.reactions),
    delivery_status: item.delivery_status === 'read' ? 'read' : item.delivery_status === 'sent' ? 'sent' : null,
    read_by_count: Math.max(0, finiteNumber(item.read_by_count)),
  } as ChatMessage;
}

export function normalizeChatMessagePage(value: unknown): ChatMessagePage {
  const payload = Array.isArray(value) ? { items: value } : record(value);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  return {
    items: rawItems
      .map(normalizeChatMessage)
      .filter((item): item is ChatMessage => Boolean(item)),
    has_more: Boolean(payload.has_more),
    has_older: Boolean(payload.has_older),
    has_newer: Boolean(payload.has_newer),
    cursor_invalid: Boolean(payload.cursor_invalid),
    older_cursor_message_id: optionalText(payload.older_cursor_message_id),
    newer_cursor_message_id: optionalText(payload.newer_cursor_message_id),
    viewer_last_read_message_id: optionalText(payload.viewer_last_read_message_id),
    viewer_last_read_at: optionalText(payload.viewer_last_read_at),
  };
}

export function normalizeChatThreadBootstrap(value: unknown): ChatThreadBootstrapPage {
  const payload = record(value);
  const page = normalizeChatMessagePage(payload);
  const anchorMode = String(payload.initial_anchor_mode || 'bottom');
  return {
    ...page,
    initial_anchor_mode: ['bottom', 'message', 'first_unread'].includes(anchorMode)
      ? anchorMode as ChatThreadBootstrapPage['initial_anchor_mode']
      : 'bottom',
    initial_anchor_message_id: optionalText(payload.initial_anchor_message_id),
    pinned_message_id: Object.prototype.hasOwnProperty.call(payload, 'pinned_message_id')
      ? optionalText(payload.pinned_message_id)
      : undefined,
  };
}

export function normalizeGlobalMessageSearchHit(value: unknown): ChatGlobalMessageSearchHit | null {
  const item = record(value);
  const conversationId = String(item.conversation_id || '').trim();
  const messageId = String(item.message_id || '').trim();
  if (!conversationId || !messageId) return null;
  return {
    conversation_id: conversationId,
    conversation_title: optionalText(item.conversation_title) || 'Диалог',
    conversation_kind: optionalText(item.conversation_kind) || undefined,
    message_id: messageId,
    created_at: optionalText(item.created_at),
    sender_name: optionalText(item.sender_name) || undefined,
    preview: optionalText(item.preview) || undefined,
  };
}
