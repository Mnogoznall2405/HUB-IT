import { hubTheme, isDarkAppearance } from './hubTheme';

/** Office-style tokens for login/settings (from officeUiTokens light defaults). */
export const officeTokens = {
  brand: hubTheme.primary,
  pageBg: hubTheme.background,
  shellBg: isDarkAppearance ? '#101821' : '#faf9f8',
  panelBg: isDarkAppearance ? '#131c25' : '#f7f6f5',
  panelSolid: hubTheme.paper,
  borderSoft: isDarkAppearance ? 'rgba(230,238,246,0.14)' : 'rgba(32,31,30,0.08)',
  textPrimary: hubTheme.textPrimary,
  textSecondary: hubTheme.textSecondary,
  headerBandBg: isDarkAppearance ? '#131c25' : '#f7f6f5',
  navBg: isDarkAppearance ? '#101821' : '#faf9f8',
  selectedBg: isDarkAppearance ? 'rgba(140, 200, 255, 0.18)' : 'rgba(25, 118, 210, 0.12)',
  panelRadius: 12,
  heroRadius: 16,
  controlRadius: 12,
  bottomNavHeight: 72,
} as const;

export function getBottomNavHeight(fontScale: number): number {
  const safeScale = Number.isFinite(fontScale) ? Math.max(1, Math.min(fontScale, 1.35)) : 1;
  return Math.round(officeTokens.bottomNavHeight + (safeScale - 1) * 32);
}
