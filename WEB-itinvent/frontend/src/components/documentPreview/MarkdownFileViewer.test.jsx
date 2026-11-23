import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import MarkdownFileViewer from './MarkdownFileViewer';

// Source mode pulls the whole CodeMirror stack into jsdom; preview mode
// (the default) does not need it for these behaviour checks.
vi.mock('./CodeMirrorTextViewer', () => ({
  default: () => null,
  useCopyText: () => ({ copied: false, copy: vi.fn() }),
  usePreviewFullscreen: () => ({ fullscreen: false, setFullscreen: vi.fn(), containerSx: {} }),
}));

const renderViewer = (value) => render(
  <ThemeProvider theme={createTheme()}>
    <MarkdownFileViewer value={value} fileName="doc.md" />
  </ThemeProvider>,
);

describe('MarkdownFileViewer', () => {
  it('renders GFM structures: headings with ids, table, task list, code', () => {
    renderViewer([
      '# Заголовок Один',
      '',
      '- [x] сделано',
      '- [ ] нет',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '```js',
      'const a = 1;',
      '```',
      '',
      '~~зачёркнуто~~',
    ].join('\n'));

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.textContent).toBe('Заголовок Один');
    expect(heading.id).toBe('заголовок-один');

    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect(checkboxes[0].checked).toBe(true);
    expect(checkboxes[1].checked).toBe(false);
    expect(checkboxes[0].disabled).toBe(true);

    expect(document.querySelector('table')).toBeTruthy();
    expect(document.querySelector('pre code')).toBeTruthy();
    expect(document.querySelector('del')?.textContent).toContain('зачёркнуто');
  });

  it('neutralises javascript:/data: links and keeps safe ones', () => {
    renderViewer([
      '[evil](javascript:alert(1))',
      '[data](data:text/html;base64,PHNjcmlwdD4=)',
      '[ok](https://example.com)',
      '[rel](./docs/other.md)',
    ].join('\n'));

    const evil = screen.getByText('evil').closest('a');
    const data = screen.getByText('data').closest('a');
    const ok = screen.getByText('ok').closest('a');
    const rel = screen.getByText('rel').closest('a');

    expect(evil.getAttribute('href') || '').not.toContain('javascript:');
    expect(data.getAttribute('href') || '').not.toContain('data:');
    expect(ok.getAttribute('href')).toBe('https://example.com');
    expect(ok.getAttribute('target')).toBe('_blank');
    expect(ok.getAttribute('rel')).toContain('noopener');
    expect(rel.getAttribute('href')).toBe('./docs/other.md');
  });

  it('does not render raw HTML from the document', () => {
    renderViewer('text <img src=x onerror=alert(1)> <script>alert(2)</script> end');
    expect(document.querySelector('img[onerror]')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
  });
});
