import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatMessageContextMenu from './ChatMessageContextMenu';

vi.mock('../../api/client', () => ({
  chatAPI: {
    getMessageReads: vi.fn().mockResolvedValue({ items: [] }),
  },
}));

const theme = createTheme();
const ui = {
  drawerBg: '#17212b',
  surfaceMuted: '#232e3c',
  textStrong: '#f5f7fa',
  textSecondary: 'rgba(255,255,255,0.56)',
  borderSoft: 'rgba(255,255,255,0.08)',
  shadowStrong: '0 16px 48px rgba(0, 0, 0, 0.44)',
};

function renderMenu(overrides = {}) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  return render(
    <ThemeProvider theme={theme}>
      <ChatMessageContextMenu
        theme={theme}
        ui={ui}
        open
        onClose={vi.fn()}
        anchorEl={anchor}
        message={{ id: 'msg-1', kind: 'text', body: 'hello', is_own: true }}
        activeConversation={{ id: 'conv-1', kind: 'direct' }}
        onToggleReactionFromMenu={vi.fn()}
        onReplyFromMessageMenu={vi.fn()}
        onCopyMessage={vi.fn()}
        onSelectMessageFromMenu={vi.fn()}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

const pollMessage = (poll, extra = {}) => ({
  id: 'poll-1',
  kind: 'poll',
  is_own: true,
  body: JSON.stringify({ question: 'Куда?', options: ['Да', 'Нет'] }),
  poll: {
    question: 'Куда?',
    options: [{ text: 'Да', votes: 1 }, { text: 'Нет', votes: 0 }],
    total_voters: 1,
    closed: false,
    my_option_index: null,
    ...poll,
  },
  ...extra,
});

describe('ChatMessageContextMenu poll actions (R50)', () => {
  it('offers «Остановить опрос» to the author of an open poll and asks for confirmation', () => {
    const onStopPollFromMessageMenu = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const first = renderMenu({ message: pollMessage({}), onStopPollFromMessageMenu });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Остановить опрос' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(onStopPollFromMessageMenu).not.toHaveBeenCalled(); // declined

    first.unmount();
    renderMenu({ message: pollMessage({}), onStopPollFromMessageMenu });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Остановить опрос' }));
    expect(onStopPollFromMessageMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'poll-1' }));
    confirm.mockRestore();
  });

  it('hides «Остановить опрос» for a poll of somebody else and for a closed poll', () => {
    const handler = vi.fn();
    const first = renderMenu({ message: pollMessage({}, { is_own: false }), onStopPollFromMessageMenu: handler });
    expect(screen.queryByRole('menuitem', { name: 'Остановить опрос' })).not.toBeInTheDocument();
    first.unmount();
    renderMenu({ message: pollMessage({ closed: true }), onStopPollFromMessageMenu: handler });
    expect(screen.queryByRole('menuitem', { name: 'Остановить опрос' })).not.toBeInTheDocument();
  });

  it('offers «Отменить голос» only after voting in an open poll and re-sends the same option', () => {
    const onCancelPollVoteFromMessageMenu = vi.fn();
    const notVoted = renderMenu({
      message: pollMessage({ my_option_index: null }, { is_own: false }),
      onCancelPollVoteFromMessageMenu,
    });
    expect(screen.queryByRole('menuitem', { name: 'Отменить голос' })).not.toBeInTheDocument();
    notVoted.unmount();
    const closed = renderMenu({
      message: pollMessage({ closed: true, my_option_index: 1 }, { is_own: false }),
      onCancelPollVoteFromMessageMenu,
    });
    expect(screen.queryByRole('menuitem', { name: 'Отменить голос' })).not.toBeInTheDocument();
    closed.unmount();

    renderMenu({ message: pollMessage({ my_option_index: 1 }, { is_own: false }), onCancelPollVoteFromMessageMenu });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отменить голос' }));
    expect(onCancelPollVoteFromMessageMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'poll-1' }), 1);
  });

  it('does not show poll actions for ordinary messages', () => {
    renderMenu({ onStopPollFromMessageMenu: vi.fn(), onCancelPollVoteFromMessageMenu: vi.fn() });
    expect(screen.queryByRole('menuitem', { name: 'Остановить опрос' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Отменить голос' })).not.toBeInTheDocument();
  });
});
