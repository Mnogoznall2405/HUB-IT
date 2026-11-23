import { describe, expect, it } from 'vitest';

import { buildMarkdownPrintBodyHtml } from './markdownPrint';

describe('buildMarkdownPrintBodyHtml', () => {
  it('renders GFM structure for the print document', () => {
    const body = buildMarkdownPrintBodyHtml('# Заголовок\n\n- [x] done\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(body).toContain('<h1');
    expect(body).toContain('Заголовок');
    expect(body).toContain('type="checkbox"');
    expect(body).toContain('<table>');
  });

  it('keeps the sanitize pipeline: no scripts, no javascript: links', () => {
    const body = buildMarkdownPrintBodyHtml('[x](javascript:alert(1))\n\n<script>alert(2)</script>');
    expect(body).not.toContain('javascript:');
    expect(body).not.toContain('<script>');
  });
});
