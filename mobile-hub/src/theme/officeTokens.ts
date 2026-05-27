import { hubTheme } from './hubTheme';

/** Office-style tokens for login/settings (from officeUiTokens light defaults). */
export const officeTokens = {
  brand: hubTheme.primary,
  pageBg: hubTheme.background,
  shellBg: '#faf9f8',
  panelBg: '#f7f6f5',
  panelSolid: hubTheme.paper,
  borderSoft: 'rgba(32,31,30,0.08)',
  textPrimary: hubTheme.textPrimary,
  textSecondary: hubTheme.textSecondary,
  headerBandBg: '#f7f6f5',
  navBg: '#faf9f8',
  selectedBg: 'rgba(25, 118, 210, 0.12)',
} as const;
