import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailAiConsentDialog from './MailAiConsentDialog';
import { MAIL_AI_DISCLOSURE_TEXT } from './mailAiFlags';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailAiConsentDialog', () => {
  it('shows disclosure and confirms opt-in', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <MailAiConsentDialog open onClose={onClose} onConfirm={onConfirm} />,
    );

    expect(screen.getByTestId('mail-ai-disclosure')).toHaveTextContent(MAIL_AI_DISCLOSURE_TEXT);
    fireEvent.click(screen.getByTestId('mail-ai-consent-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without enabling', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    renderWithTheme(
      <MailAiConsentDialog open onClose={onClose} onConfirm={onConfirm} />,
    );

    fireEvent.click(screen.getByTestId('mail-ai-consent-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
