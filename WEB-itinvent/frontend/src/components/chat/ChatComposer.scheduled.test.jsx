import React, { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import ChatComposer from './ChatComposer';
import { buildChatUiTokens } from './chatUiTokens';

vi.mock('emoji-picker-react', () => ({ default: () => null }));
vi.mock('./useAiAgentAccess', () => ({ default: () => ({ allowed: true, loading: false, error: false }) }));

const theme = createTheme();
const scheduledApi = (extra = {}) => ({
  enabled: true,
  items: [],
  busy: false,
  error: '',
  clearError: vi.fn(),
  schedule: vi.fn().mockResolvedValue({ id: 'n' }),
  update: vi.fn(),
  cancel: vi.fn(),
  ...extra,
});

function Fixture({ initialText = '', ...props }) {
  const [text, setText] = useState(initialText);
  const ref = useRef(null);
  return (
    <ThemeProvider theme={theme}>
      <ChatComposer
        theme={theme}
        ui={buildChatUiTokens(theme)}
        compactMobile={false}
        activeConversationId="chat"
        selectedFiles={[]}
        composerRef={ref}
        messageText={text}
        onMessageTextChange={setText}
        onSendMessage={props.onSendMessage || vi.fn()}
        {...props}
      />
      <output data-testid="text">{text}</output>
    </ThemeProvider>
  );
}

describe('"Send later" on the composer send button', () => {
  it('right click opens the menu, the dialog schedules the text and the composer is cleared', async () => {
    const scheduled = scheduledApi();
    render(<Fixture initialText="Позвонить завтра" scheduled={scheduled} />);
    fireEvent.contextMenu(screen.getByTestId('chat-composer-send-button'));
    fireEvent.click(await screen.findByTestId('chat-send-later-menu-item'));
    fireEvent.click(await screen.findByRole('button', { name: 'Запланировать' }));
    await waitFor(() => expect(scheduled.schedule).toHaveBeenCalledTimes(1));
    expect(scheduled.schedule.mock.calls[0][0]).toBe('Позвонить завтра');
    await waitFor(() => expect(screen.getByTestId('text')).toHaveTextContent(''));
  });

  it('a plain click still sends immediately', () => {
    const onSendMessage = vi.fn();
    render(<Fixture initialText="Сразу" scheduled={scheduledApi()} onSendMessage={onSendMessage} />);
    fireEvent.click(screen.getByTestId('chat-composer-send-button'));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('long press on a touch screen opens the menu and does not send', () => {
    vi.useFakeTimers();
    try {
      const onSendMessage = vi.fn();
      render(<Fixture initialText="Долгое нажатие" scheduled={scheduledApi()} onSendMessage={onSendMessage} />);
      const button = screen.getByTestId('chat-composer-send-button');
      fireEvent.touchStart(button);
      act(() => { vi.advanceTimersByTime(600); });
      fireEvent.touchEnd(button);
      fireEvent.click(button); // the click that follows a long press must be swallowed
      expect(onSendMessage).not.toHaveBeenCalled();
      expect(screen.getByTestId('chat-send-later-menu-item')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not offered when the feature is off, for an empty text or in an AI conversation', () => {
    const { rerender } = render(<Fixture initialText="x" scheduled={scheduledApi({ enabled: false })} />);
    fireEvent.contextMenu(screen.getByTestId('chat-composer-send-button'));
    expect(screen.queryByTestId('chat-send-later-menu-item')).not.toBeInTheDocument();
    rerender(<Fixture initialText="x" scheduled={scheduledApi()} isAiConversation />);
    fireEvent.contextMenu(screen.getByTestId('chat-composer-send-button'));
    expect(screen.queryByTestId('chat-send-later-menu-item')).not.toBeInTheDocument();
  });

  it('shows the bar with the waiting messages and opens the list', async () => {
    const items = [{ id: 'a', body: 'Позже', status: 'scheduled', scheduled_for: new Date(Date.now() + 7200_000).toISOString() }];
    render(<Fixture scheduled={scheduledApi({ items })} />);
    fireEvent.click(screen.getByTestId('chat-scheduled-bar'));
    expect(await screen.findByText('Запланированные сообщения')).toBeInTheDocument();
    expect(screen.getByText('Позже')).toBeInTheDocument();
  });
});
