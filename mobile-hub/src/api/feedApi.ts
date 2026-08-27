import apiClient from './client';
import { API_V1_BASE } from './config';
import {
  FEED_PAGE_SIZE,
  FEED_COMMENT_PAGE_SIZE,
  normalizeFeedComment,
  normalizeFeedPost,
  type FeedAttachment,
  type FeedComment,
  type FeedCommentsResponse,
  type FeedListResponse,
  type FeedPost,
  type FeedReactionId,
} from '../feed/feedFormat';

export type FeedListParams = {
  q?: string;
  unread_only?: boolean;
  priority?: string;
  bookmarked_only?: boolean;
  category_id?: string;
  tag?: string;
  limit?: number;
  offset?: number;
};

export type FeedEditorPayload = {
  client_request_id?: string;
  title: string;
  preview: string;
  body: string;
  priority: 'low' | 'normal' | 'high';
  audience_scope: 'all' | 'roles' | 'users';
  audience_roles?: string[];
  audience_user_ids?: number[];
  requires_ack: boolean;
  is_pinned: boolean;
  pinned_until?: string | null;
  published_from?: string | null;
  expires_at?: string | null;
  comments_enabled: boolean;
  reactions_enabled: boolean;
  category_id?: string | null;
  tags: string[];
  status?: 'draft' | 'published';
  is_active?: boolean;
  notify_on_update?: boolean;
  poll?: {
    question: string;
    options: string[];
    allows_multiple: boolean;
    is_anonymous: boolean;
    closes_at: string | null;
  } | null;
};

export type FeedManagedStatus = 'draft' | 'scheduled' | 'published' | 'archived';

export type FeedCategory = {
  id: string;
  name: string;
  slug?: string | null;
  is_active?: boolean;
};

export type FeedTag = {
  id: string;
  name: string;
  slug?: string | null;
  usage_count?: number;
};

export type FeedRecipientUser = {
  id: number;
  username?: string | null;
  full_name?: string | null;
  role?: string | null;
  department?: string | null;
};

export type FeedRecipientRole = { value: string; label: string };

export type FeedRecipientsResponse = {
  users: FeedRecipientUser[];
  roles: FeedRecipientRole[];
  total?: number;
  limit?: number | null;
};

export type FeedUploadFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  uploadId?: string;
};

export type FeedReactionUser = {
  user_id: number;
  username?: string | null;
  full_name?: string | null;
  reaction_type: string;
  updated_at?: string | null;
};

export type FeedAnalyticsItem = {
  user_id: number;
  username?: string | null;
  full_name?: string | null;
  is_seen?: boolean;
  is_acknowledged?: boolean;
  read_at?: string | null;
  acknowledged_at?: string | null;
};

export type FeedAnalyticsResponse = {
  items: FeedAnalyticsItem[];
  items_total?: number;
  next_offset?: number | null;
  summary: {
    recipients_total?: number;
    seen_total?: number;
    ack_total?: number;
    pending_ack_total?: number;
    comments_total?: number;
    poll_total_voters?: number;
    poll_total_votes?: number;
    reaction_counts?: Record<string, number>;
  };
};

export type FeedReactionUsersResponse = {
  items: FeedReactionUser[];
  total: number;
  next_offset?: number | null;
};

export type FeedCommentCreateInput = {
  clientRequestId?: string;
  body?: string;
  parentCommentId?: string;
  mentionedUserIds?: number[];
  files?: FeedUploadFile[];
};

function normalizeList(data: unknown): FeedListResponse {
  const payload = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
  const items = Array.isArray(payload.items)
    ? payload.items.map(normalizeFeedPost).filter((item): item is FeedPost => Boolean(item))
    : [];
  return {
    items,
    total: Number(payload.total || items.length),
    unread_total: Number(payload.unread_total || 0),
    limit: payload.limit == null ? undefined : Number(payload.limit),
    offset: payload.offset == null ? undefined : Number(payload.offset),
  };
}

