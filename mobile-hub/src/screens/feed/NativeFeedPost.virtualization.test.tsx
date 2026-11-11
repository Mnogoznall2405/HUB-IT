import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Share } from 'react-native';
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


beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { user: { id: 1, username: 'audit', role: 'admin', permissions: [] }, hasPermission: () => true, offlineMode: false };
  mockPreferences = { preferences: DEFAULT_PREFERENCES, loading: false, refreshPreferences: jest.fn(), savePreferences: jest.fn() };
  mockedUseLocalSearchParams.mockReturnValue({ postId: 'post-1' });
  (feedApi.getFeedPost as jest.Mock).mockResolvedValue({ ...samplePost, is_unread: false });
  (feedApi.markFeedPostRead as jest.Mock).mockResolvedValue({ ...samplePost, is_unread: false });
  (feedApi.listFeedReactionUsers as jest.Mock).mockResolvedValue({ items: [], total: 0, next_offset: null });
  (feedApi.getFeedAnalytics as jest.Mock).mockResolvedValue({ items: [], summary: {}, items_total: 0, next_offset: null });
});
it.each([100, 500])('keeps a %i-reply thread virtualized and supports collapse', async count => {
  (feedApi.listFeedComments as jest.Mock).mockImplementation((_id, options = {}) => Promise.resolve({
    items: options.rootCommentId ? Array.from({ length: count }, (_, i) => ({ id: `reply-${i}`, body: `Audit reply ${i}`, root_comment_id: 'root' })) : [{ id: 'root', body: 'Audit root', reply_count: count }],
    total: options.rootCommentId ? count : 1, comments_total: count + 1, next_offset: null,
  }));
  const view = await render(<NativeFeedPostScreen />);
  await view.findByText('Audit root');
  await act(async () => { fireEvent.press(view.getByTestId('feed-comment-replies-root')); });
  await waitFor(() => expect(view.getAllByText(/^Audit reply /)).toHaveLength(11));
  await act(async () => { fireEvent.press(view.getByTestId('feed-comment-replies-root')); });
  expect(view.queryAllByText(/^Audit reply /)).toHaveLength(0);
  expect(view.getByText('Audit root')).toBeTruthy();
});
