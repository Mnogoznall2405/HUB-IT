import { describe, expect, it } from 'vitest';
import {
  buildComposeMailPreviewHtml,
  buildSignaturePreviewHtml,
  normalizeSignaturePreviewHtml,
} from './mailOutgoingPreview';

describe('mailOutgoingPreview', () => {
  it('wraps compose preview without a forced background and with the standard font stack', () => {
    const html = buildComposeMailPreviewHtml({
      composeBody: '<p>Hello</p>',
      signatureHtml: '<p>--<br>Signature</p>',
    });

    expect(html).toContain('data-mail-outgoing="true"');
    expect(html).not.toContain('background:#ffffff');
    expect(html).not.toContain('color:#000000');
    expect(html).toContain('font-family:Aptos, Calibri, Arial, Helvetica, sans-serif');
  });

  it('keeps the signature before quoted history in compose preview', () => {
    const html = buildComposeMailPreviewHtml({
      composeBody: '<p>Reply</p>',
      quotedOriginalHtml: '<div class="quoted-mail"><blockquote><p>Older quote</p></blockquote></div>',
      signatureHtml: '<p>--<br>Signature</p>',
    });

    expect(html.indexOf('Reply')).toBeLessThan(html.indexOf('data-mail-signature="true"'));
    expect(html.indexOf('Signature')).toBeLessThan(html.indexOf('Older quote'));
  });

  it('splits quoted history from the editor body when the quote is embedded directly', () => {
    const html = buildComposeMailPreviewHtml({
      composeBody: '<p>Reply</p><blockquote><p>Older quote</p></blockquote>',
      signatureHtml: '<p>--<br>Signature</p>',
    });

    expect(html.indexOf('Signature')).toBeLessThan(html.indexOf('Older quote'));
  });

  it('strips previously wrapped outgoing preview containers from the signature source', () => {
    const signature = normalizeSignaturePreviewHtml(
      '<div data-mail-outgoing="true" style="background:#ffffff;">'
      + '<div data-mail-signature="true" style="margin:0 0 0 0;"><p>--<br>Signature</p></div>'
      + '</div>',
    );

    expect(signature).toMatch(/<p style="margin:\s*0 0 4px 0;\s*line-height:\s*1\.35;">--<br>Signature<\/p>/i);
  });

  it('compacts paragraph spacing inside signatures for real email clients', () => {
    const html = buildComposeMailPreviewHtml({
      composeBody: '<p>Hello</p>',
      signatureHtml: '<p>С уважением,</p><p style="color:#003b71">Максим Козловский</p><p>Тел.: +7</p>',
    });

    expect(html).toContain('data-mail-signature="true"');
    expect(html).toMatch(/<p style="margin:\s*0 0 4px 0;\s*line-height:\s*1\.35;"/i);
    expect(html).toMatch(/<p style="color:\s*#003b71;\s*margin:\s*0 0 4px 0;\s*line-height:\s*1\.35;"/i);
    expect(html).not.toMatch(/<p>С уважением/);
  });

  it('normalizes white inline text from dark compose themes before sending', () => {
    const html = buildComposeMailPreviewHtml({
      composeBody: '<p style="color:#ffffff !important">Typed text</p>',
      signatureHtml: '<p style="color:rgb(255,255,255)">Signature</p>',
    });

    expect(html).toContain('Typed text');
    expect(html).toContain('Signature');
    expect(html).toMatch(/color:\s*(#000000|rgb\(0,\s*0,\s*0\))/i);
    expect(html).not.toMatch(/color:\s*(#ffffff|rgb\(255,\s*255,\s*255\))/i);
  });

  it('builds the signature dialog preview with quoted history after the signature', () => {
    const html = buildSignaturePreviewHtml('<p>--<br>Signature</p>');

    expect(html).toContain('Предыдущее сообщение');
    expect(html.indexOf('Signature')).toBeLessThan(html.indexOf('Предыдущее сообщение'));
  });
});
