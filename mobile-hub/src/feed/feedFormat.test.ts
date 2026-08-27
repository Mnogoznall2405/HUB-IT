import {
  buildFeedPostPath,
  formatFeedDate,
  getFeedInitials,
  getFeedReactionGroups,
  normalizeFeedComment,
  normalizeFeedPost,
  stripFeedMarkdown,
} from './feedFormat';
import { nativeFeedDestinationFromPortalPath } from './nativeFeedRoutes';

describe('feedFormat', () => {
  it('strips markdown for previews', () => {
    expect(stripFeedMarkdown('## Hello **world**\n\n- item')).toBe('Hello world item');
  });

  it('formats initials and share path', () => {
    expect(getFeedInitials('Иван Петров')).toBe('ИП');
    expect(buildFeedPostPath('post-1')).toBe('/feed?post=post-1');
  });

  it('normalizes posts and reaction groups', () => {
    const post = normalizeFeedPost({
      id: 7,
      title: 'Новость',
      comments_count: '3',
      reaction_counts: { like: 2, love: 0, laugh: 1 },
      category: { id: 'company', name: 'Компания', slug: 'company' },
      tags: [{ id: 'tag-1', name: 'HUB', slug: 'hub' }, 'Новости'],
      poll: { question: 'Выбор', allows_multiple: true, options: [{ id: 1, text: 'Да' }] },
    });
    expect(post).toEqual(expect.objectContaining({
      id: '7',
      title: 'Новость',
      comments_count: 3,
      category_id: 'company',
      category_name: 'Компания',
      tags: ['HUB', 'Новости'],
      poll: expect.objectContaining({ multiple: true, allows_multiple: true }),
    }));
    expect(getFeedReactionGroups(post?.reaction_counts)).toEqual([
      expect.objectContaining({ id: 'like', count: 2 }),
      expect.objectContaining({ id: 'laugh', count: 1 }),
    ]);
  });

  it('formats feed dates in Russian locale', () => {
    expect(formatFeedDate('2026-08-06T10:00:00Z')).toMatch(/2026|август|6/i);
  });

  it('normalizes backend comment author and reply fields', () => {
    expect(normalizeFeedComment({
      id: 'c1',
      full_name: 'Мария',
      username: 'maria',
      user_id: 8,
      reply_count: 2,
      attachments: [{ id: 'a1', file_name: 'act.pdf' }],
    })).toEqual(expect.objectContaining({
      author_full_name: 'Мария',
      author_username: 'maria',
      author_user_id: 8,
      replies_count: 2,
      attachments: [expect.objectContaining({ id: 'a1' })],
    }));
  });
});

describe('nativeFeedDestinationFromPortalPath', () => {
  it('maps feed list and deep-linked posts', () => {
    expect(nativeFeedDestinationFromPortalPath('/feed')).toEqual({ pathname: '/(shell)/feed' });
    expect(nativeFeedDestinationFromPortalPath('/feed?post=abc')).toEqual({
      pathname: '/(shell)/feed/[postId]',
      params: { postId: 'abc' },
    });
    expect(nativeFeedDestinationFromPortalPath('/feed?post=abc#feed-comment-9')).toEqual({
      pathname: '/(shell)/feed/[postId]',
      params: { postId: 'abc', commentId: '9' },
    });
  });
});
