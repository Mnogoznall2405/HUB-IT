import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { ChatPollCard, formatPollVotes } from './ChatStructuredCards';

const theme = createTheme();
const ui = {
  textSecondary: '#7f91a4',
  accentText: '#64b5ef',
  bubbleOwnBg: '#2b5278',
  bubbleOwnText: '#ffffff',
  bubbleOtherBg: '#182533',
  bubbleOtherText: '#f5f7fa',
};

const card = (props) => (
  <ThemeProvider theme={theme}>
    <ChatPollCard ui={ui} theme={theme} isOwn={false} {...props} />
  </ThemeProvider>
);
const renderCard = (props) => render(card(props));

const poll = (extra = {}) => ({
  question: 'Куда идём на обед?',
  anonymous: false,
  closed: false,
  my_option_index: null,
  total_voters: 4,
  options: [{ text: 'Столовая', votes: 3 }, { text: 'Кафе', votes: 1 }, { text: 'Дома', votes: 0 }],
  ...extra,
});

describe('formatPollVotes', () => {
  it.each([
    [0, 'Нет голосов'],
    [1, '1 голос'],
    [2, '2 голоса'],
    [4, '4 голоса'],
    [5, '5 голосов'],
    [11, '11 голосов'],
    [21, '21 голос'],
    [112, '112 голосов'],
  ])('%s -> %s', (count, label) => {
    expect(formatPollVotes(count)).toBe(label);
  });
});

describe('ChatPollCard (R50)', () => {
  it('before voting shows plain rows without percentages and votes at once on click', async () => {
    const onVote = vi.fn().mockResolvedValue(undefined);
    renderCard({ poll: poll(), onVote });

    expect(screen.getByTestId('chat-poll-card')).toHaveAttribute('data-poll-mode', 'vote');
    expect(screen.getByText('Куда идём на обед?')).toBeInTheDocument();
    expect(screen.getByTestId('chat-poll-type')).toHaveTextContent('Публичный опрос');
    expect(screen.queryByTestId('chat-poll-percent')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('chat-poll-option')).toHaveLength(3);
    expect(screen.getByTestId('chat-poll-total')).toHaveTextContent('4 голоса');

    fireEvent.click(screen.getByRole('button', { name: 'Вариант Кафе' }));
    await waitFor(() => expect(onVote).toHaveBeenCalledWith(1));
  });

  it('marks an anonymous poll', () => {
    renderCard({ poll: poll({ anonymous: true }), onVote: vi.fn() });
    expect(screen.getByTestId('chat-poll-type')).toHaveTextContent('Анонимный опрос');
  });

  it('after voting switches to results: percent column, bars, tick on my option, no circles', async () => {
    renderCard({ poll: poll({ my_option_index: 0 }), onVote: vi.fn() });

    expect(screen.getByTestId('chat-poll-card')).toHaveAttribute('data-poll-mode', 'results');
    expect(screen.queryByTestId('chat-poll-option')).not.toBeInTheDocument();
    const rows = screen.getAllByTestId('chat-poll-result');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByTestId('chat-poll-percent')).toHaveTextContent('75%');
    expect(within(rows[1]).getByTestId('chat-poll-percent')).toHaveTextContent('25%');
    expect(within(rows[2]).getByTestId('chat-poll-percent')).toHaveTextContent('0%');
    // the tick is only on the chosen option
    expect(within(rows[0]).getByTestId('chat-poll-mine')).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId('chat-poll-mine')).not.toBeInTheDocument();
    // rows are not clickable in results mode
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // bar width = share, 0% is a dot
    expect(within(rows[0]).getByTestId('chat-poll-bar')).toHaveStyle({ width: '75%' });
    expect(within(rows[1]).getByTestId('chat-poll-bar')).toHaveStyle({ width: '25%' });
    expect(within(rows[2]).getByTestId('chat-poll-bar')).toHaveStyle({ width: '4px' });
  });

  it('animates the bars from 0 when the poll moves into results mode', async () => {
    const { rerender } = renderCard({ poll: poll(), onVote: vi.fn() });
    rerender(card({ poll: poll({ my_option_index: 1 }), onVote: vi.fn() }));
    // the first frame after the switch: bars start at zero width...
    expect(screen.getAllByTestId('chat-poll-bar')[0]).toHaveStyle({ width: '0px' });
    // ...then grow to their share
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve())); });
    expect(screen.getAllByTestId('chat-poll-bar')[0]).toHaveStyle({ width: '75%' });
  });

  it('a closed poll shows the results with the «Итоги» line and cannot be voted in', () => {
    const onVote = vi.fn();
    renderCard({ poll: poll({ closed: true }), onVote });
    expect(screen.getByTestId('chat-poll-card')).toHaveAttribute('data-poll-mode', 'results');
    expect(screen.getByTestId('chat-poll-type')).toHaveTextContent('Итоги');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onVote).not.toHaveBeenCalled();
  });

  it('shows «Нет голосов» for a poll without votes and keeps the card at least ~280px wide', () => {
    renderCard({
      poll: poll({ total_voters: 0, options: [{ text: 'А', votes: 0 }, { text: 'Б', votes: 0 }] }),
      onVote: vi.fn(),
    });
    expect(screen.getByTestId('chat-poll-total')).toHaveTextContent('Нет голосов');
    expect(getComputedStyle(screen.getByTestId('chat-poll-card')).minWidth).toBe('min(280px, 66vw)');
  });

  it('has no «Завершить опрос» / «Отменить голос» buttons in the card', () => {
    renderCard({ poll: poll({ my_option_index: 0 }), onVote: vi.fn() });
    expect(screen.queryByText('Завершить опрос')).not.toBeInTheDocument();
    expect(screen.queryByText('Остановить опрос')).not.toBeInTheDocument();
    expect(screen.queryByText('Отменить голос')).not.toBeInTheDocument();
  });

  it('uses the light accent on the own (blue) side', () => {
    renderCard({ poll: poll({ my_option_index: 0 }), isOwn: true, onVote: vi.fn() });
    expect(getComputedStyle(screen.getAllByTestId('chat-poll-percent')[0]).color).toBe('rgb(255, 255, 255)');
  });
});
