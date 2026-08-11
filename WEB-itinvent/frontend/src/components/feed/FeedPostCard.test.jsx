import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import FeedPostCard from './FeedPostCard';

const post = {
  id: 'post-1',
  title: 'Новости компании',
  preview: 'Короткое описание',
  body: 'Полный текст публикации с подробностями.',
  author_full_name: 'Иван Петров',
  published_at: '2026-08-06T10:00:00Z',
  likes_count: 0,
  comments_count: 0,
};

const renderCard = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <FeedPostCard post={post} {...props} />
  </ThemeProvider>,
);

describe('FeedPostCard', () => {
  it('keeps the full text collapsed until the user expands the post', () => {
    const onExpanded = vi.fn();
    renderCard({ onExpanded });

    expect(screen.getByText('Короткое описание')).toBeInTheDocument();
    expect(screen.queryByText('Полный текст публикации с подробностями.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать ещё' }));

    expect(screen.getByText('Полный текст публикации с подробностями.')).toBeInTheDocument();
    expect(onExpanded).toHaveBeenCalledWith(post);
  });

  it('exposes like, comment and share actions with accessible names', () => {
    const onLike = vi.fn();
    const onComments = vi.fn();
    const onShare = vi.fn();
    const onOpen = vi.fn();
    renderCard({ onLike, onComments, onShare, onOpen });

    fireEvent.click(screen.getByRole('button', { name: 'Поставить отметку «Нравится»' }));
    fireEvent.click(screen.getByRole('button', { name: 'Открыть комментарии' }));
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться публикацией' }));

    expect(onLike).toHaveBeenCalledWith(post);
    expect(onComments).toHaveBeenCalledWith(post);
    expect(onShare).toHaveBeenCalledWith(post);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the post from its content and shows the full body in detail view', () => {
    const onOpen = vi.fn();
    const { rerender } = renderCard({ onOpen });

    expect(screen.getByRole('button', { name: 'Новости компании' })).toHaveAttribute('data-feed-post-open', 'post-1');
    fireEvent.click(screen.getByText('Короткое описание'));
    expect(onOpen).toHaveBeenCalledWith(post);

    rerender(
      <ThemeProvider theme={createTheme()}>
        <FeedPostCard post={post} detailView />
      </ThemeProvider>,
    );

    expect(screen.getByText('Полный текст публикации с подробностями.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument();
  });

  it('removes a broken cover instead of leaving a large empty media frame', () => {
    renderCard({ coverUrl: '/missing-cover.jpg' });

    const cover = screen.getByRole('img', { name: /Иллюстрация к публикации/i });
    fireEvent.error(cover);

    expect(screen.queryByRole('img', { name: /Иллюстрация к публикации/i })).not.toBeInTheDocument();
  });

  it('shows image attachments as a navigable gallery', () => {
    const galleryPost = {
      ...post,
      cover_attachment: { id: 'image-1', file_name: 'one.jpg', file_mime: 'image/jpeg' },
      attachments: [
        { id: 'image-1', file_name: 'one.jpg', file_mime: 'image/jpeg' },
        { id: 'image-2', file_name: 'two.png', file_mime: 'image/png' },
        { id: 'document-1', file_name: 'memo.pdf', file_mime: 'application/pdf' },
      ],
    };

    renderCard({
      post: galleryPost,
      coverUrl: '/attachments/image-1',
      buildAttachmentUrl: (_postId, attachmentId) => `/attachments/${attachmentId}`,
    });

    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Иллюстрация 1 из 2/i })).toHaveAttribute('src', '/attachments/image-1');

    fireEvent.click(screen.getByRole('button', { name: 'Следующее изображение' }));

    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Иллюстрация 2 из 2/i })).toHaveAttribute('src', '/attachments/image-2');
  });

  it('uses compact reaction chips for reacting and keeps the people list available', () => {
    const onReaction = vi.fn();
    const onOpenReactions = vi.fn();
    const reactedPost = {
      ...post,
      reactions_count: 13,
      reaction_counts: { like: 2, love: 3, laugh: 4, wow: 1, sad: 2, angry: 1 },
      viewer_reaction: 'like',
    };

    renderCard({
      post: reactedPost,
      onReaction,
      onOpenReactions,
    });

    const selectedLike = screen.getByRole('button', { name: 'Снять реакцию «Нравится». Сейчас: 2' });
    const love = screen.getByRole('button', { name: 'Поставить реакцию «Любовь». Сейчас: 3' });
    expect(selectedLike).toHaveAttribute('aria-pressed', 'true');
    expect(love).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Показать ещё 3 вида реакций' })).toHaveTextContent('+3');
    expect(screen.getByRole('button', { name: 'Показать ещё 1 вид реакций' })).toHaveTextContent('+1');

    fireEvent.click(love);
    expect(onReaction).toHaveBeenCalledWith(reactedPost, 'love');

    fireEvent.click(selectedLike);
    expect(onReaction).toHaveBeenCalledWith(reactedPost, null);

    fireEvent.click(screen.getByRole('button', { name: 'Показать всех отреагировавших сотрудников' }));
    expect(onOpenReactions).toHaveBeenCalledWith(reactedPost, '');

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать другую реакцию' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Возмущение/ }));
    expect(onReaction).toHaveBeenCalledWith(reactedPost, 'angry');
  });
});
