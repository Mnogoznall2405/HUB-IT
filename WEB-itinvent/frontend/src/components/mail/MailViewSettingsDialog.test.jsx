import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import MailViewSettingsDialog from './MailViewSettingsDialog';

function renderWithTheme(node) {
  return render(
    <ThemeProvider theme={createTheme()}>
      {node}
    </ThemeProvider>,
  );
}

describe('MailViewSettingsDialog AI toggle', () => {
  it('shows disclosure and toggles mail AI without waiting for view save', () => {
    const onAiEnabledChange = vi.fn();
    const onSave = vi.fn();
    renderWithTheme(
      <MailViewSettingsDialog
        open
        value={{ reading_pane: 'right', density: 'comfortable', show_preview_snippets: true, show_favorites_first: false }}
        aiEnabled={false}
        onAiEnabledChange={onAiEnabledChange}
        onClose={vi.fn()}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByTestId('mail-ai-settings-disclosure')).toBeVisible();
    fireEvent.click(screen.getByTestId('mail-ai-enabled-toggle'));
    expect(onAiEnabledChange).toHaveBeenCalledWith(true);
    expect(onSave).not.toHaveBeenCalled();
  });
});
