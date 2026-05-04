import { describe, expect, it } from 'vitest';
import { getMessageBodyHtmlSource, mailPlainTextToHtml } from './useMailMessageRenderState';

describe('mail message render helpers', () => {
  it('uses html bodies before falling back to escaped plain text', () => {
    expect(getMessageBodyHtmlSource({ body_html: '<p>Hello</p>', body_text: 'ignored' })).toBe('<p>Hello</p>');
    expect(getMessageBodyHtmlSource({ body_text: 'Line <one>\nLine two' })).toBe('<div>Line &lt;one&gt;<br />Line two</div>');
  });

  it('returns an empty html source for empty plain text', () => {
    expect(mailPlainTextToHtml('')).toBe('');
    expect(mailPlainTextToHtml('   ')).toBe('');
  });
});
