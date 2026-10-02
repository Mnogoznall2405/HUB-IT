import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ChatThreadHeader from './ChatThreadHeader';
import { buildChatUiTokens } from './chatUiTokens';

const theme = createTheme();
const ui = buildChatUiTokens(theme);

const renderHeader = (socketStatus) => (
  <ThemeProvider theme={theme}>
    <ChatThreadHeader
      theme={theme}
      ui={ui}
      isMobile={false}
      compactMobile={false}
      activeConversation={{ id: 'conversation-1', kind: 'direct', title: 'Direct' }}
      socketStatus={socketStatus}
      onOpenDrawer={vi.fn()}
      onOpenInfo={vi.fn()}
      onOpenSearch={vi.fn()}
      onOpenMenu={vi.fn()}
    />
  </ThemeProvider>
);

describe('ChatThreadHeader connection label', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T04:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts the 2s delay from leaving connected, not from each unhealthy status', () => {
    const { rerender } = render(renderHeader('disconnected'));

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText('Соединение…')).not.toBeInTheDocument();

    // disconnected → reconnecting at t=1s: the timer must not restart.
    rerender(renderHeader('reconnecting'));
    act(() => { vi.advanceTimersByTime(999); });
    expect(screen.queryByText('Соединение…')).not.toBeInTheDocument();

    // Label visible at t=2s measured from the first exit from connected.
    act(() => { vi.advanceTimersByTime(1); });
    rerender(renderHeader('disconnected'));
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByText('Соединение…')).toBeInTheDocument();
  });

  it('hides the label immediately when the socket is connected again', () => {
    const { rerender } = render(renderHeader('reconnecting'));
    act(() => { vi.advanceTimersByTime(2500); });
    expect(screen.getByText('Соединение…')).toBeInTheDocument();

    rerender(renderHeader('connected'));
    expect(screen.queryByText('Соединение…')).not.toBeInTheDocument();
  });
});

describe('AiAssistantSelect (Д7)', () => {
  const renderAiHeader = (extra = {}) => render(
    <ThemeProvider theme={theme}>
      <ChatThreadHeader
        theme={theme}
        ui={ui}
        isMobile={false}
        compactMobile={false}
        activeConversation={{ id: 'conv-ai-1', kind: 'ai', title: 'HUB Ассистент' }}
        socketStatus="connected"
        navigate={vi.fn()}
        onOpenDrawer={vi.fn()}
        onOpenInfo={vi.fn()}
        onOpenSearch={vi.fn()}
        onOpenMenu={vi.fn()}
        {...extra}
      />
    </ThemeProvider>,
  );

  it('renders the assistant selector only for AI conversations', () => {
    render(renderHeader('connected'));
    expect(screen.queryByTestId('chat-ai-assistant-select')).not.toBeInTheDocument();

    renderAiHeader();
    expect(screen.getByTestId('chat-ai-assistant-select')).toBeInTheDocument();
  });

  it('opens the assistant menu and offers a new chat action', async () => {
    const { chatAPI } = await import('../../api/client');
    const openConversation = vi.spyOn(chatAPI, 'openAiBotConversation').mockResolvedValue({ id: 'conv-ai-9' });
    const listBots = vi.spyOn(chatAPI, 'listAiBots').mockResolvedValue({ items: [{ id: 'bot-2', title: 'Документы' }] });
    const navigate = vi.fn();
    try {
      renderAiHeader({ navigate });
      fireEvent.click(screen.getByTestId('chat-ai-assistant-select'));
      await screen.findByText('Документы');
      fireEvent.click(screen.getByText('Документы'));
      await vi.waitFor(() => expect(openConversation).toHaveBeenCalledWith('bot-2'));
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith('/chat?conversation=conv-ai-9'));
    } finally {
      openConversation.mockRestore();
      listBots.mockRestore();
    }
  });
});
