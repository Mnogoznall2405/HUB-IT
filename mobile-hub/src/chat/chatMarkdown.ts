import type { ChatMessage } from '../api/types';

const MARKDOWN_TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

export type ChatBodyFormat = 'plain' | 'markdown';

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'bold'; children: MarkdownInline[] }
  | { type: 'italic'; children: MarkdownInline[] }
  | { type: 'strike'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] };

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'blockquote'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'table'; headers: string[]; rows: string[][] };

export function hasChatMarkdownTable(value?: string | null): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  const lines = text.split(/\r?\n/);
  return lines.some((line, index) => (
    /\|/.test(line)
    && MARKDOWN_TABLE_SEPARATOR_RE.test(lines[index + 1] || '')
  ));
}

export function detectChatBodyFormat(value?: string | null): ChatBodyFormat {
  const text = String(value || '').trim();
  if (!text) return 'plain';
  if (/^\s{0,3}#{1,6}\s+\S/m.test(text)) return 'markdown';
  if (/^\s{0,3}(?:```|~~~)/m.test(text)) return 'markdown';
  if (/^\s{0,3}>\s+\S/m.test(text)) return 'markdown';
  if (/^\s{0,3}- \[[ xX]\]\s+\S/m.test(text)) return 'markdown';
  if (/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)\S/m.test(text)) return 'markdown';
  if (/(^|\s)(?:\*\*|__)[^\n]+(?:\*\*|__)(?=\s|[.,!?;:]|$)/.test(text)) return 'markdown';
  if (/(^|\s)`[^`\n]+`(?=\s|[.,!?;:]|$)/.test(text)) return 'markdown';
  if (/\[[^\]\n]+\]\((?:https?:\/\/|\/|#)[^)]+\)/i.test(text)) return 'markdown';
  return hasChatMarkdownTable(text) ? 'markdown' : 'plain';
}

export function stripChatMarkdownPreview(value?: string | null): string {
  const text = String(value || '').trim();
  if (!text) return '';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cleanedLines: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (MARKDOWN_TABLE_SEPARATOR_RE.test(trimmed)) continue;

    let cleaned = trimmed;
    if (/^\|.*\|$/.test(cleaned)) {
      cleaned = cleaned
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join(' | ');
    }
    cleaned = cleaned
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}>\s?/, '')
      .replace(/^\s{0,3}- \[[ xX]\]\s+/, '')
      .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[*_~]{1,3}/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleaned) cleanedLines.push(cleaned);
    if (!inFence && cleanedLines.length >= 3) break;
  }

  return cleanedLines.join(' ').trim();
}

export function shouldRenderChatMarkdown(message?: Pick<ChatMessage, 'body_format' | 'body_text' | 'kind' | 'attachments'> | null): boolean {
  if (!message) return false;
  const format = String(message.body_format || '').trim();
  if (format === 'markdown') return true;
  if (format === 'plain') return false;
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];
  if (attachments.length) return false;
  const kind = String(message.kind || 'text').trim();
  if (kind && kind !== 'text') return false;
  return detectChatBodyFormat(message.body_text) === 'markdown';
}

export function isSafeMarkdownHref(href?: string | null): boolean {
  return /^(https?:\/\/|mailto:)/i.test(String(href || '').trim());
}

