export type FeedReactionId = 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'angry';

export type FeedAttachment = {
  id?: string | null;
  file_name?: string | null;
  file_mime?: string | null;
  file_size?: number | null;
  sort_order?: number | null;
  is_cover?: boolean;
  [key: string]: unknown;
};

export type FeedPollOption = {
  id?: string | null;
  text?: string | null;
  votes_count?: number | null;
  [key: string]: unknown;
};

export type FeedPoll = {
  question?: string | null;
  multiple?: boolean;
  allows_multiple?: boolean;
  is_anonymous?: boolean;
  closes_at?: string | null;
  is_closed?: boolean;
  options?: FeedPollOption[];
  total_votes?: number | null;
  total_voters?: number | null;
  viewer_option_ids?: string[];
  [key: string]: unknown;
};

export type FeedPost = {
  id: string;
  title?: string | null;
  preview?: string | null;
  body?: string | null;
  priority?: string | null;
  audience_scope?: string | null;
  audience_roles?: string[];
  audience_user_ids?: number[];
  is_pinned?: boolean;
  pinned_until?: string | null;
  published_from?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  status?: string | null;
  can_manage?: boolean;
  is_unread?: boolean;
  is_updated?: boolean;
  is_ack_pending?: boolean;
  requires_ack?: boolean;
  comments_enabled?: boolean;
  reactions_enabled?: boolean;
  comments_count?: number;
  likes_count?: number;
  reaction_counts?: Record<string, number>;
  viewer_reaction?: FeedReactionId | string | null;
  viewer_has_liked?: boolean;
  viewer_bookmarked?: boolean;
  author_user_id?: number | null;
  author_full_name?: string | null;
  author_username?: string | null;
  author_avatar_url?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  category?: { id?: string | null; name?: string | null; slug?: string | null } | null;
  tags?: string[];
  attachments?: FeedAttachment[];
  cover_attachment?: FeedAttachment | null;
  attachments_count?: number;
  poll?: FeedPoll | null;
  [key: string]: unknown;
};

export type FeedComment = {
  id: string;
  body?: string | null;
  full_name?: string | null;
  username?: string | null;
  user_id?: number | null;
  author_full_name?: string | null;
  author_username?: string | null;
  author_user_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  parent_comment_id?: string | null;
  root_comment_id?: string | null;
  reply_to_username?: string | null;
  reaction_counts?: Record<string, number>;
  viewer_reaction?: string | null;
  reply_count?: number;
  replies_count?: number;
  can_edit?: boolean;
  can_delete?: boolean;
  is_deleted?: boolean;
  attachments?: FeedAttachment[];
  [key: string]: unknown;
};

export type FeedListResponse = {
  items: FeedPost[];
  total: number;
  unread_total?: number;
  limit?: number;
  offset?: number;
};

export type FeedCommentsResponse = {
  items: FeedComment[];
  total: number;
  comments_total?: number;
  next_offset?: number | null;
};

export const FEED_PAGE_SIZE = 20;

export const FEED_COMMENT_PAGE_SIZE = 20;

export const FEED_REACTIONS: Array<{ id: FeedReactionId; emoji: string; label: string }> = [
  { id: 'like', emoji: '👍', label: 'Нравится' },
  { id: 'love', emoji: '❤️', label: 'Любовь' },
  { id: 'laugh', emoji: '😂', label: 'Смех' },
  { id: 'wow', emoji: '😮', label: 'Удивление' },
  { id: 'sad', emoji: '😢', label: 'Грусть' },
  { id: 'angry', emoji: '😡', label: 'Возмущение' },
];

export function normalizeFeedComment(raw: unknown): FeedComment | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = String(item.id || '').trim();
  if (!id) return null;
  const fullName = String(item.full_name || item.author_full_name || '').trim();
  const username = String(item.username || item.author_username || '').trim();
  const userId = Number(item.user_id ?? item.author_user_id ?? 0) || null;
  const replyCount = Math.max(0, Number(item.reply_count ?? item.replies_count ?? 0));
  return {
    ...(item as FeedComment),
    id,
    full_name: fullName || null,
    username: username || null,
    user_id: userId,
    author_full_name: fullName || null,
    author_username: username || null,
    author_user_id: userId,
    reply_count: replyCount,
    replies_count: replyCount,
    reaction_counts: item.reaction_counts && typeof item.reaction_counts === 'object'
      ? item.reaction_counts as Record<string, number>
      : {},
    attachments: Array.isArray(item.attachments) ? item.attachments as FeedAttachment[] : [],
  };
}

