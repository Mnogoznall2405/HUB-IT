import { describe, expect, it } from 'vitest';

import {
  buildSheetsPrintBodyHtml,
  buildTextPrintBodyHtml,
  escapeHtml,
} from './documentPrint';

describe('documentPrint builders', () => {
  it('escapes markup in text and cell content', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
    const body = buildTextPrintBodyHtml({ text: 'a<script>alert(1)</script>' });
    expect(body).not.toContain('<script>');
    expect(body).toContain('&lt;script&gt;');
  });

  it('wraps text in a monospace pre and flags truncation', () => {
    const body = buildTextPrintBodyHtml({ text: 'line1\nline2', truncated: true });
    expect(body).toContain('<pre class="text">line1\nline2</pre>');
    expect(body).toContain('первая часть файла');
  });

  it('renders workbook sheets as escaped tables with a header row', () => {
    const body = buildSheetsPrintBodyHtml({
      sheets: [{
        name: 'Лист<img>',
        rows: [
          ['Колонка', 'Значение'],
          ['<xss>', 42],
        ],
      }],
    });
    expect(body).toContain('<th>Колонка</th>');
    expect(body).toContain('&lt;xss&gt;');
    expect(body).toContain('&lt;img&gt;');
    expect(body).not.toContain('<xss>');
  });
});