export function parseMarkdownInlines(value?: string | null): MarkdownInline[] {
  const text = String(value || '');
  if (!text) return [];
  const tokenRe = /(`[^`\n]+`)|(\*\*[^*\n]+?\*\*)|(__[^_\n]+?__)|(~~[^~\n]+?~~)|(\[[^\]\n]+\]\((?:https?:\/\/|mailto:|\/|#)[^)]+\))|(\*[^*\n]+?\*)/g;
  const tokens: MarkdownInline[] = [];
  let cursor = 0;
  let match = tokenRe.exec(text);
  while (match) {
    if (match.index > cursor) {
      tokens.push({ type: 'text', value: text.slice(cursor, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('`')) {
      tokens.push({ type: 'code', value: raw.slice(1, -1) });
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      tokens.push({ type: 'bold', children: [{ type: 'text', value: raw.slice(2, -2) }] });
    } else if (raw.startsWith('~~')) {
      tokens.push({ type: 'strike', children: [{ type: 'text', value: raw.slice(2, -2) }] });
    } else if (raw.startsWith('[')) {
      const linkMatch = raw.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      tokens.push({
        type: 'link',
        href: String(linkMatch?.[2] || '').trim(),
        children: [{ type: 'text', value: String(linkMatch?.[1] || raw) }],
      });
    } else if (raw.startsWith('*')) {
      tokens.push({ type: 'italic', children: [{ type: 'text', value: raw.slice(1, -1) }] });
    } else {
      tokens.push({ type: 'text', value: raw });
    }
    cursor = match.index + raw.length;
    match = tokenRe.exec(text);
  }
  if (cursor < text.length) tokens.push({ type: 'text', value: text.slice(cursor) });
  return tokens;
}

function splitTableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function headingLevel(line: string): 1 | 2 | 3 | 4 | null {
  const match = line.match(/^\s{0,3}(#{1,6})\s+\S/);
  if (!match) return null;
  const level = Math.min(4, match[1].length) as 1 | 2 | 3 | 4;
  return level;
}

export function parseChatMarkdown(value?: string | null): MarkdownBlock[] {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  const lines = text.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const flushParagraph = (buffer: string[]) => {
    const joined = buffer.join(' ').trim();
    if (joined) blocks.push({ type: 'paragraph', children: parseMarkdownInlines(joined) });
    buffer.length = 0;
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^\s{0,3}(?:```|~~~)/.test(trimmed)) {
      const fence = [];
      index += 1;
      while (index < lines.length && !/^\s{0,3}(?:```|~~~)/.test(lines[index].trim())) {
        fence.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', value: fence.join('\n') });
      continue;
    }

    const heading = headingLevel(trimmed);
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading,
        children: parseMarkdownInlines(trimmed.replace(/^\s{0,3}#{1,6}\s+/, '')),
      });
      index += 1;
      continue;
    }

    if (/^\s{0,3}>\s+\S/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s{0,3}>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s{0,3}>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', children: parseMarkdownInlines(quote.join(' ')) });
      continue;
    }

    if (
      index + 1 < lines.length
      && /\|/.test(trimmed)
      && MARKDOWN_TABLE_SEPARATOR_RE.test(lines[index + 1] || '')
    ) {
      const headers = splitTableCells(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /\|/.test(lines[index]) && !MARKDOWN_TABLE_SEPARATOR_RE.test(lines[index])) {
        rows.push(splitTableCells(lines[index]));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    const unordered = /^\s{0,3}(?:[-*+]|\d+[.)])\s+\S/.test(line);
    if (unordered) {
      const ordered = /^\s{0,3}\d+[.)]\s+\S/.test(line);
      const items: MarkdownInline[][] = [];
      while (index < lines.length && /^\s{0,3}(?:[-*+]|\d+[.)]|- \[[ xX]\])\s+\S/.test(lines[index])) {
        items.push(parseMarkdownInlines(
          lines[index]
            .replace(/^\s{0,3}- \[[ xX]\]\s+/, '')
            .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, ''),
        ));
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [trimmed];
    index += 1;
    while (
      index < lines.length
      && lines[index].trim()
      && !/^\s{0,3}(?:#{1,6}\s+|```|~~~|>\s+|[-*+]\s+|\d+[.)]\s+|- \[[ xX]\]\s+)/.test(lines[index])
      && !( /\|/.test(lines[index]) && MARKDOWN_TABLE_SEPARATOR_RE.test(lines[index + 1] || ''))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    flushParagraph(paragraph);
  }

  return blocks;
}
