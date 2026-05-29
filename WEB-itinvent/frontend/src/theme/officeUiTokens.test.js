import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { buildOfficeUiTokens, getOfficeCodeBlockSx } from './officeUiTokens';

describe('officeUiTokens', () => {
  it('code block uses readable text color on light theme', () => {
    const theme = createTheme({
      palette: {
        mode: 'light',
        text: { primary: '#201f1e', secondary: '#605e5c' },
        background: { paper: '#ffffff' },
      },
      customAdmin: {
        panelInset: '#f3f2f1',
        borderSoft: 'rgba(32, 31, 30, 0.08)',
        textPrimary: '#201f1e',
      },
    });
    const ui = buildOfficeUiTokens(theme);
    const sx = getOfficeCodeBlockSx(ui);

    expect(sx.color).toBe('#201f1e');
    expect(sx.bgcolor).toBe('#f3f2f1');
    expect(sx.borderColor).toBe('rgba(32, 31, 30, 0.08)');
  });
});
