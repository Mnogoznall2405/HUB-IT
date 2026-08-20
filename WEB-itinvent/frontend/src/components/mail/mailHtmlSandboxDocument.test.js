import { describe, expect, it } from 'vitest';
import {
  MAIL_HTML_SANDBOX_CSP,
  MAIL_HTML_SANDBOX_PERMISSIONS,
  buildMailSandboxSrcDoc,
} from './mailHtmlSandboxDocument';

describe('buildMailSandboxSrcDoc', () => {
  it('wraps sanitized html with script-blocking csp and keeps cid endpoints', () => {
    const srcDoc = buildMailSandboxSrcDoc(
      '<p>Hello</p><img src="/api/v1/mail/messages/msg-42/attachments/mailatt-inline?disposition=inline" alt="logo">',
      { collapseQuotes: true },
    );

    expect(srcDoc).toContain('Hello');
    expect(srcDoc).toContain('/api/v1/mail/messages/msg-42/attachments/mailatt-inline?disposition=inline');
    expect(srcDoc).toContain(MAIL_HTML_SANDBOX_CSP);
    expect(srcDoc).toContain("script-src 'none'");
    expect(srcDoc).toContain('blockquote,.gmail_quote');
    expect(srcDoc).not.toContain('<script');
  });

  it('does not allow scripts in the iframe sandbox token list', () => {
    expect(MAIL_HTML_SANDBOX_PERMISSIONS).toContain('allow-same-origin');
    expect(MAIL_HTML_SANDBOX_PERMISSIONS).toContain('allow-popups');
    expect(MAIL_HTML_SANDBOX_PERMISSIONS.split(/\s+/)).not.toContain('allow-scripts');
  });
});
