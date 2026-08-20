import { describe, expect, it } from 'vitest';
import {
  buildQuickReplyHtml,
  buildQuickReplyOutgoingHtml,
  resolveMailReplyQuoteHtml,
} from './mailQuickReplyBody';

describe('mailQuickReplyBody', () => {
  it('escapes user text for the reply paragraph', () => {
    expect(buildQuickReplyHtml('Line <one>\nLine two >')).toBe(
      '<p>Line &lt;one&gt;<br/>Line two &gt;</p>',
    );
  });

  it('prefers compose_context quote_html', () => {
    const quote = resolveMailReplyQuoteHtml(
      { body_html: '<p>Ignored</p>', subject: 'Budget' },
      { quote_html: '<div class="quoted-mail"><p>Original</p></div>' },
    );
    expect(quote).toContain('Original');
    expect(quote).not.toContain('Ignored');
  });

  it('builds a quoted original from the open message when quote_html is missing', () => {
    const quote = resolveMailReplyQuoteHtml({
      sender_display: 'Труфанова Алена',
      subject: 'Инструкция',
      received_at: '2026-08-20T09:03:00+05:00',
      body_html: '<p>Please add this to the knowledge base</p>',
    });
    expect(quote).toContain('quoted-mail');
    expect(quote).toContain('Труфанова Алена');
    expect(quote).toContain('Инструкция');
    expect(quote).toContain('Please add this to the knowledge base');
  });

  it('appends quoted history after the new reply text', () => {
    const html = buildQuickReplyOutgoingHtml(
      'Принято',
      '<div class="quoted-mail"><blockquote>Старое письмо</blockquote></div>',
    );
    expect(html.indexOf('Принято')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('Принято')).toBeLessThan(html.indexOf('Старое письмо'));
    expect(html).toContain('quoted-mail');
  });
});
