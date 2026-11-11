import {
  detectChatBodyFormat,
  hasChatMarkdownTable,
  parseChatMarkdown,
  shouldRenderChatMarkdown,
  stripChatMarkdownPreview,
} from './chatMarkdown';

describe('native chat markdown', () => {
  it('detects explicit markdown constructs', () => {
    expect(detectChatBodyFormat('## Inventory\n\nReady')).toBe('markdown');
    expect(detectChatBodyFormat('| Name | Value |\n| --- | --- |\n| A | B |')).toBe('markdown');
    expect(detectChatBodyFormat('- first\n- second')).toBe('markdown');
    expect(detectChatBodyFormat('```js\nconsole.log(1)\n```')).toBe('markdown');
    expect(detectChatBodyFormat('Use **bold** text')).toBe('markdown');
    expect(detectChatBodyFormat('[Open](https://example.com)')).toBe('markdown');
  });

  it('keeps ordinary multiline chat text plain', () => {
    expect(detectChatBodyFormat('Hello\nHow are you?\nSee you later')).toBe('plain');
  });

  it('detects GFM tables', () => {
    expect(hasChatMarkdownTable('| Name | Value |\n| --- | --- |\n| A | B |')).toBe(true);
    expect(hasChatMarkdownTable('Name | Value\n--- | ---\nA | B')).toBe(true);
    expect(hasChatMarkdownTable('Plain text with | pipe')).toBe(false);
  });

  it('strips markdown markers from inbox previews', () => {
    expect(stripChatMarkdownPreview('## Inventory\n\n**Source:** ITinvent')).toBe('Inventory Source: ITinvent');
    expect(stripChatMarkdownPreview('[Open](https://example.com)')).toBe('Open');
  });

  it('renders markdown when the format is explicit or auto-detected', () => {
    expect(shouldRenderChatMarkdown({
      body_format: 'markdown',
      body_text: 'plain looking',
    })).toBe(true);
    expect(shouldRenderChatMarkdown({
      body_format: 'plain',
      body_text: 'Use **bold** text',
    })).toBe(false);
    expect(shouldRenderChatMarkdown({
      body_text: 'Use **bold** text',
    })).toBe(true);
  });

  it('parses headings, emphasis and lists', () => {
    const blocks = parseChatMarkdown('## Inventory\n\nUse **bold** and `code`\n\n- first\n- second');
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: false });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });
});
