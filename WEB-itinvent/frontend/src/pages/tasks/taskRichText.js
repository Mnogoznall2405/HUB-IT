const escapeEditorHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const applyInlineMarkdownToHtml = (value) => {
  let nextValue = escapeEditorHtml(value);
  nextValue = nextValue.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  nextValue = nextValue.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  nextValue = nextValue.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return nextValue;
};

export const markdownToEditorHtml = (value) => {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const lines = text.split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    const numberMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    if (bulletMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*]\s+(.*)$/);
        if (!match) break;
        items.push(`<li>${applyInlineMarkdownToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (numberMatch) {
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+\.\s+(.*)$/);
        if (!match) break;
        items.push(`<li>${applyInlineMarkdownToHtml(match[1])}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    blocks.push(line.trim() ? `<div>${applyInlineMarkdownToHtml(line)}</div>` : '<div><br></div>');
    index += 1;
  }

  return blocks.join('');
};

const editorNodeToMarkdown = (node) => {
  if (!node) return '';
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tagName = String(node.tagName || '').toLowerCase();
  if (tagName === 'br') return '\n';

  const childText = () => Array.from(node.childNodes || []).map(editorNodeToMarkdown).join('');
  if (tagName === 'strong' || tagName === 'b') return `**${childText()}**`;
  if (tagName === 'em' || tagName === 'i') return `*${childText()}*`;
  if (tagName === 's' || tagName === 'strike' || tagName === 'del') return `~~${childText()}~~`;
  if (tagName === 'li') return childText().trim();
  if (tagName === 'ul') {
    return Array.from(node.children || [])
      .filter((child) => String(child.tagName || '').toLowerCase() === 'li')
      .map((child) => `- ${editorNodeToMarkdown(child).trim()}`)
      .join('\n');
  }
  if (tagName === 'ol') {
    return Array.from(node.children || [])
      .filter((child) => String(child.tagName || '').toLowerCase() === 'li')
      .map((child, itemIndex) => `${itemIndex + 1}. ${editorNodeToMarkdown(child).trim()}`)
      .join('\n');
  }
  if (['div', 'p'].includes(tagName)) return childText();
  return childText();
};

export const editorHtmlToMarkdown = (html) => {
  if (typeof document === 'undefined') return '';
  const container = document.createElement('div');
  container.innerHTML = String(html || '');
  const parts = [];
  let inlineBuffer = '';
  Array.from(container.childNodes || []).forEach((node) => {
    const tagName = node.nodeType === Node.ELEMENT_NODE ? String(node.tagName || '').toLowerCase() : '';
    const isBlock = ['div', 'p', 'ul', 'ol'].includes(tagName);
    const markdown = editorNodeToMarkdown(node);
    if (isBlock) {
      if (inlineBuffer.trim()) {
        parts.push(inlineBuffer.trim());
        inlineBuffer = '';
      }
      if (markdown.trim()) parts.push(markdown.trim());
      return;
    }
    inlineBuffer += markdown;
  });
  if (inlineBuffer.trim()) parts.push(inlineBuffer.trim());
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

export const stripMarkdownForPreview = (value) => String(value || '')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/~~([^~]+)~~/g, '$1')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
  .replace(/^\s*[-*]\s+/gm, '')
  .replace(/^\s*\d+\.\s+/gm, '')
  .trim();

export const focusRichEditor = (editor) => {
  if (!editor) return;
  editor.focus();
};
