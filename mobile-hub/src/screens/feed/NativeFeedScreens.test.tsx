import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Share } from 'react-native';
import { NativeFeedInboxScreen } from './NativeFeedInboxScreen';
import { NativeFeedEditorScreen } from './NativeFeedEditorScreen';
import { NativeFeedPostScreen } from './NativeFeedPostScreen';
import * as feedApi from '../../api/feedApi';
import * as feedFiles from '../../feed/nativeFeedFiles';
import * as snapshotCache from '../../cache/nativeSnapshotCache';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../preferences/preferenceNormalizers';

let mockAuth: {
  user: { id: number; username: string; role: string; permissions: string[] };
  hasPermission: (permission: string) => boolean;
  offlineMode?: boolean;
};

let mockPreferences: {
  preferences: UserPreferences;
  loading: boolean;
  refreshPreferences: jest.Mock;
  savePreferences: jest.Mock;
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => mockPreferences,
}));

jest.mock('../../api/feedApi', () => ({
  listFeedPosts: jest.fn(),
  listManagedFeedPosts: jest.fn(),
  listFeedCategories: jest.fn(),
  listFeedTags: jest.fn(),
  createFeedCategory: jest.fn(),
  updateFeedCategory: jest.fn(),
  deleteFeedCategory: jest.fn(),
  transformFeedMarkdown: jest.fn(),
  getFeedPost: jest.fn(),
  markFeedPostRead: jest.fn(),
  acknowledgeFeedPost: jest.fn(),
  setFeedReaction: jest.fn(),
  removeFeedReaction: jest.fn(),
  listFeedReactionUsers: jest.fn(),
  getFeedAnalytics: jest.fn(),
  setFeedBookmark: jest.fn(),
  listFeedComments: jest.fn(),
  createFeedComment: jest.fn(),
  updateFeedComment: jest.fn(),
  deleteFeedComment: jest.fn(),
  deleteFeedPost: jest.fn(),
  setFeedCommentReaction: jest.fn(),
  voteFeedPoll: jest.fn(),
  buildFeedAttachmentUrl: jest.fn(() => ''),
  buildFeedCommentAttachmentUrl: jest.fn(() => ''),
  createFeedPost: jest.fn(),
  createFeedDraft: jest.fn(),
  updateFeedPost: jest.fn(),
  publishFeedPost: jest.fn(),
  archiveFeedPost: jest.fn(),
  getFeedRecipients: jest.fn(),
  uploadFeedAttachment: jest.fn(),
  reorderFeedAttachments: jest.fn(),
  deleteFeedAttachment: jest.fn(),
}));

jest.mock('../../feed/nativeFeedFiles', () => ({
  pickNativeFeedFiles: jest.fn(),
  downloadNativeFeedAttachment: jest.fn(),
  openNativeFeedFile: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeCollectionSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => true),
  readNativeEntitySnapshot: jest.fn(async () => null),
  writeNativeEntitySnapshot: jest.fn(async () => undefined),
}));

const mockedUseLocalSearchParams = useLocalSearchParams as jest.Mock;

const samplePost = {
  id: 'post-1',
  title: 'Новости компании',
  preview: 'Короткое описание',
  body: 'Полный текст публикации',
  author_full_name: 'Иван Петров',
  published_at: '2026-08-06T10:00:00Z',
  comments_count: 1,
  is_unread: true,
  reaction_counts: { like: 2 },
  viewer_reaction: null,
  viewer_bookmarked: false,
  comments_enabled: true,
};