export const FEED_FILTERS = [
  { id: 'all', label: 'Все' },
  { id: 'unread', label: 'Новое' },
  { id: 'important', label: 'Важное' },
  { id: 'saved', label: 'Сохранённые' },
] as const;

export type FeedFilterId = (typeof FEED_FILTERS)[number]['id'];

export function formatFeedDate(value: unknown): string {
  if (!value) return '';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getFeedInitials(name: unknown): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('ru-RU') || '').join('') || '?';
}

export function stripFeedMarkdown(value: unknown): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFeedPostPath(postId: unknown): string {
  return `/feed?post=${encodeURIComponent(String(postId || ''))}`;
}

export function getFeedReaction(reactionType: unknown) {
  const id = String(reactionType || '').trim().toLowerCase();
  return FEED_REACTIONS.find((reaction) => reaction.id === id) || null;
}

export function getFeedReactionGroups(counts: FeedPost['reaction_counts']) {
  return FEED_REACTIONS
    .map((reaction) => ({
      ...reaction,
      count: Math.max(0, Number(counts?.[reaction.id] || 0)),
    }))
    .filter((reaction) => reaction.count > 0);
}

export function isImageAttachment(attachment: FeedAttachment | null | undefined): boolean {
  const mime = String(attachment?.file_mime || '').trim().toLowerCase();
  if (mime.startsWith('image/')) return true;
  return /\.(avif|gif|jpe?g|png|webp)$/i.test(String(attachment?.file_name || '').trim());
}

export function priorityLabel(priority: unknown): string | null {
  const value = String(priority || '').trim().toLowerCase();
  if (value === 'high') return 'Важное';
  if (value === 'low') return 'Информация';
  return null;
}

export function normalizeFeedPost(raw: unknown): FeedPost | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const id = String(item.id || '').trim();
  if (!id) return null;
  const rawPoll = item.poll && typeof item.poll === 'object'
    ? item.poll as Record<string, unknown>
    : null;
  const poll = rawPoll ? {
    ...rawPoll,
    multiple: Boolean(rawPoll.multiple ?? rawPoll.allows_multiple),
    allows_multiple: Boolean(rawPoll.allows_multiple ?? rawPoll.multiple),
    options: Array.isArray(rawPoll.options) ? rawPoll.options as FeedPollOption[] : [],
    viewer_option_ids: Array.isArray(rawPoll.viewer_option_ids)
      ? rawPoll.viewer_option_ids.map((optionId) => String(optionId))
      : [],
  } as FeedPoll : null;
  const category = item.category && typeof item.category === 'object'
    ? item.category as Record<string, unknown>
    : null;
  const tags = Array.isArray(item.tags) ? item.tags.flatMap((tag) => {
    if (tag && typeof tag === 'object') {
      const row = tag as Record<string, unknown>;
      const name = String(row.name || row.slug || '').trim();
      return name ? [name] : [];
    }
    const name = String(tag || '').trim();
    return name ? [name] : [];
  }) : [];
  return {
    ...(item as FeedPost),
    id,
    comments_count: Math.max(0, Number(item.comments_count || 0)),
    likes_count: Math.max(0, Number(item.likes_count || 0)),
    attachments: Array.isArray(item.attachments) ? item.attachments as FeedAttachment[] : [],
    category_id: String(category?.id || item.category_id || '').trim() || null,
    category_name: String(category?.name || item.category_name || '').trim() || null,
    category: category ? {
      id: String(category.id || '').trim() || null,
      name: String(category.name || '').trim() || null,
      slug: String(category.slug || '').trim() || null,
    } : null,
    tags,
    poll,
  };
}

export function mergeFeedPost(items: FeedPost[], post: FeedPost): FeedPost[] {
  const targetId = String(post?.id || '');
  if (!targetId) return items;
  const exists = items.some((item) => item.id === targetId);
  return exists
    ? items.map((item) => (item.id === targetId ? { ...item, ...post } : item))
    : [post, ...items];
}
