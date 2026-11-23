import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CodeMirrorTextViewer from './CodeMirrorTextViewer';

const renderViewer = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <CodeMirrorTextViewer
      value={'line one\nline two\nline three'}
      fileName="notes.txt"
      language=""
      {...props}
    />
  </ThemeProvider>,
);

describe('CodeMirrorTextViewer', () => {
  it('renders content in a read-only editor with line numbers', async () => {
    renderViewer();
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    expect(document.querySelector('.cm-content').textContent).toContain('line two');
    expect(document.querySelector('.cm-gutters')).toBeTruthy();
    const content = document.querySelector('.cm-content');
    expect(content.getAttribute('contenteditable')).not.toBe('true');
  });

  it('shows search/goto controls and status bar info', async () => {
    renderViewer({ fileName: 'app.log', encoding: 'UTF-8' });
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    expect(screen.getByLabelText('Поиск по файлу')).toBeTruthy();
    expect(screen.getByLabelText('Перенос строк')).toBeTruthy();
    expect(screen.getByLabelText('Копировать весь текст')).toBeTruthy();
    expect(screen.getByText('Только чтение')).toBeTruthy();
    expect(screen.getByText('3 строк')).toBeTruthy();
    expect(screen.getByText('UTF-8')).toBeTruthy();
  });

  it('keeps malformed JSON in text mode with a warning', async () => {
    renderViewer({
      value: '{"a": 1, broken',
      fileName: 'bad.json',
      language: 'json',
    });
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    expect(screen.getByText(/JSON повреждён/)).toBeTruthy();
    expect(document.querySelector('.cm-content').textContent).toContain('broken');
  });

  it('offers a text/tree toggle for valid JSON', async () => {
    renderViewer({
      value: '{"a": [1, 2, 3]}',
      fileName: 'ok.json',
      language: 'json',
    });
    await waitFor(() => expect(document.querySelector('.cm-content')).toBeTruthy());
    expect(screen.getByText('Текст')).toBeTruthy();
    expect(screen.getByText('Дерево')).toBeTruthy();
  });
});