export async function listFeedPosts(params: FeedListParams = {}): Promise<FeedListResponse> {
  const { data } = await apiClient.get('/hub/announcements', {
    params: {
      q: params.q || undefined,
      unread_only: params.unread_only || undefined,
      priority: params.priority || undefined,
      bookmarked_only: params.bookmarked_only || undefined,
      category_id: params.category_id || undefined,
      tag: params.tag || undefined,
      include_body: true,
      limit: params.limit ?? FEED_PAGE_SIZE,
      offset: params.offset ?? 0,
      sort_by: 'published_at',
      sort_dir: 'desc',
    },
  });
  return normalizeList(data);
}

export async function getFeedPost(postId: string): Promise<FeedPost> {
  const { data } = await apiClient.get(`/hub/announcements/${encodeURIComponent(postId)}`);
  const post = normalizeFeedPost(data);
  if (!post) throw new Error('Публикация не найдена');
  return post;
}

function feedEditorFormData(payload: FeedEditorPayload, files: FeedUploadFile[]): FormData {
  const formData = new FormData();
  formData.append('title', payload.title);
  if (payload.client_request_id) formData.append('client_request_id', payload.client_request_id);
  formData.append('preview', payload.preview);
  formData.append('body', payload.body);
  formData.append('priority', payload.priority);
  formData.append('audience_scope', payload.audience_scope);
  formData.append('audience_roles', JSON.stringify(payload.audience_roles || []));
  formData.append('audience_user_ids', JSON.stringify(payload.audience_user_ids || []));
  formData.append('requires_ack', payload.requires_ack ? '1' : '0');
  formData.append('is_pinned', payload.is_pinned ? '1' : '0');
  formData.append('pinned_until', payload.pinned_until || '');
  formData.append('published_from', payload.published_from || '');
  formData.append('expires_at', payload.expires_at || '');
  formData.append('is_active', payload.is_active === false ? '0' : '1');
  formData.append('status', payload.status || 'published');
  formData.append('comments_enabled', payload.comments_enabled ? '1' : '0');
  formData.append('reactions_enabled', payload.reactions_enabled ? '1' : '0');
  formData.append('category_id', payload.category_id || '');
  formData.append('tags', JSON.stringify(payload.tags || []));
  formData.append('poll', payload.poll ? JSON.stringify(payload.poll) : '');
  files.forEach((file) => {
    formData.append('files', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType || 'application/octet-stream',
    } as unknown as Blob);
  });
  return formData;
}

export async function createFeedPost(payload: FeedEditorPayload, files: FeedUploadFile[] = []): Promise<FeedPost> {
  const { data } = files.length > 0
    ? await apiClient.post('/hub/announcements', feedEditorFormData(payload, files), {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    : await apiClient.post('/hub/announcements', payload);
  const post = normalizeFeedPost(data);
  if (!post) throw new Error('Сервер не вернул созданную публикацию');
  return post;
}

export async function getFeedRecipients(options: {
  q?: string;
  limit?: number;
  userIds?: number[];
} = {}): Promise<FeedRecipientsResponse> {
  const { data } = await apiClient.get('/hub/users/announcement-recipients', {
    params: {
      q: String(options.q || '').trim() || undefined,
      limit: options.limit,
      user_ids: options.userIds?.length ? JSON.stringify(options.userIds) : undefined,
    },
  });
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const users = Array.isArray(payload.users) ? payload.users.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = Number(row.id || 0);
    if (!Number.isInteger(id) || id <= 0) return [];
    return [{ ...(row as FeedRecipientUser), id }];
  }) : [];
  const roles = Array.isArray(payload.roles) ? payload.roles.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const value = String(row.value || '').trim();
    if (!value) return [];
    return [{ value, label: String(row.label || value).trim() || value }];
  }) : [];
  return {
    users,
    roles,
    total: payload.total == null ? undefined : Number(payload.total),
    limit: payload.limit == null ? undefined : Number(payload.limit),
  };
}

export async function uploadFeedAttachment(postId: string, file: FeedUploadFile): Promise<FeedAttachment> {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType || 'application/octet-stream',
  } as unknown as Blob);
  if (file.uploadId) formData.append('client_upload_id', file.uploadId);
  const { data } = await apiClient.post(
    `/hub/announcements/${encodeURIComponent(postId)}/attachments`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  const attachment = data && typeof data === 'object' ? data as FeedAttachment : null;
  if (!attachment?.id) throw new Error('Сервер не вернул загруженное вложение');
  return attachment;
}

