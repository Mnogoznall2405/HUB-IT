import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import ChatSelectionActionDock from './ChatSelectionActionDock';
import { buildChatUiTokens } from './chatUiTokens';

const renderDock = (props = {}, { mode = 'light' } = {}) => {
  const theme = createTheme({ palette: { mode } });
  const ui = buildChatUiTokens(theme, { compactMobile: Boolean(props.compactMobile) });
  return render(
    <ThemeProvider theme={theme}>
      <ChatSelectionActionDock theme={theme} ui={ui} selectedMessageCount={1} {...props} />
    </ThemeProvider>,
  );
};

describe('ChatSelectionActionDock (R45)', () => {
  it('desktop: flat strip with count, clear, reply (single selection), forward and delete', () => {
    const handlers = {
      onClearMessageSelection: vi.fn(),
      onReplySelectedMessage: vi.fn(),
      onForwardSelectedMessages: vi.fn(),
      onDeleteSelectedMessages: vi.fn(),
    };
    renderDock({ compactMobile: false, canReplySelectedMessage: true, canDeleteSelectedMessages: true, ...handlers });

    expect(screen.getByTestId('chat-selection-count-label')).toHaveTextContent('1 сообщение');
    fireEvent.click(screen.getByTestId('chat-selection-clear'));
    fireEvent.click(screen.getByTestId('chat-selection-reply-action'));
    fireEvent.click(screen.getByTestId('chat-selection-forward-action'));
    fireEvent.click(screen.getByTestId('chat-selection-delete-action'));
    Object.values(handlers).forEach((handler) => expect(handler).toHaveBeenCalledTimes(1));
  });

  it('desktop: strip has the height of the composer strip and no floating plate', () => {
    renderDock({ compactMobile: false });
    const strip = screen.getByTestId('chat-selection-strip');
    const stripStyle = getComputedStyle(strip);
    expect([44, 48]).toContain(parseFloat(stripStyle.height));
    const dockStyle = getComputedStyle(screen.getByTestId('chat-selection-action-dock'));
    expect(dockStyle.borderTopLeftRadius).not.toMatch(/[1-9]/);
    expect(stripStyle.borderTopWidth).not.toMatch(/[1-9]/);
    expect(stripStyle.boxShadow).toMatch(/none|^$/);
  });

  it('desktop: reply is offered only for a single selected message that can be replied to', () => {
    const { unmount } = renderDock({ compactMobile: false, canReplySelectedMessage: true, onReplySelectedMessage: vi.fn(), selectedMessageCount: 2 });
    expect(screen.queryByTestId('chat-selection-reply-action')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-selection-count-label')).toHaveTextContent('2 сообщения');
    unmount();
    renderDock({ compactMobile: false, canReplySelectedMessage: false, onReplySelectedMessage: vi.fn() });
    expect(screen.queryByTestId('chat-selection-reply-action')).not.toBeInTheDocument();
  });

  it('desktop: delete is disabled without permission', () => {
    renderDock({ compactMobile: false, canDeleteSelectedMessages: false, onDeleteSelectedMessages: vi.fn() });
    expect(screen.getByTestId('chat-selection-delete-action')).toBeDisabled();
  });

  it('mobile: flat strip with labelled reply/forward, count and delete live in the header', () => {
    const onReply = vi.fn();
    const onForward = vi.fn();
    renderDock({
      compactMobile: true,
      canReplySelectedMessage: true,
      onReplySelectedMessage: onReply,
      onForwardSelectedMessages: onForward,
    }, { mode: 'dark' });

    expect(parseFloat(getComputedStyle(screen.getByTestId('chat-selection-strip')).height)).toBe(46);
    expect(screen.queryByTestId('chat-selection-count-label')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-selection-delete-action')).not.toBeInTheDocument();
    expect(screen.getByTestId('chat-selection-reply-action')).toHaveTextContent('Ответить');
    expect(screen.getByTestId('chat-selection-forward-action')).toHaveTextContent('Переслать');
    expect(getComputedStyle(screen.getByText('Переслать')).fontSize).toBe('14px');
    fireEvent.click(screen.getByTestId('chat-selection-reply-action'));
    fireEvent.click(screen.getByTestId('chat-selection-forward-action'));
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
  });

  it('mobile: reply is disabled for several messages', () => {
    renderDock({ compactMobile: true, canReplySelectedMessage: true, selectedMessageCount: 2, onReplySelectedMessage: vi.fn(), onForwardSelectedMessages: vi.fn() });
    expect(screen.getByTestId('chat-selection-reply-action')).toBeDisabled();
    expect(screen.getByTestId('chat-selection-forward-action')).not.toBeDisabled();
  });
});
