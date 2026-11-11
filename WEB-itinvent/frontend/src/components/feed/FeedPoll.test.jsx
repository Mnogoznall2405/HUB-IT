import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import FeedPoll from './FeedPoll';


const basePoll = {
  id: 'poll-1',
  question: 'Как провести встречу?',
  allows_multiple: false,
  is_anonymous: true,
  is_closed: false,
  has_voted: false,
  viewer_option_ids: [],
  total_votes: 0,
  total_voters: 0,
  options: [
    { id: 'online', text: 'Онлайн', votes_count: 0 },
    { id: 'office', text: 'В офисе', votes_count: 0 },
  ],
};

const renderPoll = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <FeedPoll poll={basePoll} {...props} />
  </ThemeProvider>,
);


describe('FeedPoll', () => {
  it('submits one option from a single-choice poll', async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    renderPoll({ onVote });

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать «Онлайн»' }));

    await waitFor(() => expect(onVote).toHaveBeenCalledWith(['online']));
  });

  it('shows vote results and closed state without an active control', () => {
    renderPoll({
      poll: {
        ...basePoll,
        is_closed: true,
        has_voted: true,
        viewer_option_ids: ['online'],
        total_votes: 4,
        total_voters: 4,
        options: [
          { id: 'online', text: 'Онлайн', votes_count: 3 },
          { id: 'office', text: 'В офисе', votes_count: 1 },
        ],
      },
      onVote: vi.fn(),
    });

    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Онлайн/ })).not.toBeInTheDocument();
    expect(screen.getByText('4 голоса')).toBeInTheDocument();
    expect(screen.getByText(/завершён/)).toBeInTheDocument();
  });

  it('calculates multiple-choice percentages from voters instead of selected answers', () => {
    renderPoll({
      poll: {
        ...basePoll,
        allows_multiple: true,
        has_voted: true,
        viewer_option_ids: ['online', 'office'],
        total_votes: 5,
        total_voters: 4,
        options: [
          { id: 'online', text: 'Онлайн', votes_count: 3 },
          { id: 'office', text: 'В офисе', votes_count: 2 },
        ],
      },
    });

    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});
