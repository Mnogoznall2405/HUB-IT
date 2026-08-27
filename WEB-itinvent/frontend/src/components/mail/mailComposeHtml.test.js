import { describe, expect, it } from 'vitest';
import { buildPortableComposeHtml, sanitizeComposePasteHtml } from './mailComposeHtml';

describe('mailComposeHtml', () => {
  it('keeps links, formatting and tables while removing conflicting neutral colors', () => {
    const html = sanitizeComposePasteHtml(`
      <p style="color:#000000;background-color:white"><strong>Текст</strong> <a href="https://example.com">ссылка</a></p>
      <table><tbody><tr><td>Ячейка</td></tr></tbody></table>
    `);

    expect(html).toContain('<strong>Текст</strong>');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('<table>');
    expect(html).not.toMatch(/color:\s*(?:#000000|white)/i);
    expect(html).not.toMatch(/background-color:\s*white/i);
  });

  it('does not retain remote or data images from pasted html', () => {
    const html = sanitizeComposePasteHtml(`
      <p>До</p><img src="https://tracking.example/pixel.png"><img src="data:image/png;base64,abc"><p>После</p>
    `);

    expect(html).toContain('До');
    expect(html).toContain('После');
    expect(html).not.toContain('<img');
  });

  it('converts Quill classes and lists to portable email html', () => {
    const html = buildPortableComposeHtml(`
      <h2 class="ql-align-center ql-size-large">Заголовок</h2>
      <ol><li data-list="bullet"><span class="ql-ui"></span>Первый</li></ol>
      <table><tbody><tr><td>Ячейка</td></tr></tbody></table>
      <p><img src="cid:hubit-inline-1@hubit.local"></p>
    `);

    expect(html).toContain('text-align: center');
    expect(html).toContain('font-size: 1.5em');
    expect(html).toContain('<ul>');
    expect(html).not.toContain('ql-');
    expect(html).toContain('border-collapse: collapse');
    expect(html).toContain('cid:hubit-inline-1@hubit.local');
  });
});
