import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hubAnnouncementsAPI } from '../../api/hubAnnouncements';
import FeedReactionsDialog from './FeedReactionsDialog';

const post = {
  id: 'post-1',
  reaction_counts: { like: 1, love: 1 },
  reactions_count: 2,
};

const renderDialog = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <FeedReactionsDialog open post={post} onClose={vi.fn()} {...props} />
  </ThemeProvider>,
);

describe('FeedReactionsDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows who reacted and filters the list by reaction type', async () => {
    const users = [
      { user_id: 1, full_name: 'Анна Иванова', username: 'anna', reaction_type: 'like' },
      { user_id: 2, full_name: 'Борис Петров', username: 'boris', reaction_type: 'love' },
    ];
    const request = vi.spyOn(hubAnnouncementsAPI, 'getReactionUsers')
      .mockImplementation(async (_postId, reactionType) => ({
        items: reactionType ? users.filter((item) => item.reaction_type === reactionType) : users,
      }));

    renderDialog();

    expect(await screen.findByText('Анна Иванова')).toBeInTheDocument();
    expect(screen.getByText('Борис Петров')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('post-1', '');

    fireEvent.click(screen.getByRole('button', { name: 'Любовь: 1' }));

    await waitFor(() => expect(request).toHaveBeenLastCalledWith('post-1', 'love'));
    await waitFor(() => expect(screen.queryByText('Анна Иванова')).not.toBeInTheDocument());
    expect(screen.getByText('Борис Петров')).toBeInTheDocument();
  });

  it('closes with an accessible control', async () => {
    vi.spyOn(hubAnnouncementsAPI, 'getReactionUsers').mockResolvedValue({ items: [] });
    const onClose = vi.fn();
    renderDialog({ onClose });

    await screen.findByText('Реакций пока нет.');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть список реакций' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
