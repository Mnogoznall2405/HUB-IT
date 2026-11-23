import { describe, expect, it } from 'vitest';

import {
  buildPrintDocumentHtml,
  buildSheetsPrintBodyHtml,
  buildTextPrintBodyHtml,
  escapeHtml,
  sheetsPrintLosesRows,
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

  it('builds a complete standalone print document with escaped title', () => {
    const html = buildPrintDocumentHtml({ title: 'a<b>.md', bodyHtml: '<pre>x</pre>' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>a&lt;b&gt;.md</title>');
    expect(html).toContain('<body><pre>x</pre></body>');
  });

  it('reports true sheet totals when the preview was truncated upstream', () => {
    const body = buildSheetsPrintBodyHtml({
      sheets: [{
        name: 'Лист1',
        rows: [['a'], ['b']],
        totalRows: 9000,
      }],
    });
    expect(body).toContain('из 9000');
    // The honest "loses rows" flag must fire on either cap.
    expect(sheetsPrintLosesRows({
      sheets: [{ rows: [['a']], totalRows: 9000 }],
    })).toBe(true);
    expect(sheetsPrintLosesRows({
      sheets: [{ rows: Array.from({ length: 600 }, () => ['x']), totalRows: 600 }],
    })).toBe(true);
    expect(sheetsPrintLosesRows({
      sheets: [{ rows: [['a']], totalRows: 1 }],
    })).toBe(false);
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
