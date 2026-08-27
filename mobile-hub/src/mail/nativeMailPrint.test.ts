import { buildNativeMailPrintHtml } from './nativeMailPrint';

it('builds a printable safe mail document without scripts or remote images', () => {
  const html = buildNativeMailPrintHtml({
    id: 'message-1',
    subject: '<Quarterly report>',
    sender: 'sender@example.com',
    to: ['recipient@example.com'],
    received_at: '2026-08-25T10:00:00+05:00',
    body_html: '<p>Safe <strong>body</strong></p><script>alert(1)</script><img src="https://tracker.example/pixel">',
    attachments: [],
  });

  expect(html).toContain('&lt;Quarterly report&gt;');
  expect(html).toContain('<strong>body</strong>');
  expect(html).toContain("script-src 'none'");
  expect(html).not.toContain('alert(1)');
  expect(html).not.toContain('tracker.example');
});
