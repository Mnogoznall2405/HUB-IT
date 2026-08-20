import React, { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailQuickReplyDraftField from './MailQuickReplyDraftField';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailQuickReplyDraftField', () => {
  it('does not call parent onSend while typing', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <MailQuickReplyDraftField
        variant="desktop"
        draftKey="msg-1"
        draftEpoch={0}
        onSend={onSend}
      />,
    );

    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'При' },
    });
    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'Привет' },
    });

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('mail-quick-reply-body')).toHaveValue('Привет');
  });

  it('calls onSend once with typed text on Send', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <MailQuickReplyDraftField
        variant="desktop"
        draftKey="msg-1"
        draftEpoch={0}
        onSend={onSend}
      />,
    );

    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'Привет' },
    });
    fireEvent.click(screen.getByTestId('mail-quick-reply-send'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Привет');
    expect(screen.getByTestId('mail-quick-reply-body')).toHaveValue('Привет');
  });

  it('does not clear draft on Send alone until draftEpoch changes', () => {
    const onSend = vi.fn();
    const { rerender } = renderWithTheme(
      <MailQuickReplyDraftField
        variant="desktop"
        draftKey="msg-1"
        draftEpoch={0}
        onSend={onSend}
      />,
    );

    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'Keep me' },
    });
    fireEvent.click(screen.getByTestId('mail-quick-reply-send'));
    expect(screen.getByTestId('mail-quick-reply-body')).toHaveValue('Keep me');

    rerender(
      <ThemeProvider theme={createTheme()}>
        <MailQuickReplyDraftField
          variant="desktop"
          draftKey="msg-1"
          draftEpoch={1}
          onSend={onSend}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('mail-quick-reply-body')).toHaveValue('');
  });

  it('clears draft when draftKey changes', () => {
    const { rerender } = renderWithTheme(
      <MailQuickReplyDraftField
        variant="desktop"
        draftKey="msg-1"
        draftEpoch={0}
        onSend={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'Old draft' },
    });

    rerender(
      <ThemeProvider theme={createTheme()}>
        <MailQuickReplyDraftField
          variant="desktop"
          draftKey="msg-2"
          draftEpoch={0}
          onSend={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('mail-quick-reply-body')).toHaveValue('');
  });

  it('keeps Enter / Shift+Enter as newline without sending', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <MailQuickReplyDraftField
        variant="desktop"
        draftKey="msg-1"
        draftEpoch={0}
        onSend={onSend}
      />,
    );

    const input = screen.getByTestId('mail-quick-reply-body');
    fireEvent.change(input, { target: { value: 'line1' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not re-render parent on each keystroke', () => {
    const parentRenders = { count: 0 };
    const onSend = vi.fn();

    function Parent() {
      parentRenders.count += 1;
      const sendRef = useRef(onSend);
      return (
        <MailQuickReplyDraftField
          variant="desktop"
          draftKey="msg-1"
          draftEpoch={0}
          onSend={sendRef.current}
        />
      );
    }

    renderWithTheme(<Parent />);
    const rendersAfterMount = parentRenders.count;

    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'A' },
    });
    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'AB' },
    });
    fireEvent.change(screen.getByTestId('mail-quick-reply-body'), {
      target: { value: 'ABC' },
    });

    expect(parentRenders.count).toBe(rendersAfterMount);
  });

  it('bar variant sends typed body without lifting onChange', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <MailQuickReplyDraftField
        variant="bar"
        draftKey="msg-1"
        draftEpoch={0}
        tokens={{ textSecondary: '#666', textPrimary: '#111' }}
        onSend={onSend}
      />,
    );

    fireEvent.change(screen.getByTestId('mail-quick-reply-input'), {
      target: { value: 'Mobile hi' },
    });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('mail-quick-reply-send'));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Mobile hi');
  });
});
