import apiClient from './client';
import {
  buildFeedAttachmentUrl,
  buildFeedCommentAttachmentUrl,
  archiveFeedPost,
  createFeedComment,
  createFeedDraft,
  createFeedPost,
  createFeedCategory,
  deleteFeedCategory,
  deleteFeedPost,
  deleteFeedAttachment,
  getFeedPost,
  getFeedAnalytics,
  getFeedRecipients,
  listFeedCategories,
  listFeedTags,
  listManagedFeedPosts,
  listFeedReactionUsers,
  listFeedComments,
  listFeedPosts,
  markFeedPostRead,
  reorderFeedAttachments,
  setFeedReaction,
  setFeedCommentReaction,
  uploadFeedAttachment,
  updateFeedComment,
  deleteFeedComment,
  updateFeedPost,
  updateFeedCategory,
  transformFeedMarkdown,
} from './feedApi';

jest.mock('./client', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('./config', () => ({
  API_V1_BASE: 'https://hubit.zsgp.ru/api/v1',
}));

const mockedClient = apiClient as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};

describe('feedApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists announcements with feed filters', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{ id: 'p1', title: 'Hello', comments_count: 2 }],
        total: 1,
        unread_total: 4,
      },
    });

    await expect(listFeedPosts({ q: 'hello', unread_only: true, limit: 20, offset: 0 })).resolves.toEqual({
      items: [expect.objectContaining({ id: 'p1', title: 'Hello', comments_count: 2 })],
      total: 1,
      unread_total: 4,
      limit: undefined,
      offset: undefined,
    });
    expect(mockedClient.get).toHaveBeenCalledWith('/hub/announcements', {
      params: expect.objectContaining({
        q: 'hello',
        unread_only: true,
        include_body: true,
        limit: 20,
        offset: 0,
      }),
    });
  });

  it('loads a post, marks it read and sets a reaction', async () => {
    mockedClient.get.mockResolvedValue({ data: { id: 'p1', title: 'Post' } });
    mockedClient.post.mockResolvedValue({ data: { id: 'p1', is_unread: false } });
    mockedClient.put.mockResolvedValue({ data: { ok: true } });

    await expect(getFeedPost('p1')).resolves.toEqual(expect.objectContaining({ id: 'p1' }));
    await expect(markFeedPostRead('p1')).resolves.toEqual(expect.objectContaining({ id: 'p1', is_unread: false }));
    await setFeedReaction('p1', 'like');
    expect(mockedClient.put).toHaveBeenCalledWith('/hub/announcements/p1/reaction', { reaction_type: 'like' });
    expect(buildFeedAttachmentUrl('p1', 'a1')).toBe(
      'https://hubit.zsgp.ru/api/v1/hub/announcements/p1/attachments/a1/file',
    );
  });

  it('uses the announcement editor lifecycle endpoints', async () => {
    const payload = {
      title: 'Native post',
      preview: 'Preview',
      body: 'Body',
      priority: 'normal' as const,
      audience_scope: 'all' as const,
      requires_ack: false,
      is_pinned: false,
      comments_enabled: true,
      reactions_enabled: true,
      tags: ['native'],
    };
    mockedClient.post
      .mockResolvedValueOnce({ data: { id: 'p1', title: payload.title } })
      .mockResolvedValueOnce({ data: { id: 'p2', title: payload.title, status: 'draft' } })
      .mockResolvedValueOnce({ data: { id: 'p1', status: 'archived' } });
    mockedClient.patch.mockResolvedValue({ data: { id: 'p1', title: 'Updated' } });

    await createFeedPost(payload);
    await createFeedDraft(payload);
    await updateFeedPost('p/1', { ...payload, title: 'Updated' });
    await archiveFeedPost('p/1');

    expect(mockedClient.post).toHaveBeenNthCalledWith(1, '/hub/announcements', payload);
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/hub/announcements/drafts', { ...payload, status: 'draft' });
    expect(mockedClient.patch).toHaveBeenCalledWith('/hub/announcements/p%2F1', { ...payload, title: 'Updated' });
    expect(mockedClient.post).toHaveBeenNthCalledWith(3, '/hub/announcements/p%2F1/archive');
  });

  it('loads announcement recipients and normalizes invalid directory rows', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        users: [
          { id: 8, username: 'maria', full_name: 'Мария' },
          { id: '9', username: 'ivan' },
          { id: 0, username: 'invalid' },
        ],
        roles: [{ value: 'manager', label: 'Менеджер' }, { value: '', label: 'Invalid' }],
      },
    });

    await expect(getFeedRecipients({ q: 'maria', limit: 20, userIds: [8] })).resolves.toEqual({
      users: [
        expect.objectContaining({ id: 8, username: 'maria' }),
        expect.objectContaining({ id: 9, username: 'ivan' }),
      ],
      roles: [{ value: 'manager', label: 'Менеджер' }],
      total: undefined,
      limit: undefined,
    });
    expect(mockedClient.get).toHaveBeenCalledWith('/hub/users/announcement-recipients', {
      params: { q: 'maria', limit: 20, user_ids: '[8]' },
    });
  });

  it('uses managed feed, taxonomy, markdown and permanent-delete contracts', async () => {
    mockedClient.get
      .mockResolvedValueOnce({ data: { items: [{ id: 'draft-1', status: 'draft' }], status: 'draft' } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'cat-1', name: 'Новости', is_active: true }] } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'tag-1', name: 'HUB', usage_count: 2 }] } });
    mockedClient.post
      .mockResolvedValueOnce({ data: { id: 'cat-2', name: 'События', is_active: true } })
      .mockResolvedValueOnce({ data: { markdown: '**Готово**' } });
    mockedClient.patch.mockResolvedValueOnce({ data: { id: 'cat-1', name: 'Компания', is_active: true } });
    mockedClient.delete.mockResolvedValue({ data: { ok: true } });

    await expect(listManagedFeedPosts('draft')).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({ id: 'draft-1', status: 'draft' })],
      total: 1,
    }));
    await expect(listFeedCategories()).resolves.toEqual([expect.objectContaining({ id: 'cat-1', name: 'Новости' })]);
    await expect(listFeedTags()).resolves.toEqual([expect.objectContaining({ id: 'tag-1', name: 'HUB' })]);
    await expect(createFeedCategory('События')).resolves.toEqual(expect.objectContaining({ id: 'cat-2' }));
    await expect(updateFeedCategory('cat/1', { name: 'Компания', is_active: true })).resolves.toEqual(expect.objectContaining({ name: 'Компания' }));
    await expect(transformFeedMarkdown('готово')).resolves.toBe('**Готово**');
    await deleteFeedCategory('cat/1');
    await deleteFeedPost('post/1');

    expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/hub/announcements/manage', { params: { status: 'draft', limit: 100 } });
    expect(mockedClient.post).toHaveBeenNthCalledWith(2, '/hub/markdown/transform', { text: 'готово', context: 'announcement' });
    expect(mockedClient.delete).toHaveBeenCalledWith('/hub/announcement-categories/cat%2F1');
    expect(mockedClient.delete).toHaveBeenCalledWith('/hub/announcements/post%2F1');
  });

  it('creates multipart posts and manages existing announcement attachments', async () => {
    const appendSpy = jest.spyOn(FormData.prototype, 'append');
    const payload = {
      title: 'Native post',
      preview: '',
      body: 'Body',
      priority: 'normal' as const,
      audience_scope: 'users' as const,
      audience_user_ids: [8],
      requires_ack: false,
      is_pinned: true,
      pinned_until: '2099-01-02T10:00:00.000Z',
      published_from: '2099-01-01T10:00:00.000Z',
      expires_at: '2099-01-03T10:00:00.000Z',
      comments_enabled: true,
      reactions_enabled: true,
      tags: [],
      poll: {
        question: 'Выбор?',
        options: ['Да', 'Нет'],
        allows_multiple: false,
        is_anonymous: true,
        closes_at: '2099-01-02T09:00:00.000Z',
      },
    };
    const file = {
      uri: 'file://cover.jpg', name: 'cover.jpg', mimeType: 'image/jpeg', size: 12, uploadId: 'upload-1',
    };
    mockedClient.post
      .mockResolvedValueOnce({ data: { id: 'p1', title: payload.title } })
      .mockResolvedValueOnce({ data: { id: 'a2', file_name: file.name } });
    mockedClient.patch.mockResolvedValue({ data: [{ id: 'a1' }, { id: 'a2' }] });
    mockedClient.delete.mockResolvedValue({ data: { ok: true } });

    await createFeedPost(payload, [file]);
    await expect(uploadFeedAttachment('p/1', file)).resolves.toEqual(expect.objectContaining({ id: 'a2' }));
    await expect(reorderFeedAttachments('p/1', ['a1', 'a2'], 'a2')).resolves.toEqual([{ id: 'a1' }, { id: 'a2' }]);
    await deleteFeedAttachment('p/1', 'a/1');

    expect(mockedClient.post).toHaveBeenNthCalledWith(
      1,
      '/hub/announcements',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    expect(mockedClient.post).toHaveBeenNthCalledWith(
      2,
      '/hub/announcements/p%2F1/attachments',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    expect(mockedClient.patch).toHaveBeenCalledWith('/hub/announcements/p%2F1/attachments/order', {
      attachment_ids: ['a1', 'a2'],
      cover_attachment_id: 'a2',
    });
    expect(mockedClient.delete).toHaveBeenCalledWith('/hub/announcements/p%2F1/attachments/a%2F1');
    expect(appendSpy).toHaveBeenCalledWith('client_upload_id', 'upload-1');
    appendSpy.mockRestore();
  });

  it('loads reaction users and manager analytics', async () => {
    mockedClient.get
      .mockResolvedValueOnce({ data: { items: [{ user_id: 8, full_name: 'Мария', reaction_type: 'love' }] } })
      .mockResolvedValueOnce({ data: { items: [{ user_id: 8, is_seen: true }], summary: { recipients_total: 1 } } });

    await expect(listFeedReactionUsers('p/1', 'love', { limit: 30, offset: 0 })).resolves.toEqual({
      items: [expect.objectContaining({ user_id: 8, reaction_type: 'love' })],
      total: 1,
      next_offset: null,
    });
    await expect(getFeedAnalytics('p/1', { limit: 30, offset: 0 })).resolves.toEqual({
      items: [expect.objectContaining({ user_id: 8, is_seen: true })],
      summary: { recipients_total: 1 },
      items_total: 1,
      next_offset: null,
    });
    expect(mockedClient.get).toHaveBeenNthCalledWith(1, '/hub/announcements/p%2F1/reactions', {
      params: { reaction_type: 'love', limit: 30, offset: 0 },
    });
    expect(mockedClient.get).toHaveBeenNthCalledWith(2, '/hub/announcements/p%2F1/analytics', {
      params: { limit: 30, offset: 0 },
    });
  });

  it('normalizes and paginates comment threads using backend field names', async () => {
    mockedClient.get.mockResolvedValue({
      data: {
        items: [{ id: 'c1', username: 'maria', full_name: 'Мария', user_id: 8, reply_count: 2 }],
        total: 1,
        comments_total: 3,
        next_offset: null,
      },
    });

    await expect(listFeedComments('p/1', {
      limit: 100,
      offset: 0,
      sort: 'oldest',
      rootCommentId: 'c/1',
    })).resolves.toEqual(expect.objectContaining({
      items: [expect.objectContaining({
        id: 'c1',
        full_name: 'Мария',
        author_full_name: 'Мария',
        user_id: 8,
        reply_count: 2,
      })],
      comments_total: 3,
      next_offset: null,
    }));
    expect(mockedClient.get).toHaveBeenCalledWith('/hub/announcements/p%2F1/comments', {
      params: expect.objectContaining({ root_comment_id: 'c/1', sort: 'oldest', limit: 100 }),
    });
  });

  it('uses reply, edit, delete and comment reaction contracts', async () => {
    mockedClient.post.mockResolvedValue({ data: { id: 'c1', body: 'Reply', username: 'user' } });
    mockedClient.patch.mockResolvedValue({ data: { id: 'c1', body: 'Edited', username: 'user' } });
    mockedClient.put.mockResolvedValue({ data: { viewer_reaction: 'love', reaction_counts: { love: 1 } } });
    mockedClient.delete.mockResolvedValue({ data: { viewer_reaction: null, reaction_counts: {} } });

    await createFeedComment('p/1', { body: 'Reply', parentCommentId: 'c/0', mentionedUserIds: [8] });
    await updateFeedComment('p/1', 'c/1', 'Edited');
    await setFeedCommentReaction('p/1', 'c/1', 'love');
    await setFeedCommentReaction('p/1', 'c/1', null);
    await deleteFeedComment('p/1', 'c/1');

    expect(mockedClient.post).toHaveBeenCalledWith('/hub/announcements/p%2F1/comments', {
      body: 'Reply',
      parent_comment_id: 'c/0',
      mentioned_user_ids: [8],
    }, undefined);
    expect(mockedClient.patch).toHaveBeenCalledWith('/hub/announcements/p%2F1/comments/c%2F1', { body: 'Edited' });
    expect(mockedClient.put).toHaveBeenCalledWith('/hub/announcements/p%2F1/comments/c%2F1/reaction', { reaction_type: 'love' });
    expect(mockedClient.delete).toHaveBeenCalledWith('/hub/announcements/p%2F1/comments/c%2F1/reaction');
    expect(mockedClient.delete).toHaveBeenCalledWith('/hub/announcements/p%2F1/comments/c%2F1');
    expect(buildFeedCommentAttachmentUrl('p/1', 'c/1', 'a 2')).toBe(
      'https://hubit.zsgp.ru/api/v1/hub/announcements/p%2F1/comments/c%2F1/attachments/a%202/file',
    );
  });

  it('uploads comment attachments as multipart form data', async () => {
    mockedClient.post.mockResolvedValue({ data: { id: 'c1', body: '', attachments: [{ id: 'a1' }] } });
    await createFeedComment('p1', {
      files: [{ uri: 'file://act.pdf', name: 'act.pdf', mimeType: 'application/pdf', size: 12 }],
    });
    expect(mockedClient.post).toHaveBeenCalledWith(
      '/hub/announcements/p1/comments',
      expect.any(FormData),
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
  });
});
