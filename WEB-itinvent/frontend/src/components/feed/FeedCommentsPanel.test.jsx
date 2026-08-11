import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FeedCommentsPanel from './FeedCommentsPanel';
import { hubAnnouncementsAPI } from '../../api/hubAnnouncements';

vi.mock('../../api/hubAnnouncements', () => ({
  hubAnnouncementsAPI: {
    getComments: vi.fn(),
    createComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
  },
}));

const post = { id: 'post-1', title: 'Новости компании', comments_count: 0 };

const renderPanel = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <FeedCommentsPanel
      post={post}
      user={{ full_name: 'Иван Петров' }}
      composerInputRef={createRef()}
      {...props}
    />
  </ThemeProvider>,
);

describe('FeedCommentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hubAnnouncementsAPI.getComments.mockResolvedValue({ items: [], total: 0 });
  });

  it('renders comments inline without opening a dialog', async () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Комментарии' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Комментариев пока нет')).toBeInTheDocument();
  });

  it('posts a reply from the inline composer and updates the count', async () => {
    const onCountChange = vi.fn();
    hubAnnouncementsAPI.createComment.mockResolvedValue({
      id: 'comment-1',
      body: 'Отличная новость',
      full_name: 'Иван Петров',
      created_at: '2026-08-06T10:00:00Z',
    });
    renderPanel({ onCountChange });

    await screen.findByText('Комментариев пока нет');
    fireEvent.change(screen.getByLabelText('Написать комментарий'), { target: { value: 'Отличная новость' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить комментарий' }));

    await waitFor(() => expect(hubAnnouncementsAPI.createComment).toHaveBeenCalledWith('post-1', {
      body: 'Отличная новость',
      files: [],
      mentionedUserIds: [],
      parentCommentId: '',
    }));
    expect(await screen.findByText('Отличная новость')).toBeInTheDocument();
    expect(onCountChange).toHaveBeenLastCalledWith('post-1', 1);
  });

  it('does not reload replies when only the post counters change', async () => {
    const onCountChange = vi.fn();
    const composerInputRef = createRef();
    const { rerender } = renderPanel({ onCountChange, composerInputRef });

    await screen.findByText('Комментариев пока нет');
    rerender(
      <ThemeProvider theme={createTheme()}>
        <FeedCommentsPanel
          post={{ ...post, comments_count: 1 }}
          user={{ full_name: 'Иван Петров' }}
          composerInputRef={composerInputRef}
          onCountChange={onCountChange}
        />
      </ThemeProvider>,
    );

    expect(hubAnnouncementsAPI.getComments).toHaveBeenCalledTimes(1);
  });

  it('focuses the stable reply composer without scrolling the discussion', async () => {
    hubAnnouncementsAPI.getComments.mockResolvedValue({
      items: [{
        id: 'root-1', body: 'Основной комментарий', username: 'sergey', full_name: 'Сергей',
        created_at: '2026-08-06T10:00:00Z', updated_at: '2026-08-06T10:00:00Z', reply_count: 0,
      }],
      total: 1,
      comments_total: 1,
    });
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    renderPanel();

    await screen.findByText('Основной комментарий');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить' }));

    expect(screen.getByText('Ответ для Сергей')).toBeVisible();
    await waitFor(() => expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true }));
    focusSpy.mockRestore();
  });
});
