import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it } from 'vitest';
import MailHtmlBody from './MailHtmlBody';
import { MAIL_HTML_SANDBOX_PERMISSIONS } from './mailHtmlSandboxDocument';
import { MAIL_HTML_SANDBOX_STORAGE_KEY, setMailHtmlSandboxEnabled } from './mailHtmlSandboxFlags';

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

  it('renders html in the page when the sandbox flag is off', () => {
    setMailHtmlSandboxEnabled(false);
    renderWithTheme(<MailHtmlBody html="<p>Inline letter</p>" />);

    expect(screen.getByText('Inline letter')).toBeVisible();
    expect(screen.queryByTestId('mail-html-sandbox')).toBeNull();
  });

  it('renders a sandboxed iframe without allow-scripts when the flag is on', () => {
    setMailHtmlSandboxEnabled(true);
    renderWithTheme(<MailHtmlBody html="<p>Isolated letter</p>" />);

    const frame = screen.getByTestId('mail-html-sandbox');
    expect(frame).toHaveAttribute('title', 'Содержимое письма');
    expect(frame.getAttribute('sandbox')).toBe(MAIL_HTML_SANDBOX_PERMISSIONS);
    expect(frame.getAttribute('sandbox')).not.toContain('allow-scripts');
    expect(frame.getAttribute('srcdoc') || frame.getAttribute('srcDoc') || '').toContain('Isolated letter');
  });
});
