import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it } from 'vitest';
import MailHtmlBody from './MailHtmlBody';
import { MAIL_HTML_SANDBOX_PERMISSIONS } from './mailHtmlSandboxDocument';
import {
  MAIL_HTML_SANDBOX_STORAGE_KEY,
  isMailHtmlSandboxEnabled,
  setMailHtmlSandboxEnabled,
} from './mailHtmlSandboxFlags';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailHtmlBody', () => {
  afterEach(() => {
    window.localStorage.removeItem(MAIL_HTML_SANDBOX_STORAGE_KEY);
  });

  it('always renders the sandboxed iframe, even when the legacy flag reports off', () => {
    setMailHtmlSandboxEnabled(false);
    // Legacy flag storage and env are ignored by MailHtmlBody now: the
    // component must never fall back to inline dangerouslySetInnerHTML.
    expect(isMailHtmlSandboxEnabled({ envValue: '0' })).toBe(false);
    expect(isMailHtmlSandboxEnabled({ storage: { getItem: () => null }, envValue: '0' })).toBe(false);

    renderWithTheme(<MailHtmlBody html="<p>Isolated letter</p>" />);

    const frame = screen.getByTestId('mail-html-sandbox');
    expect(frame).toHaveAttribute('title', 'Содержимое письма');
    expect(frame.getAttribute('sandbox')).toBe(MAIL_HTML_SANDBOX_PERMISSIONS);
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame.getAttribute('srcdoc') || frame.getAttribute('srcDoc') || '').toContain('Isolated letter');
    expect(screen.queryByText('Isolated letter')).toBeNull();
  });

  it('keeps hostile markup confined to the iframe document', () => {
    const { container } = renderWithTheme(
      <MailHtmlBody
        html={
          '<p>Letter</p>'
          + '<img src="x" onerror="window.__mailXss = 1"><script>window.__mailXss = 2</script>'
          + '<form action="https://evil.example"><input type="password" name="pw"></form>'
          + '<div style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999">overlay</div>'
        }
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('div[style*="position"]')).toBeNull();
    expect(screen.queryByText('overlay')).toBeNull();

    const srcdoc = screen.getByTestId('mail-html-sandbox').getAttribute('srcdoc') || '';
    expect(srcdoc).toContain('<form');
    expect(srcdoc).toContain('type="password"');
    expect(srcdoc).toContain('position:fixed');
    expect(srcdoc).toContain('z-index');
  });
});
