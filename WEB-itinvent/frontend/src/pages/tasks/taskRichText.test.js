import { describe, expect, it } from 'vitest';

import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
  sanitizeEditorPasteHtml,
  stripMarkdownForPreview,
} from './taskRichText';

describe('taskRichText', () => {
  it('converts markdown lists to editor html and back', () => {
    const markdown = '- first\n- second';
    const html = markdownToEditorHtml(markdown);
    expect(html).toContain('<ul>');
    expect(editorHtmlToMarkdown(html)).toContain('- first');
    expect(editorHtmlToMarkdown(html)).toContain('- second');
  });

  it('strips markdown for preview', () => {
    expect(stripMarkdownForPreview('**Bold** and *italic*')).toBe('Bold and italic');
    expect(stripMarkdownForPreview('- item')).toBe('item');
    expect(stripMarkdownForPreview('see [карточка](https://x.test/db)')).toBe('see карточка');
  });

  it('round-trips markdown links through the editor html', () => {
    const html = markdownToEditorHtml('Открыть [карточку](/database?inv_no=100665)');
    expect(html).toContain('href="/database?inv_no=100665"');
    expect(editorHtmlToMarkdown(html)).toBe('Открыть [карточку](/database?inv_no=100665)');
  });

  it('does not emit anchors for unsafe link targets', () => {
    const html = markdownToEditorHtml('bad [click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('javascript:alert(1)');
  });

  it('does not let a quoted href break out of the anchor attribute', () => {
    const html = markdownToEditorHtml('x [click](https://a"onmouseover="alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).not.toMatch(/href="[^"]*"[^>]*onmouseover/);
  });
});

describe('sanitizeEditorPasteHtml (FE-0064)', () => {
  it('keeps allowed formatting: strong/em/a/lists/divs — text and hrefs survive', () => {
    const safe = sanitizeEditorPasteHtml(
      '<div><strong>Жирный</strong> <em>курсив</em> <b>полужирное</b> <i>курсив2</i> '
      + '<a href="https://example.com" target="_blank">ссылка</a>'
      + '<ul><li>первый</li><li>второй</li></ul></div>',
    );
    expect(safe).toContain('<strong>Жирный</strong>');
    expect(safe).toContain('<em>курсив</em>');
    expect(safe).toContain('<a href="https://example.com">');
    expect(safe).toContain('<ul><li>первый</li><li>второй</li></ul>');
    expect(safe).not.toContain('target="_blank"');
  });

  it('strips script, onclick/onerror, and keeps the surrounding text', () => {
    const safe = sanitizeEditorPasteHtml(
      '<p onclick="alert(1)">Текст <img src="x" onerror="alert(2)" alt="a"> <script>alert(3)</script> после</p>',
    );
    expect(safe).toContain('Текст');
    expect(safe).toContain('после');
    expect(safe).not.toMatch(/onclick|onerror/);
    expect(safe).not.toContain('<script');
    expect(safe).not.toContain('<img');
  });

  it('strips javascript:/data: hrefs; keeps relative, https and mailto hrefs', () => {
    const jsHref = sanitizeEditorPasteHtml('<a href="javascript:alert(1)">x</a>');
    expect(jsHref).not.toContain('javascript:');
    expect(jsHref).toContain('x');
    const dataHref = sanitizeEditorPasteHtml('<a href="data:text/html,x">x</a>');
    expect(dataHref).not.toContain('data:');
    expect(sanitizeEditorPasteHtml('<a href="/db?q=1">x</a>')).toContain('href="/db?q=1"');
    expect(sanitizeEditorPasteHtml('<a href="mailto:a@b.c">x</a>')).toContain('href="mailto:a@b.c"');
  });

  it('round-trips the sanitized paste through editorHtmlToMarkdown', () => {
    const safe = sanitizeEditorPasteHtml('<div><strong>Жирный</strong><br>строка 2</div>');
    const markdown = editorHtmlToMarkdown(safe);
    expect(markdown).toContain('**Жирный**');
    expect(markdown).toContain('строка 2');
  });

  it('returns empty string for empty/garbage input', () => {
    expect(sanitizeEditorPasteHtml('')).toBe('');
    expect(sanitizeEditorPasteHtml(null)).toBe('');
    expect(sanitizeEditorPasteHtml('   ')).toBe('');
    expect(sanitizeEditorPasteHtml('<div><svg onload="alert(1)">svg</svg></div>')).not.toContain('<svg');
    expect(sanitizeEditorPasteHtml('<div><svg onload="alert(1)">svg</svg></div>')).not.toMatch(/onload/);
  });
});