export async function reorderFeedAttachments(
  postId: string,
  attachmentIds: string[],
  coverAttachmentId: string,
): Promise<FeedAttachment[]> {
  const { data } = await apiClient.patch(`/hub/announcements/${encodeURIComponent(postId)}/attachments/order`, {
    attachment_ids: attachmentIds,
    cover_attachment_id: coverAttachmentId,
  });
  return Array.isArray(data) ? data as FeedAttachment[] : [];
}

export async function deleteFeedAttachment(postId: string, attachmentId: string): Promise<void> {
  await apiClient.delete(
    `/hub/announcements/${encodeURIComponent(postId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
}

export async function createFeedDraft(payload: FeedEditorPayload): Promise<FeedPost> {
  const { data } = await apiClient.post('/hub/announcements/drafts', { ...payload, status: 'draft' });
  const post = normalizeFeedPost(data);
  if (!post) throw new Error('Сервер не вернул черновик публикации');
  return post;
}

export async function updateFeedPost(postId: string, payload: FeedEditorPayload): Promise<FeedPost> {
  const { data } = await apiClient.patch(`/hub/announcements/${encodeURIComponent(postId)}`, payload);
  const post = normalizeFeedPost(data);
  if (!post) throw new Error('Сервер не вернул обновлённую публикацию');
  return post;
}

export async function publishFeedPost(postId: string): Promise<FeedPost> {
  const { data } = await apiClient.post(`/hub/announcements/${encodeURIComponent(postId)}/publish`);
  const post = normalizeFeedPost(data);
  if (!post) throw new Error('Сервер не подтвердил публикацию');
  return post;
}

export async function archiveFeedPost(postId: string): Promise<FeedPost> {
  const { data } = await apiClient.post(`/hub/announcements/${encodeURIComponent(postId)}/archive`);
  const post = normalizeFeedPost(data);
  if (!post) throw new Error('Сервер не подтвердил архивирование');
  return post;
}

export async function deleteFeedPost(postId: string): Promise<void> {
  await apiClient.delete(`/hub/announcements/${encodeURIComponent(postId)}`);
}

export async function listManagedFeedPosts(
  status: FeedManagedStatus,
  limit = 100,
): Promise<FeedListResponse> {
  const { data } = await apiClient.get('/hub/announcements/manage', { params: { status, limit } });
  return normalizeList(data);
}

function normalizeCategories(data: unknown): FeedCategory[] {
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return Array.isArray(payload.items) ? payload.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id || '').trim();
    const name = String(row.name || '').trim();
    return id && name ? [{ ...(row as FeedCategory), id, name, is_active: row.is_active !== false }] : [];
  }) : [];
}

export async function listFeedCategories(includeInactive = false): Promise<FeedCategory[]> {
  const { data } = await apiClient.get('/hub/announcement-categories', {
    params: { include_inactive: includeInactive || undefined },
  });
  return normalizeCategories(data);
}

export async function createFeedCategory(name: string): Promise<FeedCategory> {
  const { data } = await apiClient.post('/hub/announcement-categories', { name, is_active: true });
  return data as FeedCategory;
}

export async function updateFeedCategory(
  categoryId: string,
  payload: Pick<FeedCategory, 'name' | 'is_active'>,
): Promise<FeedCategory> {
  const { data } = await apiClient.patch(
    `/hub/announcement-categories/${encodeURIComponent(categoryId)}`,
    payload,
  );
  return data as FeedCategory;
}

export async function deleteFeedCategory(categoryId: string): Promise<void> {
  await apiClient.delete(`/hub/announcement-categories/${encodeURIComponent(categoryId)}`);
}

export async function listFeedTags(): Promise<FeedTag[]> {
  const { data } = await apiClient.get('/hub/announcement-tags');
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return Array.isArray(payload.items) ? payload.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = String(row.id || '').trim();
    const name = String(row.name || '').trim();
    return id && name ? [{ ...(row as FeedTag), id, name }] : [];
  }) : [];
}

export async function transformFeedMarkdown(text: string): Promise<string> {
  const { data } = await apiClient.post('/hub/markdown/transform', { text, context: 'announcement' });
  const markdown = data && typeof data === 'object'
    ? String((data as Record<string, unknown>).markdown || '').trim()
    : String(data || '').trim();
  if (!markdown) throw new Error('Сервер не вернул преобразованный Markdown');
  return markdown;
}

export async function markFeedPostRead(postId: string): Promise<FeedPost | null> {
  const { data } = await apiClient.post(`/hub/announcements/${encodeURIComponent(postId)}/mark-as-read`);
  return normalizeFeedPost(data);
}

export async function acknowledgeFeedPost(postId: string): Promise<FeedPost | null> {
  const { data } = await apiClient.post(`/hub/announcements/${encodeURIComponent(postId)}/ack`);
  return normalizeFeedPost(data);
}

export async function setFeedReaction(postId: string, reactionType: FeedReactionId): Promise<unknown> {
  const { data } = await apiClient.put(`/hub/announcements/${encodeURIComponent(postId)}/reaction`, {
    reaction_type: reactionType,
  });
  return data;
}

export async function removeFeedReaction(postId: string): Promise<unknown> {
  const { data } = await apiClient.delete(`/hub/announcements/${encodeURIComponent(postId)}/reaction`);
  return data;
}

export async function setFeedBookmark(postId: string, bookmarked: boolean): Promise<unknown> {
  const { data } = await apiClient[bookmarked ? 'put' : 'delete'](
    `/hub/announcements/${encodeURIComponent(postId)}/bookmark`,
  );
  return data;
}

export async function voteFeedPoll(postId: string, optionIds: string[]): Promise<FeedPost | null> {
  const { data } = await apiClient.put(`/hub/announcements/${encodeURIComponent(postId)}/poll/vote`, {
    option_ids: optionIds,
  });
  return normalizeFeedPost(data);
}

export async function listFeedComments(
  postId: string,
  options: { limit?: number; offset?: number; sort?: string; rootCommentId?: string } = {},
): Promise<FeedCommentsResponse> {
  const { data } = await apiClient.get(`/hub/announcements/${encodeURIComponent(postId)}/comments`, {
    params: {
      limit: options.limit ?? FEED_COMMENT_PAGE_SIZE,
      offset: options.offset ?? 0,
      sort: options.sort || 'interesting',
      root_comment_id: options.rootCommentId || undefined,
    },
  });
  const payload = (data && typeof data === 'object') ? data as Record<string, unknown> : {};
  const items = Array.isArray(payload.items)
    ? payload.items.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const comment = normalizeFeedComment(item);
      return comment ? [comment] : [];
    })
    : [];
  return {
    items,
    total: Number(payload.total ?? items.length),
    comments_total: payload.comments_total == null ? undefined : Number(payload.comments_total),
    next_offset: payload.next_offset == null ? null : Number(payload.next_offset),
  };
}

export async function listFeedReactionUsers(
  postId: string,
  reactionType = '',
  options: { limit?: number; offset?: number } = {},
): Promise<FeedReactionUsersResponse> {
  const { data } = await apiClient.get(`/hub/announcements/${encodeURIComponent(postId)}/reactions`, {
    params: {
      reaction_type: reactionType || undefined,
      limit: options.limit,
      offset: options.offset,
    },
  });
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const items = Array.isArray(payload.items) ? payload.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const userId = Number(row.user_id || 0);
    const normalizedReaction = String(row.reaction_type || '').trim();
    if (!Number.isInteger(userId) || userId <= 0 || !normalizedReaction) return [];
    return [{ ...(row as FeedReactionUser), user_id: userId, reaction_type: normalizedReaction }];
  }) : [];
  return {
    items,
    total: Number(payload.total ?? items.length),
    next_offset: payload.next_offset == null ? null : Number(payload.next_offset),
  };
}

export async function getFeedAnalytics(
  postId: string,
  options: { limit?: number; offset?: number } = {},
): Promise<FeedAnalyticsResponse> {
  const { data } = await apiClient.get(`/hub/announcements/${encodeURIComponent(postId)}/analytics`, {
    params: { limit: options.limit, offset: options.offset },
  });
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const rawSummary = payload.summary && typeof payload.summary === 'object'
    ? payload.summary as FeedAnalyticsResponse['summary']
    : {};
  const items = Array.isArray(payload.items) ? payload.items.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const userId = Number(row.user_id || 0);
    return Number.isInteger(userId) && userId > 0
      ? [{ ...(row as FeedAnalyticsItem), user_id: userId }]
      : [];
  }) : [];
  return {
    items,
    summary: rawSummary,
    items_total: payload.items_total == null ? items.length : Number(payload.items_total),
    next_offset: payload.next_offset == null ? null : Number(payload.next_offset),
  };
}

export async function createFeedComment(
  postId: string,
  input: string | FeedCommentCreateInput,
): Promise<FeedComment> {
  const options = typeof input === 'string' ? { body: input } : input;
  const body = String(options.body || '');
  const parentCommentId = String(options.parentCommentId || '');
  const mentionedUserIds = Array.isArray(options.mentionedUserIds) ? options.mentionedUserIds : [];
  const files = Array.isArray(options.files) ? options.files : [];
  let payload: FormData | Record<string, unknown> = {
    body,
    parent_comment_id: parentCommentId,
    mentioned_user_ids: mentionedUserIds,
  };
  if (options.clientRequestId) payload.client_request_id = options.clientRequestId;
  let config: { headers: Record<string, string> } | undefined;
  if (files.length > 0) {
    const formData = new FormData();
    formData.append('body', body);
    formData.append('parent_comment_id', parentCommentId);
    formData.append('mentioned_user_ids', JSON.stringify(mentionedUserIds));
    if (options.clientRequestId) formData.append('client_request_id', options.clientRequestId);
    files.forEach((file) => {
      formData.append('files', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType || 'application/octet-stream',
      } as unknown as Blob);
    });
    payload = formData;
    config = { headers: { 'Content-Type': 'multipart/form-data' } };
  }
  const { data } = await apiClient.post(
    `/hub/announcements/${encodeURIComponent(postId)}/comments`,
    payload,
    config,
  );
  const comment = normalizeFeedComment(data);
  if (!comment) throw new Error('Не удалось отправить комментарий');
  return comment;
}

export async function updateFeedComment(
  postId: string,
  commentId: string,
  body: string,
): Promise<FeedComment> {
  const { data } = await apiClient.patch(
    `/hub/announcements/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
    { body },
  );
  const comment = normalizeFeedComment(data);
  if (!comment) throw new Error('Не удалось сохранить комментарий');
  return comment;
}

