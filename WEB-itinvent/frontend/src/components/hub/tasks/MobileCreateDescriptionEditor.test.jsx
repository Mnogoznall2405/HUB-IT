import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';

import MobileCreateDescriptionEditor from './MobileCreateDescriptionEditor';
import { buildOfficeUiTokens } from '../../../theme/officeUiTokens';

const theme = createTheme();
const ui = buildOfficeUiTokens(theme);

describe('MobileCreateDescriptionEditor', () => {
  it('renders mobile description editor', () => {
    render(
      <ThemeProvider theme={theme}>
        <MobileCreateDescriptionEditor
          initialValue="Описание задачи"
          onDraftChange={() => {}}
          onDone={() => {}}
          ui={ui}
          theme={theme}
        />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('create-description-mobile-input')).toBeInTheDocument();
  });
});

const UI_STUB = { text: '#111111', mutedText: '#777777', borderSoft: '#cccccc' };
const THEME_STUB = { palette: { primary: { main: '#1976d2', dark: '#0f5daf' } } };

const stubExecCommand = () => {
  const spy = vi.fn();
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: spy });
  return spy;
};

const pasteClipboard = (editor, { html, plainText }) => {
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type) => (type === 'text/html' ? html : plainText),
    },
  });
};

describe('MobileCreateDescriptionEditor — paste safety (FE-0064)', () => {
  it('inserts sanitized HTML on paste: dangerous attributes/elements removed, text and formatting preserved', () => {
    const execCommandSpy = stubExecCommand();
    const onDraftChange = vi.fn();
    render(
      <MobileCreateDescriptionEditor
        ui={UI_STUB}
        theme={THEME_STUB}
        initialValue="Начало"
        onDraftChange={onDraftChange}
      />,
    );
    const editor = screen.getByTestId('create-description-mobile-input');

    pasteClipboard(editor, {
      html: '<p onclick="alert(1)">Привет <strong>мир</strong><img src="x" onerror="alert(2)"> <script>alert(3)</script> после</p>',
      plainText: '',
    });

    expect(execCommandSpy).toHaveBeenCalledTimes(1);
    const [command, , insertedHtml] = execCommandSpy.mock.calls[0];
    expect(command).toBe('insertHTML');
    expect(insertedHtml).toContain('Привет');
    expect(insertedHtml).toContain('после');
    expect(insertedHtml).toContain('<strong>мир</strong>');
    expect(insertedHtml).not.toMatch(/onclick|onerror/);
    expect(insertedHtml).not.toContain('<script');
    expect(insertedHtml).not.toContain('<img');
    expect(onDraftChange).toHaveBeenCalled();
  });

  it('keeps allowed links: https and relative hrefs survive, javascript:/data: are dropped', () => {
    const execCommandSpy = stubExecCommand();
    render(
      <MobileCreateDescriptionEditor
        ui={UI_STUB}
        theme={THEME_STUB}
        initialValue=""
      />,
    );
    const editor = screen.getByTestId('create-description-mobile-input');
    pasteClipboard(editor, {
      html: '<div><a href="https://example.com">https ссылка</a><a href="/db?q=1">rel ссылка</a>'
        + '<a href="javascript:alert(1)">bad</a><a href="data:text/html,x">bad2</a></div>',
      plainText: '',
    });
    expect(execCommandSpy).toHaveBeenCalledTimes(1);
    const insertedHtml = execCommandSpy.mock.calls[0][2];
    expect(insertedHtml).toContain('href="https://example.com"');
    expect(insertedHtml).toContain('href="/db?q=1"');
    expect(insertedHtml).not.toContain('javascript:');
    expect(insertedHtml).not.toContain('data:');
  });

  it('leaves plain-text paste to the browser (no execCommand, no preventDefault)', () => {
    const execCommandSpy = stubExecCommand();
    render(<MobileCreateDescriptionEditor ui={UI_STUB} theme={THEME_STUB} initialValue="" />);
    const editor = screen.getByTestId('create-description-mobile-input');
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { getData: (type) => (type === 'text/plain' ? 'простой текст' : '') },
    });
    editor.dispatchEvent(pasteEvent);
    expect(pasteEvent.defaultPrevented).toBe(false);
    expect(execCommandSpy).not.toHaveBeenCalled();
  });
});
