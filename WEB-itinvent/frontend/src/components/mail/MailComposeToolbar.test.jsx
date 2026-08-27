import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailComposeToolbar from './MailComposeToolbar';

const buildEditor = (formats = {}) => ({
  focus: vi.fn(),
  format: vi.fn(),
  removeFormat: vi.fn(),
  getSelection: vi.fn(() => ({ index: 2, length: 3 })),
  getLength: vi.fn(() => 6),
  getFormat: vi.fn(() => formats),
  on: vi.fn(),
  off: vi.fn(),
  history: { undo: vi.fn(), redo: vi.fn() },
});

describe('MailComposeToolbar', () => {
  it('exposes accessible pressed state and invokes editor formatting and history commands', async () => {
    const editor = buildEditor({ bold: true });
    const editorRef = { current: { getEditor: () => editor } };
    render(<MailComposeToolbar editorRef={editorRef} />);

    const bold = await screen.findByRole('button', { name: 'Жирный' });
    expect(bold).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(bold);
    expect(editor.format).toHaveBeenCalledWith('bold', false, 'user');

    const undo = screen.getByRole('button', { name: 'Отменить' });
    expect(undo).not.toHaveAttribute('aria-pressed');
    fireEvent.keyDown(undo, { key: 'Enter' });
    fireEvent.click(undo);
    expect(editor.history.undo).toHaveBeenCalledTimes(1);
  });

  it('keeps secondary alignment and indentation commands in the mobile menu', async () => {
    const editor = buildEditor();
    const editorRef = { current: { getEditor: () => editor } };
    render(<MailComposeToolbar editorRef={editorRef} mobile />);

    fireEvent.click(screen.getByRole('button', { name: 'Ещё команды' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'По центру' }));
    await waitFor(() => expect(editor.format).toHaveBeenCalledWith('align', 'center', 'user'));

    fireEvent.click(screen.getByRole('button', { name: 'Ещё команды' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Уменьшить отступ' }));
    expect(editor.format).toHaveBeenCalledWith('indent', '-1', 'user');
  });

  it('keeps default select values visible in the dark theme', () => {
    const editor = buildEditor();
    const editorRef = { current: { getEditor: () => editor } };
    const darkTheme = createTheme({ palette: { mode: 'dark' } });
    render(
      <ThemeProvider theme={darkTheme}>
        <MailComposeToolbar editorRef={editorRef} />
      </ThemeProvider>,
    );

    const [paragraphStyle, textSize, alignment] = screen.getAllByRole('combobox');
    expect(paragraphStyle).toHaveTextContent('\u0410\u0431\u0437\u0430\u0446: \u043e\u0431\u044b\u0447\u043d\u044b\u0439');
    expect(textSize).toHaveTextContent('\u0420\u0430\u0437\u043c\u0435\u0440: \u0441\u0440\u0435\u0434\u043d\u0438\u0439');
    expect(alignment.querySelector('svg')).toBeTruthy();
  });
});