describe('NativeFeedInboxScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue(null);
    (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue(null);
    mockAuth = {
      user: { id: 1, username: 'user', role: 'user', permissions: ['dashboard.read', 'announcements.write'] },
      hasPermission: (permission) => ['dashboard.read', 'announcements.write'].includes(permission),
    };
    mockPreferences = {
      preferences: { ...DEFAULT_PREFERENCES },
      loading: false,
      refreshPreferences: jest.fn(),
      savePreferences: jest.fn(),
    };
    (feedApi.listFeedPosts as jest.Mock).mockResolvedValue({
      items: [samplePost],
      total: 1,
      unread_total: 1,
    });
    (feedApi.listManagedFeedPosts as jest.Mock).mockResolvedValue({ items: [], total: 0 });
    (feedApi.listFeedCategories as jest.Mock).mockResolvedValue([]);
    (feedApi.listFeedTags as jest.Mock).mockResolvedValue([]);
  });

  it('renders feed posts and opens the native editor for publishers', async () => {
    const view = await render(<NativeFeedInboxScreen />);
    await waitFor(() => {
      expect(view.getByText('Новости компании')).toBeTruthy();
    });
    expect(view.getByText('Короткое описание')).toBeTruthy();
    await waitFor(() => expect(snapshotCache.writeNativeCollectionSnapshot).toHaveBeenCalledWith(
      'feed-inbox',
      1,
      expect.any(String),
      expect.objectContaining({ items: [expect.objectContaining({ id: 'post-1' })] }),
    ));
    expect(view.getByTestId('feed-create')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('feed-create'));
    });
    expect(router.push).toHaveBeenCalledWith('/(shell)/feed/editor');
  });

  it('opens the saved feed immediately offline without requesting the API', async () => {
    mockAuth = { ...mockAuth, offlineMode: true };
    (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockImplementation(
      async (_scope: string, _userId: number, signature: string) => ({
        savedAt: 1,
        data: {
          signature,
          items: [{ ...samplePost, id: 'cached-post', title: 'Сохранённая публикация' }],
          total: 1,
          unreadTotal: 0,
        },
      }),
    );
    (feedApi.listFeedPosts as jest.Mock).mockRejectedValue(new Error('offline'));

    const view = await render(<NativeFeedInboxScreen />);

    await waitFor(() => expect(view.getByText('Сохранённая публикация')).toBeTruthy());
    expect(feedApi.listFeedPosts).not.toHaveBeenCalled();
    expect(feedApi.listFeedCategories).not.toHaveBeenCalled();
    expect(feedApi.listFeedTags).not.toHaveBeenCalled();
  });

  it('searches the prepared default feed locally while offline', async () => {
    mockAuth = { ...mockAuth, offlineMode: true };
    const defaultSignature = JSON.stringify({ filter: 'all', q: '', categoryId: '', tag: '' });
    (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockImplementation(
      async (_scope: string, _userId: number, signature: string) => signature === defaultSignature ? ({
        savedAt: 1,
        data: {
          signature,
          items: [
            { ...samplePost, id: 'cached-first', title: 'Первая публикация' },
            { ...samplePost, id: 'cached-second', title: 'Вторая публикация' },
          ],
          total: 2,
          unreadTotal: 0,
        },
      }) : null,
    );

    const view = await render(<NativeFeedInboxScreen />);
    await waitFor(() => expect(view.getByText('Вторая публикация')).toBeTruthy());
    await act(async () => { fireEvent.changeText(view.getByTestId('feed-search-input'), 'Вторая'); });

    await waitFor(() => expect(view.queryByText('Первая публикация')).toBeNull());
    expect(view.getByText('Вторая публикация')).toBeTruthy();
    expect(feedApi.listFeedPosts).not.toHaveBeenCalled();
  });

  it('hides create without announcements.write', async () => {
    mockAuth = {
      user: { id: 2, username: 'reader', role: 'viewer', permissions: ['dashboard.read'] },
      hasPermission: (permission) => permission === 'dashboard.read',
    };
    const view = await render(<NativeFeedInboxScreen />);
    await waitFor(() => {
      expect(view.getByText('Новости компании')).toBeTruthy();
    });
    expect(view.queryByTestId('feed-create')).toBeNull();
  });

  it('opens managed statuses and exposes all quick reactions on feed cards', async () => {
    (feedApi.listManagedFeedPosts as jest.Mock).mockResolvedValue({
      items: [{ ...samplePost, id: 'draft-1', status: 'draft' }],
      total: 1,
    });
    const view = await render(<NativeFeedInboxScreen />);
    await waitFor(() => expect(view.getByText('Новости компании')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByLabelText('Нравится')); });
    expect(view.getByTestId('feed-card-reaction-post-1-angry')).toBeTruthy();
    await act(async () => { fireEvent.press(view.getByTestId('feed-card-reaction-post-1-love')); });
    await waitFor(() => expect(feedApi.setFeedReaction).toHaveBeenCalledWith('post-1', 'love'));

    await act(async () => { fireEvent.press(view.getByTestId('feed-filter-draft')); });
    await waitFor(() => expect(feedApi.listManagedFeedPosts).toHaveBeenCalledWith('draft', 100));
    expect(view.getByTestId('feed-post-card-draft-1')).toBeTruthy();
  });
});

