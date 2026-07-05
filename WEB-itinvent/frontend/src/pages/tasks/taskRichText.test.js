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
  });
});