export async function deleteFeedComment(postId: string, commentId: string): Promise<void> {
  await apiClient.delete(
    `/hub/announcements/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`,
  );
}

export async function setFeedCommentReaction(
  postId: string,
  commentId: string,
  reactionType: FeedReactionId | null,
): Promise<Pick<FeedComment, 'reaction_counts' | 'viewer_reaction'>> {
  const path = `/hub/announcements/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/reaction`;
  const { data } = reactionType
    ? await apiClient.put(path, { reaction_type: reactionType })
    : await apiClient.delete(path);
  const payload = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  return {
    reaction_counts: payload.reaction_counts && typeof payload.reaction_counts === 'object'
      ? payload.reaction_counts as Record<string, number>
      : {},
    viewer_reaction: String(payload.viewer_reaction || '').trim() || null,
  };
}

export function buildFeedAttachmentUrl(postId: string, attachmentId: string): string {
  return `${API_V1_BASE}/hub/announcements/${encodeURIComponent(postId)}/attachments/${encodeURIComponent(attachmentId)}/file`;
}

export function buildFeedCommentAttachmentUrl(
  postId: string,
  commentId: string,
  attachmentId: string,
): string {
  return `${API_V1_BASE}/hub/announcements/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}/attachments/${encodeURIComponent(attachmentId)}/file`;
}
