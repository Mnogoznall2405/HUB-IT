import { describe, expect, it } from 'vitest';

import {
  editorHtmlToMarkdown,
  markdownToEditorHtml,
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
});
