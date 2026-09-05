import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as feedApi from '../../api/feedApi';
import type { FeedPost } from '../../feed/feedFormat';
import { NativeFeedInboxScreen } from './NativeFeedInboxScreen';

const mockFeedPostCardRender = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'ivanov', role: 'user' },
    offlineMode: false,
    hasPermission: (permission: string) => permission === 'dashboard.read',
  }),
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/feedApi', () => ({
  createFeedCategory: jest.fn(),
  deleteFeedCategory: jest.fn(),
  listFeedCategories: jest.fn(),
  listFeedTags: jest.fn(),
  listManagedFeedPosts: jest.fn(),
  listFeedPosts: jest.fn(),
  markFeedPostRead: jest.fn(),
  removeFeedReaction: jest.fn(),
  setFeedBookmark: jest.fn(),
  setFeedReaction: jest.fn(),
  updateFeedCategory: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeCollectionSnapshot: jest.fn(async () => null),
  writeNativeCollectionSnapshot: jest.fn(async () => undefined),
}));

jest.mock('../../feed/FeedPostCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    FeedPostCard: React.memo(({ post }: { post: { id: string; title: string } }) => {
      mockFeedPostCardRender(post.id);
      return React.createElement(Text, null, post.title);
    }),
  };
});

const posts: FeedPost[] = Array.from({ length: 30 }, (_, index) => ({
  id: `post-${index}`,
  title: `Post ${String(index).padStart(2, '0')}`,
  preview: 'Preview',
  body: 'Body',
  author_full_name: 'Author',
  published_at: '2026-09-02T10:00:00+05:00',
  comments_count: 0,
  is_unread: false,
  reaction_counts: {},
  viewer_reaction: null,
  viewer_bookmarked: false,
  comments_enabled: true,
}));

const mockedApi = feedApi as jest.Mocked<typeof feedApi>;

it('does not rerender mounted feed cards for a draft keystroke or refresh spinner', async () => {
  mockedApi.listFeedPosts
    .mockResolvedValueOnce({ items: posts, total: posts.length, unread_total: 0 })
    .mockReturnValueOnce(new Promise(() => undefined));
  mockedApi.listFeedCategories.mockResolvedValue([]);
  mockedApi.listFeedTags.mockResolvedValue([]);

  const view = await render(<NativeFeedInboxScreen />);
  await waitFor(() => expect(view.getByText('Post 00')).toBeTruthy());
  mockFeedPostCardRender.mockClear();

  await fireEvent.changeText(view.getByTestId('feed-search-input'), 'p');
  const draftTypingRenders = mockFeedPostCardRender.mock.calls.length;
  mockFeedPostCardRender.mockClear();

  await act(async () => {
    view.getByTestId('feed-post-list').props.onRefresh();
  });
  const refreshSpinnerRenders = mockFeedPostCardRender.mock.calls.length;

  expect({ draftTypingRenders, refreshSpinnerRenders }).toEqual({
    draftTypingRenders: 0,
    refreshSpinnerRenders: 0,
  });
});
