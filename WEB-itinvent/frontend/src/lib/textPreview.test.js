import { describe, expect, it } from 'vitest';
import {
  decodeTextBuffer,
  extractMarkdownHeadings,
  getTextFileKind,
  getTextLanguage,
  safeMarkdownUrlTransform,
  TEXT_PREVIEW_MAX_BYTES,
} from './textPreview';

describe('getTextFileKind', () => {
  it('classifies markdown extensions', () => {
    for (const name of ['readme.md', 'DOC.MARKDOWN', 'notes.mdown', 'spec.mkd']) {
      expect(getTextFileKind({ fileName: name, contentType: 'text/markdown' }), name).toBe('markdown');
    }
  });

  it('classifies csv/tsv as table previews', () => {
    expect(getTextFileKind({ fileName: 'data.csv', contentType: 'text/csv' })).toBe('csv');
    expect(getTextFileKind({ fileName: 'data.tsv', contentType: 'text/tab-separated-values' })).toBe('csv');
  });

  it('classifies bounded text formats', () => {
    for (const name of ['a.txt', 'app.log', 'cfg.json', 'page.xml', 'x.yaml', 'x.yml', 's.ini', 'q.sql', 'm.py', 'a.ts', 'style.css', 'i.html', 'e.ini', 'p.properties', 'b.conf']) {
      expect(getTextFileKind({ fileName: name, contentType: 'application/octet-stream' }), name).toBe('text');
    }
  });

  it('rejects binary and unknown extensions even with text/* MIME', () => {
    expect(getTextFileKind({ fileName: 'setup.exe', contentType: 'text/plain' })).toBe('');
    expect(getTextFileKind({ fileName: 'archive.zip', contentType: 'text/plain' })).toBe('');
    expect(getTextFileKind({ fileName: 'report.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe('');
  });

  it('rescues extension-less text files only by textual MIME', () => {
    expect(getTextFileKind({ fileName: 'README', contentType: 'text/plain' })).toBe('text');
    expect(getTextFileKind({ fileName: 'payload', contentType: 'application/json' })).toBe('text');
    expect(getTextFileKind({ fileName: 'binary', contentType: 'application/octet-stream' })).toBe('');
  });
});

describe('getTextLanguage', () => {
  it('maps extensions to fast-path languages', () => {
    expect(getTextLanguage('a.ts')).toBe('typescript');
    expect(getTextLanguage('a.tsx')).toBe('typescript');
    expect(getTextLanguage('a.js')).toBe('javascript');
    expect(getTextLanguage('a.json')).toBe('json');
    expect(getTextLanguage('a.yml')).toBe('yaml');
    expect(getTextLanguage('a.md')).toBe('markdown');
    expect(getTextLanguage('a.py')).toBe('python');
    expect(getTextLanguage('a.sql')).toBe('sql');
  });

  it('returns empty for formats handled by lazy legacy modes or plain text', () => {
    expect(getTextLanguage('a.log')).toBe('');
    expect(getTextLanguage('a.ini')).toBe('');
    expect(getTextLanguage('a.java')).toBe('');
  });
});

describe('decodeTextBuffer', () => {
  it('decodes UTF-8', () => {
    const bytes = new TextEncoder().encode('Привет, мир!');
    const { text, encoding } = decodeTextBuffer(bytes.buffer);
    expect(text).toBe('Привет, мир!');
    expect(encoding).toBe('UTF-8');
  });

  it('strips UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0x42]);
    const { text, encoding } = decodeTextBuffer(bytes.buffer);
    expect(text).toBe('AB');
    expect(encoding).toBe('UTF-8 BOM');
  });

  it('decodes UTF-16 LE with BOM', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x1f, 0x04]);
    const { text, encoding } = decodeTextBuffer(bytes.buffer);
    expect(text).toBe('A\u041f');
    expect(encoding).toBe('UTF-16 LE');
  });

  it('falls back to Windows-1251 for legacy Russian text', () => {
    // "Привет" in cp1251
    const bytes = new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]);
    const { text, encoding } = decodeTextBuffer(bytes.buffer);
    expect(text).toBe('Привет');
    expect(encoding).toBe('Windows-1251');
  });
});

describe('safeMarkdownUrlTransform', () => {
  it('allows http(s), mailto, tel, anchors and relative paths', () => {
    expect(safeMarkdownUrlTransform('https://example.com/x')).toBe('https://example.com/x');
    expect(safeMarkdownUrlTransform('http://a.b')).toBe('http://a.b');
    expect(safeMarkdownUrlTransform('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeMarkdownUrlTransform('tel:+123')).toBe('tel:+123');
    expect(safeMarkdownUrlTransform('#section')).toBe('#section');
    expect(safeMarkdownUrlTransform('./docs/a.md')).toBe('./docs/a.md');
    expect(safeMarkdownUrlTransform('../up/x.png')).toBe('../up/x.png');
  });

  it('blocks dangerous schemes', () => {
    expect(safeMarkdownUrlTransform('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrlTransform('JavaScript:alert(1)')).toBe('');
    expect(safeMarkdownUrlTransform('java\tscript:alert(1)')).toBe('');
    expect(safeMarkdownUrlTransform('data:text/html,<script>1</script>')).toBe('');
    expect(safeMarkdownUrlTransform('data:image/png;base64,AAAA')).toBe('');
    expect(safeMarkdownUrlTransform('vbscript:x')).toBe('');
    expect(safeMarkdownUrlTransform('file:///etc/passwd')).toBe('');
    expect(safeMarkdownUrlTransform('blob:https://x/y')).toBe('');
  });
});

describe('extractMarkdownHeadings', () => {
  it('collects headings with GitHub-compatible slugs', () => {
    const md = [
      '# Заголовок Первый',
      'text',
      '## Подраздел!',
      '## Подраздел!',
      '### deep',
    ].join('\n');
    expect(extractMarkdownHeadings(md)).toEqual([
      { level: 1, text: 'Заголовок Первый', slug: 'заголовок-первый' },
      { level: 2, text: 'Подраздел!', slug: 'подраздел' },
      { level: 2, text: 'Подраздел!', slug: 'подраздел-1' },
      { level: 3, text: 'deep', slug: 'deep' },
    ]);
  });

  it('skips headings inside fenced code blocks', () => {
    const md = [
      '# Real',
      '```',
      '# fake heading',
      '```',
      '~~~',
      '## also fake',
      '~~~',
      '## Real2',
    ].join('\n');
    const headings = extractMarkdownHeadings(md);
    expect(headings.map((h) => h.text)).toEqual(['Real', 'Real2']);
  });

  it('respects maxLevel', () => {
    const md = '# a\n## b\n### c';
    expect(extractMarkdownHeadings(md, { maxLevel: 2 }).map((h) => h.level)).toEqual([1, 2]);
  });
});

describe('limits', () => {
  it('caps text previews at 8 MiB', () => {
    expect(TEXT_PREVIEW_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
