import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import MailQuickReplyComposer from './MailQuickReplyComposer';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailQuickReplyComposer', () => {
  it('inserts chip text into the draft and does not send', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <MailQuickReplyComposer
        draftKey="msg-1"
        suggestions={['Sounds good', 'Will review']}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-smart-reply-chip-0'));

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('mail-quick-reply-input')).toHaveValue('Sounds good');
  });

  it('lets the user edit chip text before send', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <MailQuickReplyComposer
        draftKey="msg-1"
        suggestions={['Sounds good']}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-smart-reply-chip-0'));
    fireEvent.change(screen.getByTestId('mail-quick-reply-input'), {
      target: { value: 'Sounds good, thanks' },
    });
    fireEvent.click(screen.getByTestId('mail-quick-reply-send'));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Sounds good, thanks');
  });

  it('clears inserted chip text when draftKey changes', () => {
    const { rerender } = renderWithTheme(
      <MailQuickReplyComposer
        draftKey="msg-1"
        suggestions={['Sounds good']}
        onSend={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('mail-smart-reply-chip-0'));
    expect(screen.getByTestId('mail-quick-reply-input')).toHaveValue('Sounds good');

    rerender(
      <ThemeProvider theme={createTheme()}>
        <MailQuickReplyComposer
          draftKey="msg-2"
          suggestions={['Later']}
          onSend={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('mail-quick-reply-input')).toHaveValue('');
  });

  it('starts collapsed and opens the existing editor on click', () => {
    renderWithTheme(
      <MailQuickReplyComposer
        draftKey="msg-1"
        startCollapsed
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mail-quick-reply-collapsed')).toHaveTextContent('Ответить на письмо…');
    expect(screen.queryByTestId('mail-quick-reply-input')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mail-quick-reply-collapsed'));
    expect(screen.getByTestId('mail-quick-reply-input')).toBeTruthy();
    expect(screen.getByPlaceholderText('Ответить на письмо…')).toBeTruthy();
  });

  it('uses a reply-all placeholder when the thread has several participants', () => {
    renderWithTheme(
      <MailQuickReplyComposer
        draftKey="msg-1"
        startCollapsed
        placeholder="Ответить всем…"
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByTestId('mail-quick-reply-collapsed')).toHaveTextContent('Ответить всем…');
    fireEvent.click(screen.getByTestId('mail-quick-reply-collapsed'));
    expect(screen.getByPlaceholderText('Ответить всем…')).toBeTruthy();
  });

  it('hides chips when disabled and still does not send from missing chips', () => {
    const onSend = vi.fn();
    renderWithTheme(
      <MailQuickReplyComposer
        draftKey="msg-1"
        chipsEnabled={false}
        suggestions={['Sounds good']}
        onSend={onSend}
      />,
    );

    expect(screen.queryByTestId('mail-smart-reply-chips')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mail-smart-reply-chip-0')).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not re-render the parent on each keystroke', () => {
    const parentRenders = { count: 0 };
    const onSend = vi.fn();

    function Parent() {
      parentRenders.count += 1;
      const sendRef = useRef(onSend);
      return (
        <MailQuickReplyComposer
          draftKey="msg-1"
          suggestions={['Sounds good']}
          onSend={sendRef.current}
        />
      );
    }

    renderWithTheme(<Parent />);
    const rendersAfterMount = parentRenders.count;

    fireEvent.change(screen.getByTestId('mail-quick-reply-input'), {
      target: { value: 'A' },
    });
    fireEvent.change(screen.getByTestId('mail-quick-reply-input'), {
      target: { value: 'AB' },
    });
    fireEvent.click(screen.getByTestId('mail-smart-reply-chip-0'));

    expect(parentRenders.count).toBe(rendersAfterMount);
    expect(onSend).not.toHaveBeenCalled();
  });
});