describe('NativeFeedEditorScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue(null);
    (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue(null);
    mockedUseLocalSearchParams.mockReturnValue({});
    mockAuth = {
      user: { id: 1, username: 'publisher', role: 'user', permissions: ['dashboard.read', 'announcements.write'] },
      hasPermission: (permission) => ['dashboard.read', 'announcements.write'].includes(permission),
      offlineMode: false,
    };
    mockPreferences = {
      preferences: { ...DEFAULT_PREFERENCES },
      loading: false,
      refreshPreferences: jest.fn(),
      savePreferences: jest.fn(),
    };
    (feedApi.createFeedPost as jest.Mock).mockResolvedValue({ ...samplePost, can_manage: true });
    (feedApi.createFeedDraft as jest.Mock).mockResolvedValue({ ...samplePost, status: 'draft', can_manage: true });
    (feedApi.updateFeedPost as jest.Mock).mockResolvedValue({ ...samplePost, title: 'Обновлённые новости', can_manage: true });
    (feedApi.publishFeedPost as jest.Mock).mockResolvedValue({ ...samplePost, status: 'published', can_manage: true });
    (feedApi.archiveFeedPost as jest.Mock).mockResolvedValue({ ...samplePost, status: 'archived', can_manage: true });
    (feedApi.getFeedRecipients as jest.Mock).mockResolvedValue({
      users: [{ id: 8, username: 'maria', full_name: 'Мария', department: 'ИТ' }],
      roles: [{ value: 'manager', label: 'Менеджер' }],
    });
    (feedApi.listFeedCategories as jest.Mock).mockResolvedValue([]);
    (feedApi.listFeedTags as jest.Mock).mockResolvedValue([]);
    (feedApi.transformFeedMarkdown as jest.Mock).mockResolvedValue('**Markdown**');
    (feedApi.uploadFeedAttachment as jest.Mock).mockResolvedValue({ id: 'attachment-2', file_name: 'plan.pdf' });
    (feedApi.reorderFeedAttachments as jest.Mock).mockResolvedValue([]);
    (feedApi.deleteFeedAttachment as jest.Mock).mockResolvedValue(undefined);
    (feedFiles.pickNativeFeedFiles as jest.Mock).mockResolvedValue([]);
  });

  it('publishes a new post with the native editor contract', async () => {
    const view = await render(<NativeFeedEditorScreen />);
    await act(async () => {
      fireEvent.changeText(view.getByTestId('feed-editor-title'), 'Нативная публикация');
      fireEvent.changeText(view.getByTestId('feed-editor-preview'), 'Короткий анонс');
      fireEvent.changeText(view.getByTestId('feed-editor-body'), 'Основной текст публикации');
      fireEvent.changeText(view.getByTestId('feed-editor-tags'), 'HUB, новости, HUB');
      fireEvent.press(view.getByTestId('feed-editor-requires-ack'));
      fireEvent.press(view.getByTestId('feed-editor-priority-high'));
    });
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-publish')); });
    await waitFor(() => expect(feedApi.createFeedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Нативная публикация',
        preview: 'Короткий анонс',
        body: 'Основной текст публикации',
        priority: 'high',
        requires_ack: true,
        tags: ['HUB', 'новости'],
        status: 'published',
      }),
      [],
    ));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/(shell)/feed/[postId]', params: { postId: 'post-1' } });
  });

  it('loads and publishes an editable draft', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ postId: 'post-1' });
    (feedApi.getFeedPost as jest.Mock).mockResolvedValueOnce({ ...samplePost, status: 'draft', can_manage: true });
    const view = await render(<NativeFeedEditorScreen />);
    await waitFor(() => expect(view.getByTestId('feed-editor-save')).toBeTruthy());
    await act(async () => { fireEvent.changeText(view.getByTestId('feed-editor-title'), 'Обновлённые новости'); });
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-publish')); });
    await waitFor(() => {
      expect(feedApi.updateFeedPost).toHaveBeenCalledWith('post-1', expect.objectContaining({ title: 'Обновлённые новости' }));
      expect(feedApi.publishFeedPost).toHaveBeenCalledWith('post-1');
    });
  });

  it('publishes audience, schedule and poll fields from the native editor', async () => {
    const view = await render(<NativeFeedEditorScreen />);
    await waitFor(() => expect(feedApi.getFeedRecipients).toHaveBeenCalled());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('feed-editor-title'), 'Плановое объявление');
      fireEvent.changeText(view.getByTestId('feed-editor-body'), 'Подробности планового объявления');
      fireEvent.press(view.getByTestId('feed-editor-audience-users'));
    });
    await waitFor(() => expect(view.getByTestId('feed-editor-recipient-8')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('feed-editor-recipient-8'));
      fireEvent.press(view.getByTestId('feed-editor-pinned'));
    });
    await waitFor(() => expect(view.getByTestId('feed-editor-pinned-until')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('feed-editor-published-from'), '2099-01-01 10:00');
      fireEvent.changeText(view.getByTestId('feed-editor-pinned-until'), '2099-01-02 10:00');
      fireEvent.changeText(view.getByTestId('feed-editor-expires-at'), '2099-01-03 10:00');
      fireEvent.press(view.getByTestId('feed-editor-poll-enabled'));
    });
    await waitFor(() => expect(view.getByTestId('feed-editor-poll-question')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('feed-editor-poll-question'), 'Какой вариант выбрать?');
      fireEvent.changeText(view.getByTestId('feed-editor-poll-option-0'), 'Первый');
      fireEvent.changeText(view.getByTestId('feed-editor-poll-option-1'), 'Второй');
      fireEvent.press(view.getByTestId('feed-editor-poll-anonymous'));
      fireEvent.changeText(view.getByTestId('feed-editor-poll-closes-at'), '2099-01-02 09:00');
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('feed-editor-publish'));
    });

    await waitFor(() => expect(feedApi.createFeedPost).toHaveBeenCalledWith(
      expect.objectContaining({
        audience_scope: 'users',
        audience_user_ids: [8],
        audience_roles: [],
        is_pinned: true,
        published_from: expect.any(String),
        pinned_until: expect.any(String),
        expires_at: expect.any(String),
        poll: expect.objectContaining({
          question: 'Какой вариант выбрать?',
          options: ['Первый', 'Второй'],
          allows_multiple: false,
          is_anonymous: true,
          closes_at: expect.any(String),
        }),
      }),
      [],
    ));
  });

  it('selects a server category and transforms Markdown in the native editor', async () => {
    (feedApi.listFeedCategories as jest.Mock).mockResolvedValueOnce([{ id: 'cat-1', name: 'Компания', is_active: true }]);
    const view = await render(<NativeFeedEditorScreen />);
    await waitFor(() => expect(view.getByTestId('feed-editor-category-cat-1')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByTestId('feed-editor-title'), 'Новости компании');
      fireEvent.changeText(view.getByTestId('feed-editor-body'), 'Обычный текст');
      fireEvent.press(view.getByTestId('feed-editor-category-cat-1'));
    });
    await waitFor(() => expect(view.getByTestId('feed-editor-body').props.value).toBe('Обычный текст'));
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-transform-markdown')); });
    await waitFor(() => expect(feedApi.transformFeedMarkdown).toHaveBeenCalledWith('Обычный текст'));
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-publish')); });
    await waitFor(() => expect(feedApi.createFeedPost).toHaveBeenCalledWith(
      expect.objectContaining({ category_id: 'cat-1', body: '**Markdown**', client_request_id: expect.any(String) }),
      [],
    ));
  });

  it('sends selected attachments atomically when publishing a new post', async () => {
    const cover = { uri: 'file://cover.jpg', name: 'cover.jpg', mimeType: 'image/jpeg', size: 12 };
    const document = { uri: 'file://plan.pdf', name: 'plan.pdf', mimeType: 'application/pdf', size: 14 };
    (feedFiles.pickNativeFeedFiles as jest.Mock).mockResolvedValue([cover, document]);
    const view = await render(<NativeFeedEditorScreen />);
    await act(async () => {
      fireEvent.changeText(view.getByTestId('feed-editor-title'), 'Публикация с файлами');
      fireEvent.changeText(view.getByTestId('feed-editor-body'), 'Текст публикации с файлами');
      fireEvent.press(view.getByTestId('feed-editor-attachments-pick'));
    });
    await waitFor(() => expect(view.getByText('cover.jpg')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-publish')); });

    await waitFor(() => expect(feedApi.createFeedPost).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published' }),
      [cover, document],
    ));
  });

  it('uploads and orders new files when saving an existing post', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ postId: 'post-1' });
    const existing = { id: 'attachment-1', file_name: 'cover.jpg', file_mime: 'image/jpeg', is_cover: true };
    const file = { uri: 'file://plan.pdf', name: 'plan.pdf', mimeType: 'application/pdf', size: 14 };
    (feedApi.getFeedPost as jest.Mock).mockResolvedValueOnce({
      ...samplePost,
      can_manage: true,
      status: 'published',
      attachments: [existing],
      cover_attachment: existing,
    });
    (feedFiles.pickNativeFeedFiles as jest.Mock).mockResolvedValue([file]);
    (feedApi.reorderFeedAttachments as jest.Mock).mockResolvedValue([existing, { id: 'attachment-2', file_name: 'plan.pdf' }]);
    const view = await render(<NativeFeedEditorScreen />);
    await waitFor(() => expect(view.getByTestId('feed-editor-save')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-attachments-pick')); });
    await waitFor(() => expect(view.getByText('plan.pdf')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByLabelText('Поднять файл plan.pdf')); });
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-save')); });

    await waitFor(() => {
      expect(feedApi.uploadFeedAttachment).toHaveBeenCalledWith('post-1', file);
      expect(feedApi.reorderFeedAttachments).toHaveBeenCalledWith(
        'post-1',
        ['attachment-2', 'attachment-1'],
        'attachment-1',
      );
    });
  });

  it('keeps successful attachment uploads after a later file fails', async () => {
    mockedUseLocalSearchParams.mockReturnValue({ postId: 'post-1' });
    const first = { uri: 'file://first.pdf', name: 'first.pdf', mimeType: 'application/pdf', size: 11, uploadId: 'upload-1' };
    const second = { uri: 'file://second.pdf', name: 'second.pdf', mimeType: 'application/pdf', size: 12, uploadId: 'upload-2' };
    (feedApi.getFeedPost as jest.Mock).mockResolvedValueOnce({ ...samplePost, can_manage: true, attachments: [] });
    (feedFiles.pickNativeFeedFiles as jest.Mock).mockResolvedValue([first, second]);
    (feedApi.uploadFeedAttachment as jest.Mock)
      .mockResolvedValueOnce({ id: 'attachment-1', file_name: 'first.pdf' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ id: 'attachment-2', file_name: 'second.pdf' });
    (feedApi.reorderFeedAttachments as jest.Mock).mockResolvedValue([
      { id: 'attachment-1', file_name: 'first.pdf' },
      { id: 'attachment-2', file_name: 'second.pdf' },
    ]);
    const view = await render(<NativeFeedEditorScreen />);
    await waitFor(() => expect(view.getByTestId('feed-editor-save')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-attachments-pick')); });
    await waitFor(() => expect(view.getByText('second.pdf')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-save')); });
    await waitFor(() => expect(feedApi.uploadFeedAttachment).toHaveBeenCalledTimes(2));
    await act(async () => { fireEvent.press(view.getByTestId('feed-editor-save')); });

    await waitFor(() => expect(feedApi.reorderFeedAttachments).toHaveBeenCalledWith(
      'post-1',
      ['attachment-1', 'attachment-2'],
      '',
    ));
    expect(feedApi.uploadFeedAttachment).toHaveBeenCalledTimes(3);
    expect((feedApi.uploadFeedAttachment as jest.Mock).mock.calls.map((call) => call[1])).toEqual([first, second, second]);
  });
});

describe('NativeFeedPostScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (snapshotCache.readNativeCollectionSnapshot as jest.Mock).mockResolvedValue(null);
    (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue(null);
    mockedUseLocalSearchParams.mockReturnValue({ postId: 'post-1' });
    mockAuth = {
      user: { id: 1, username: 'user', role: 'user', permissions: ['dashboard.read'] },
      hasPermission: () => true,
    };
    mockPreferences = {
      preferences: { ...DEFAULT_PREFERENCES },
      loading: false,
      refreshPreferences: jest.fn(),
      savePreferences: jest.fn(),
    };
    (feedApi.getFeedPost as jest.Mock).mockResolvedValue(samplePost);
    (feedApi.markFeedPostRead as jest.Mock).mockResolvedValue({ ...samplePost, is_unread: false });
    (feedApi.listFeedComments as jest.Mock).mockResolvedValue({
      items: [{ id: 'c1', body: 'Первый комментарий', full_name: 'Мария', created_at: '2026-08-06T11:00:00Z' }],
      total: 1,
      comments_total: 1,
      next_offset: null,
    });
    (feedApi.createFeedComment as jest.Mock).mockResolvedValue({
      id: 'c2',
      body: 'Новый комментарий',
      author_full_name: 'Я',
      created_at: '2026-08-06T12:00:00Z',
    });
    (feedApi.listFeedReactionUsers as jest.Mock).mockResolvedValue({ items: [], total: 0, next_offset: null });
    (feedApi.getFeedAnalytics as jest.Mock).mockResolvedValue({ items: [], summary: {}, items_total: 0, next_offset: null });
  });

  it('loads a post with comments and sends a new comment', async () => {
    const view = await render(<NativeFeedPostScreen />);
    await waitFor(() => {
      expect(view.getByText('Полный текст публикации')).toBeTruthy();
    });
    expect(view.getByText('Первый комментарий')).toBeTruthy();
    await waitFor(() => expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
      'feed-post-details',
      1,
      'post-1',
      expect.objectContaining({
        post: expect.objectContaining({ id: 'post-1' }),
        comments: [expect.objectContaining({ id: 'c1' })],
      }),
    ));
    await act(async () => {
      fireEvent.changeText(view.getByTestId('feed-comment-input'), 'Новый комментарий');
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('feed-comment-send'));
    });
    await waitFor(() => {
      expect(feedApi.createFeedComment).toHaveBeenCalledWith('post-1', expect.objectContaining({
        body: 'Новый комментарий',
        parentCommentId: '',
        mentionedUserIds: [],
        files: [],
        clientRequestId: expect.any(String),
      }));
    });
  });

  it('opens a previously viewed post with comments offline without network calls', async () => {
    mockAuth = { ...mockAuth, offlineMode: true };
    (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({
      savedAt: 1,
      data: {
        post: { ...samplePost, body: 'Сохранённый полный текст' },
        comments: [{ id: 'cached-comment', body: 'Сохранённый комментарий', full_name: 'Мария' }],
        commentsTotal: 1,
        commentsNextOffset: null,
        commentsSort: 'interesting',
        replies: {},
      },
    });
    (feedApi.getFeedPost as jest.Mock).mockRejectedValue(new Error('offline'));
    (feedApi.listFeedComments as jest.Mock).mockRejectedValue(new Error('offline'));

    const view = await render(<NativeFeedPostScreen />);

    await waitFor(() => expect(view.getByText('Сохранённый полный текст')).toBeTruthy());
    expect(view.getByText('Сохранённый комментарий')).toBeTruthy();
    expect(feedApi.getFeedPost).not.toHaveBeenCalled();
    expect(feedApi.listFeedComments).not.toHaveBeenCalled();
  });

  it('paginates roots and loads a reply thread', async () => {
    (feedApi.listFeedComments as jest.Mock).mockImplementation((_postId, options = {}) => {
      if (options.rootCommentId === 'c1') {
        return Promise.resolve({
          items: [{ id: 'r1', body: 'Ответ в ветке', full_name: 'Иван', root_comment_id: 'c1' }],
          total: 1,
          comments_total: 3,
          next_offset: null,
        });
      }
      if (options.offset === 1) {
        return Promise.resolve({
          items: [{ id: 'c2', body: 'Вторая страница', full_name: 'Олег' }],
          total: 2,
          comments_total: 3,
          next_offset: null,
        });
      }
      return Promise.resolve({
        items: [{ id: 'c1', body: 'Корневой комментарий', username: 'maria', reply_count: 1 }],
        total: 2,
        comments_total: 3,
        next_offset: 1,
      });
    });

    const view = await render(<NativeFeedPostScreen />);
    await waitFor(() => expect(view.getByText('Корневой комментарий')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-replies-c1')); });
    await waitFor(() => expect(view.getByText('Ответ в ветке')).toBeTruthy());
    expect(feedApi.listFeedComments).toHaveBeenCalledWith('post-1', expect.objectContaining({
      rootCommentId: 'c1',
      sort: 'oldest',
    }));

    await act(async () => { fireEvent.press(view.getByTestId('feed-comments-load-more')); });
    await waitFor(() => expect(view.getByText('Вторая страница')).toBeTruthy());
    expect(feedApi.listFeedComments).toHaveBeenCalledWith('post-1', expect.objectContaining({ offset: 1 }));
  });

  it('replies, edits, reacts to and deletes comments through native controls', async () => {
    const root = {
      id: 'c1',
      body: 'Первый комментарий',
      full_name: 'Мария',
      username: 'maria',
      user_id: 8,
      can_edit: true,
      can_delete: true,
      reaction_counts: {},
      viewer_reaction: null,
      reply_count: 0,
    };
    (feedApi.listFeedComments as jest.Mock).mockImplementation((_postId, options = {}) => Promise.resolve({
      items: options.rootCommentId
        ? [{ id: 'r2', body: '@maria, Ответ', full_name: 'Я', root_comment_id: 'c1', parent_comment_id: 'c1' }]
        : [root],
      total: 1,
      comments_total: options.rootCommentId ? 2 : 1,
      next_offset: null,
    }));
    (feedApi.createFeedComment as jest.Mock).mockResolvedValue({
      id: 'r2', body: '@maria, Ответ', full_name: 'Я', root_comment_id: 'c1', parent_comment_id: 'c1',
    });
    (feedApi.updateFeedComment as jest.Mock).mockResolvedValue({ ...root, body: 'Исправленный комментарий' });
    (feedApi.setFeedCommentReaction as jest.Mock).mockResolvedValue({ viewer_reaction: 'love', reaction_counts: { love: 1 } });
    (feedApi.deleteFeedComment as jest.Mock).mockResolvedValue(undefined);

    const view = await render(<NativeFeedPostScreen />);
    await waitFor(() => expect(view.getByText('Первый комментарий')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getAllByText('Ответить')[0]); });
    await act(async () => { fireEvent.changeText(view.getByTestId('feed-comment-input'), '@maria, Ответ'); });
    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-send')); });
    await waitFor(() => expect(feedApi.createFeedComment).toHaveBeenCalledWith('post-1', expect.objectContaining({
      parentCommentId: 'c1',
      mentionedUserIds: [8],
    })));

    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-edit-c1')); });
    await act(async () => { fireEvent.changeText(view.getByTestId('feed-comment-edit-input-c1'), 'Исправленный комментарий'); });
    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-edit-save-c1')); });
    await waitFor(() => expect(feedApi.updateFeedComment).toHaveBeenCalledWith('post-1', 'c1', 'Исправленный комментарий'));

    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-reaction-picker-c1')); });
    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-reaction-option-c1-love')); });
    await waitFor(() => expect(feedApi.setFeedCommentReaction).toHaveBeenCalledWith('post-1', 'c1', 'love'));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-delete-c1')); });
    await waitFor(() => expect(feedApi.deleteFeedComment).toHaveBeenCalledWith('post-1', 'c1'));
    alertSpy.mockRestore();
  });

  it('sends attachment-only comments and opens authenticated comment files', async () => {
    (feedApi.listFeedComments as jest.Mock).mockResolvedValue({
      items: [{
        id: 'c1',
        body: 'Файл',
        full_name: 'Мария',
        attachments: [{ id: 'a1', file_name: 'акт.pdf', file_mime: 'application/pdf', file_size: 12 }],
      }],
      total: 1,
      comments_total: 1,
      next_offset: null,
    });
    const pickedFile = { uri: 'file://act.pdf', name: 'акт.pdf', mimeType: 'application/pdf', size: 12 };
    (feedFiles.pickNativeFeedFiles as jest.Mock).mockResolvedValue([pickedFile]);
    (feedFiles.downloadNativeFeedAttachment as jest.Mock).mockResolvedValue({ uri: 'file://cached-act.pdf' });
    (feedFiles.openNativeFeedFile as jest.Mock).mockResolvedValue(undefined);

    const view = await render(<NativeFeedPostScreen />);
    await waitFor(() => expect(view.getByTestId('feed-comment-attachment-a1')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-attach')); });
    await waitFor(() => expect(view.getAllByText('акт.pdf')).toHaveLength(2));
    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-send')); });
    await waitFor(() => expect(feedApi.createFeedComment).toHaveBeenCalledWith('post-1', expect.objectContaining({
      body: '',
      files: [pickedFile],
    })));

    await act(async () => { fireEvent.press(view.getByTestId('feed-comment-attachment-a1')); });
    await waitFor(() => expect(feedFiles.downloadNativeFeedAttachment).toHaveBeenCalledWith(
      'post-1',
      expect.objectContaining({ id: 'a1' }),
      'c1',
    ));
    expect(feedFiles.openNativeFeedFile).toHaveBeenCalled();
  });

  it('shows reaction users and manager analytics from supported feed endpoints', async () => {
    (feedApi.getFeedPost as jest.Mock).mockResolvedValueOnce({ ...samplePost, can_manage: true });
    (feedApi.listFeedReactionUsers as jest.Mock).mockResolvedValueOnce({
      items: [{ user_id: 8, full_name: 'Мария', username: 'maria', reaction_type: 'like' }],
      total: 1,
      next_offset: null,
    });
    (feedApi.getFeedAnalytics as jest.Mock).mockResolvedValueOnce({
      items: [{ user_id: 8, full_name: 'Мария', is_seen: true, is_acknowledged: true }],
      summary: { recipients_total: 1, seen_total: 1, ack_total: 1, reaction_counts: { like: 2 } },
    });
    const view = await render(<NativeFeedPostScreen />);
    await waitFor(() => expect(view.getByTestId('feed-reaction-details-toggle')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('feed-reaction-details-toggle')); });
    await waitFor(() => expect(feedApi.listFeedReactionUsers).toHaveBeenCalledWith('post-1', '', { limit: 30, offset: 0 }));
    expect(view.getAllByText('Мария').length).toBeGreaterThan(0);

    await act(async () => { fireEvent.press(view.getByTestId('feed-analytics-toggle')); });
    await waitFor(() => expect(feedApi.getFeedAnalytics).toHaveBeenCalledWith('post-1', { limit: 30, offset: 0 }));
    expect(view.getByText('Статистика публикации')).toBeTruthy();
    expect(view.getByText('Прочитано · подтверждено')).toBeTruthy();
  });

  it('stages a multi-select poll, uses system share and gates permanent delete by moderation', async () => {
    mockAuth = {
      user: { id: 1, username: 'moderator', role: 'admin', permissions: ['dashboard.read', 'announcements.write', 'announcements.moderate'] },
      hasPermission: (permission) => ['dashboard.read', 'announcements.write', 'announcements.moderate'].includes(permission),
    };
    const pollPost = {
      ...samplePost,
      can_manage: true,
      status: 'published',
      poll: {
        question: 'Выберите варианты',
        multiple: true,
        total_voters: 4,
        viewer_option_ids: [],
        options: [
          { id: 'o1', text: 'Первый', votes_count: 3 },
          { id: 'o2', text: 'Второй', votes_count: 1 },
        ],
      },
    };
    (feedApi.getFeedPost as jest.Mock).mockResolvedValueOnce(pollPost);
    (feedApi.voteFeedPoll as jest.Mock).mockResolvedValueOnce({ ...pollPost, poll: { ...pollPost.poll, viewer_option_ids: ['o1'] } });
    (feedApi.deleteFeedPost as jest.Mock).mockResolvedValue(undefined);
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    const view = await render(<NativeFeedPostScreen />);
    await waitFor(() => expect(view.getByTestId('feed-poll-option-o1')).toBeTruthy());
    expect(view.getByText('75% · 3')).toBeTruthy();

    await act(async () => { fireEvent.press(view.getByTestId('feed-poll-option-o1')); });
    expect(feedApi.voteFeedPoll).not.toHaveBeenCalled();
    await act(async () => { fireEvent.press(view.getByTestId('feed-poll-submit')); });
    await waitFor(() => expect(feedApi.voteFeedPoll).toHaveBeenCalledWith('post-1', ['o1']));

    await act(async () => { fireEvent.press(view.getByTestId('feed-share')); });
    await waitFor(() => expect(shareSpy).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('/feed?post=post-1') })));

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.style === 'destructive')?.onPress?.();
    });
    await act(async () => { fireEvent.press(view.getByTestId('feed-delete')); });
    await waitFor(() => expect(feedApi.deleteFeedPost).toHaveBeenCalledWith('post-1'));
    alertSpy.mockRestore();
    shareSpy.mockRestore();
  });
});
