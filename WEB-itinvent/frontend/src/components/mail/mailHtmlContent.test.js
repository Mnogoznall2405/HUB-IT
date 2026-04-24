import { describe, expect, it } from 'vitest';
import { buildRenderedMailHtml, filterVisibleMailAttachments } from './mailHtmlContent';

describe('mailHtmlContent', () => {
  it('resolves inline cid images and hides used inline attachments', () => {
    const inlineAttachment = {
      id: 'att-inline',
      download_token: 'mailatt-inline',
      name: 'logo.png',
      content_type: 'image/png',
      content_id: '<logo123>',
      inline_src: '/api/v1/mail/messages/msg-42/attachments/mailatt-inline?disposition=inline',
    };
    const fileAttachment = {
      id: 'att-file',
      download_token: 'mailatt-file',
      name: 'report.pdf',
      content_type: 'application/pdf',
    };

    const result = buildRenderedMailHtml(
      '<p>Hello</p><img src="cid:logo123" alt="Inline logo" />',
      [inlineAttachment, fileAttachment]
    );

    expect(result.hasBlockedExternalImages).toBe(false);
    expect(result.html).toContain('src="/api/v1/mail/messages/msg-42/attachments/mailatt-inline?disposition=inline"');
    expect(result.usedInlineAttachmentIds.has('mailatt-inline')).toBe(true);

    const visibleAttachments = filterVisibleMailAttachments(
      [inlineAttachment, fileAttachment],
      result.usedInlineAttachmentIds
    );
    expect(visibleAttachments).toEqual([fileAttachment]);
  });

  it('prefers inline data urls over attachment endpoints for small embedded images', () => {
    const inlineAttachment = {
      id: 'att-inline',
      download_token: 'mailatt-inline',
      name: 'logo.png',
      content_type: 'image/png',
      content_id: '<logo123>',
      inline_data_url: 'data:image/png;base64,AAAA',
      inline_src: '/api/v1/mail/messages/msg-42/attachments/mailatt-inline?disposition=inline',
    };

    const result = buildRenderedMailHtml(
      '<p><img src="cid:logo123" alt="Inline logo" /></p>',
      [inlineAttachment]
    );

    expect(result.html).toContain('src="data:image/png;base64,AAAA"');
    expect(result.html).not.toContain('/api/v1/mail/messages/msg-42/attachments/');
  });

  it('blocks remote images until explicitly allowed', () => {
    const blockedResult = buildRenderedMailHtml(
      '<p><img src="https://cdn.example.com/logo.png" alt="Remote logo" /></p>',
      []
    );

    expect(blockedResult.hasBlockedExternalImages).toBe(true);
    expect(blockedResult.html).not.toContain('https://cdn.example.com/logo.png');
    expect(blockedResult.html).toContain('Внешнее изображение скрыто');

    const revealedResult = buildRenderedMailHtml(
      '<p><img src="https://cdn.example.com/logo.png" alt="Remote logo" /></p>',
      [],
      { allowExternalImages: true }
    );

    expect(revealedResult.hasBlockedExternalImages).toBe(false);
    expect(revealedResult.html).toContain('https://cdn.example.com/logo.png');
  });

  it('replaces unresolved cid images with a placeholder', () => {
    const result = buildRenderedMailHtml(
      '<p><img src="cid:missing-logo" alt="Missing logo" /></p>',
      []
    );

    expect(result.hasBlockedExternalImages).toBe(false);
    expect(result.html).toContain('Изображение недоступно');
    expect(result.html).not.toContain('cid:missing-logo');
  });
  it('preserves safe inline html styling while stripping dangerous script handlers', () => {
    const result = buildRenderedMailHtml(
      '<table class="mail-grid" style="background:#fff;color:#333"><tr><td style="padding:12px" onclick="alert(1)">Styled cell</td></tr></table><script>alert(2)</script>',
      []
    );

    expect(result.html).toContain('class="mail-grid"');
    expect(result.html).toMatch(/style="[^"]*background:\s*#fff/i);
    expect(result.html).toMatch(/style="[^"]*padding:\s*12px/i);
    expect(result.html).not.toContain('onclick=');
    expect(result.html).not.toContain('<script');
  });

  it('adapts low-contrast blue text for dark mode readability', () => {
    const result = buildRenderedMailHtml(
      '<p style="color:#0070c0">Blue corporate text</p>',
      [],
      { colorScheme: 'dark' }
    );

    expect(result.html).toContain('Blue corporate text');
    expect(result.html).toMatch(/color:\s*(#8cc8ff|rgb\(140,\s*200,\s*255\))/i);
    expect(result.html).not.toMatch(/color:\s*#0070c0/i);
  });

  it('adapts black text and light backgrounds for dark mode', () => {
    const result = buildRenderedMailHtml(
      '<div bgcolor="#ffffff" style="background:#fff;color:#111">Readable content</div>',
      [],
      { colorScheme: 'dark' }
    );

    expect(result.html).toContain('Readable content');
    expect(result.html).toMatch(/background-color:\s*(#222832|rgb\(34,\s*40,\s*50\))/i);
    expect(result.html).toMatch(/color:\s*(#f3f2f1|rgb\(243,\s*242,\s*241\))/i);
    expect(result.html).toContain('bgcolor="#222832"');
  });

  it('adapts outgoing mail text in dark mode without adding a forced background', () => {
    const result = buildRenderedMailHtml(
      '<div data-mail-outgoing="true" style="font-family:Aptos, Calibri"><p style="color:#000000">Sent content</p></div>',
      [],
      { colorScheme: 'dark' }
    );

    expect(result.html).toContain('data-mail-outgoing="true"');
    expect(result.html).toContain('Sent content');
    expect(result.html).toMatch(/color:\s*(#f3f2f1|rgb\(243,\s*242,\s*241\))/i);
    expect(result.html).not.toMatch(/background:\s*(#ffffff|rgb\(255,\s*255,\s*255\)|#222832|rgb\(34,\s*40,\s*50\))/i);
  });

  it('dark-adapts older outgoing shells that were saved with a white background', () => {
    const result = buildRenderedMailHtml(
      '<div data-mail-outgoing="true" style="background:#ffffff;color:#000000">Old sent content</div>',
      [],
      { colorScheme: 'dark' }
    );

    expect(result.html).toContain('Old sent content');
    expect(result.html).toMatch(/background-color:\s*(#222832|rgb\(34,\s*40,\s*50\))/i);
    expect(result.html).toMatch(/color:\s*(#f3f2f1|rgb\(243,\s*242,\s*241\))/i);
  });

  it('keeps original inline colors in light mode', () => {
    const result = buildRenderedMailHtml(
      '<p style="color:#0070c0;background:#fff">Original colors</p>',
      [],
      { colorScheme: 'light' }
    );

    expect(result.html).toMatch(/color:\s*#0070c0/i);
    expect(result.html).toMatch(/background:\s*#fff/i);
  });

  it('normalizes tiny inline font sizes while preserving font families', () => {
    const result = buildRenderedMailHtml(
      '<p style="font-size:9px;font-family:Georgia, serif">Small text</p><span style="font-size:8pt">Point text</span>',
      []
    );

    expect(result.html).toContain('Small text');
    expect(result.html).toMatch(/font-size:\s*13px/i);
    expect(result.html).toMatch(/font-family:\s*Georgia,\s*serif/i);
    expect(result.html).toMatch(/font-size:\s*10pt/i);
  });

  it('adds responsive sizing rules to rendered images so mobile preview does not stretch them', () => {
    const result = buildRenderedMailHtml(
      '<p><img src="https://cdn.example.com/banner.png" alt="Banner" style="width:640px;height:320px" /></p>',
      [],
      { allowExternalImages: true }
    );

    expect(result.html).toContain('max-width:100% !important');
    expect(result.html).toContain('height:auto !important');
    expect(result.html).not.toContain('height="320"');
  });

  it('wraps top-level tables in a horizontal scroll container for narrow screens', () => {
    const result = buildRenderedMailHtml(
      '<table style="width:640px"><tr><td>Wide table</td></tr></table>',
      []
    );

    expect(result.html).toContain('data-mail-table-scroll="true"');
    expect(result.html).toContain('Wide table');
    expect(result.html).toContain('border-collapse:collapse');
  });

  it('keeps cid and remote image handling while applying dark responsive rendering', () => {
    const inlineAttachment = {
      id: 'att-inline',
      download_token: 'mailatt-inline',
      name: 'logo.png',
      content_type: 'image/png',
      content_id: '<logo123>',
      inline_src: '/api/v1/mail/messages/msg-42/attachments/mailatt-inline?disposition=inline',
    };

    const result = buildRenderedMailHtml(
      '<table bgcolor="#fff" style="width:640px"><tr><td style="color:#111"><img src="cid:logo123" /></td></tr></table><img src="https://cdn.example.com/pixel.png" />',
      [inlineAttachment],
      { colorScheme: 'dark' }
    );

    expect(result.hasBlockedExternalImages).toBe(true);
    expect(result.html).toContain('src="/api/v1/mail/messages/msg-42/attachments/mailatt-inline?disposition=inline"');
    expect(result.html).toContain('data-mail-table-scroll="true"');
    expect(result.html).toMatch(/background-color:\s*(#222832|rgb\(34,\s*40,\s*50\))/i);
    expect(result.html).not.toContain('https://cdn.example.com/pixel.png');
  });

  it('neutralizes fixed-width layout wrappers that can push mobile preview sideways', () => {
    const result = buildRenderedMailHtml(
      '<div style="width:720px;min-width:720px"><p>Fixed wrapper</p></div>',
      []
    );

    expect(result.html).toContain('Fixed wrapper');
    expect(result.html).toContain('max-width:100% !important');
    expect(result.html).toContain('min-width:0 !important');
    expect(result.html).toContain('box-sizing:border-box');
  });
});
