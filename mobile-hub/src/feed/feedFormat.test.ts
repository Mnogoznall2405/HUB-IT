import {
  buildFeedPostPath,
  formatFeedAbsoluteDate,
  formatFeedDate,
  formatFeedPublishedMeta,
  formatFeedRelativeTime,
  getFeedInitials,
  getFeedReactionGroups,
  normalizeFeedComment,
  normalizeFeedPost,
  pluralizeFeedPublications,
  pluralizeFeedUnread,
  stripFeedMarkdown,
  stripFeedMarkdownMultiline,
} from './feedFormat';
import { nativeFeedDestinationFromPortalPath } from './nativeFeedRoutes';

describe('feedFormat', () => {
  it('strips markdown for previews', () => {
    expect(stripFeedMarkdown('## Hello **world**\n\n- item')).toBe('Hello world item');
    expect(stripFeedMarkdownMultiline('## Hello\nвторая строка\n\nновый абзац')).toBe('Hello\nвторая строка\n\nновый абзац');
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

  it('formats relative publication time like a social feed', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    expect(formatFeedRelativeTime('2026-08-06T11:59:40Z', now)).toBe('только что');
    expect(formatFeedRelativeTime('2026-08-06T11:30:00Z', now)).toBe('30 мин назад');
    expect(formatFeedRelativeTime('2026-08-06T09:00:00Z', now)).toBe('3 ч назад');
    expect(formatFeedRelativeTime('2026-08-05T12:00:00Z', now)).toBe('вчера');
    expect(formatFeedRelativeTime('2026-08-03T12:00:00Z', now)).toBe('3 дн назад');
    expect(formatFeedRelativeTime('2026-07-01T12:00:00Z', now)).toMatch(/1\s*(июл|июля|июл\.)/i);
    expect(formatFeedRelativeTime('2025-07-01T12:00:00Z', now)).toMatch(/2025/);
    expect(formatFeedRelativeTime('2026-08-06T12:30:00Z', now)).toBe('через 30 мин');
    expect(formatFeedRelativeTime('2026-08-06T15:00:00Z', now)).toBe('через 3 ч');
    expect(formatFeedRelativeTime('2026-08-07T12:00:00Z', now)).toBe('завтра');
    expect(formatFeedRelativeTime('2026-08-09T12:00:00Z', now)).toBe('через 3 дн');
    expect(formatFeedRelativeTime('', now)).toBe('');
    expect(formatFeedRelativeTime('not-a-date', now)).toBe('');
  });

  it('formats absolute dates with year only outside the current year', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    expect(formatFeedAbsoluteDate('2026-08-06T10:00:00Z', now)).toMatch(/август/);
    expect(formatFeedAbsoluteDate('2026-08-06T10:00:00Z', now)).not.toMatch(/2026/);
    expect(formatFeedAbsoluteDate('2025-08-06T10:00:00Z', now)).toMatch(/2025/);
  });

  it('marks edited publications and pluralizes counters', () => {
    const now = new Date('2026-08-06T12:00:00Z');
    expect(formatFeedPublishedMeta({
      published_at: '2026-08-06T11:30:00Z',
      updated_at: '2026-08-06T11:40:00Z',
      is_updated: true,
    }, now)).toBe('30 мин назад · изменено');
    expect(formatFeedPublishedMeta({
      published_at: '2026-08-06T11:30:00Z',
      updated_at: '2026-08-06T11:30:00Z',
      is_updated: true,
    }, now)).toBe('30 мин назад');
    expect(pluralizeFeedPublications(1)).toBe('1 публикация');
    expect(pluralizeFeedPublications(3)).toBe('3 публикации');
    expect(pluralizeFeedPublications(12)).toBe('12 публикаций');
    expect(pluralizeFeedUnread(1)).toBe('1 непрочитанная публикация');
    expect(pluralizeFeedUnread(2)).toBe('2 непрочитанные публикации');
    expect(pluralizeFeedUnread(5)).toBe('5 непрочитанных публикаций');
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
