import { createTheme } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { buildOfficeUiTokens, getAppShellMobileFabBottomOffset, getOfficeCodeBlockSx, getOfficePageShellSx } from './officeUiTokens';

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

  it('fullHeight page shell subtracts mobile top and bottom shell offsets on xs', () => {
    const theme = createTheme({ palette: { mode: 'light' } });
    const ui = buildOfficeUiTokens(theme);
    const sx = getOfficePageShellSx(ui, { fullHeight: true });

    expect(sx.height.xs).toContain('--app-shell-top-offset');
    expect(sx.height.xs).toContain('--app-shell-mobile-bottom-nav-height');
    expect(sx.height.xs).not.toContain('--app-shell-header-offset');
  });

  it('mobile fab offset accounts for bottom navigation height', () => {
    expect(getAppShellMobileFabBottomOffset()).toContain('--app-shell-mobile-bottom-nav-height');
  });
});
