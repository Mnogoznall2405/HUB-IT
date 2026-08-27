import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';

export type FluentColorScheme = 'light' | 'dark';
export type FluentThemeMode = 'light' | 'dark' | 'system';

export const NATIVE_BOTTOM_NAV_CONTENT_HEIGHT = 72;

const LIGHT = {
  scheme: 'light' as const,
  primary: '#0f6cbd',
  primaryLight: '#479ef5',
  primaryDark: '#115ea3',
  secondary: '#038387',
  pageBg: '#f3f2f1',
  shellBg: '#faf9f8',
  navBg: '#ffffff',
  panelBg: '#ffffff',
  panelMuted: '#f7f6f5',
  panelInset: '#f3f2f1',
  panelSolid: '#ffffff',
  surfaceRaised: '#ffffff',
  borderSoft: 'rgba(32, 31, 30, 0.08)',
  border: 'rgba(32, 31, 30, 0.12)',
  borderStrong: 'rgba(32, 31, 30, 0.16)',
  accentSoft: 'rgba(15, 108, 189, 0.10)',
  selected: 'rgba(15, 108, 189, 0.10)',
  selectedBorder: 'rgba(15, 108, 189, 0.18)',
  actionBg: '#f7f6f5',
  actionBorder: 'rgba(32, 31, 30, 0.10)',
  actionHover: '#f3f2f1',
  textPrimary: '#201f1e',
  textSecondary: '#605e5c',
  textTertiary: '#8a8886',
  textDisabled: 'rgba(96, 94, 92, 0.55)',
  iconPrimary: '#201f1e',
  iconMuted: '#605e5c',
  error: '#c50f1f',
  warning: '#8e562e',
  success: '#107c10',
  emptyStateBg: '#f8f7f6',
  headerBandBg: '#f7f6f5',
  shadowSoft: '0 10px 28px rgba(32, 31, 30, 0.06)',
  bottomNavShadow: '0 -10px 28px rgba(15, 23, 42, 0.10)',
  radius: 12,
  cardRadius: 16,
  controlRadius: 12,
  minTouch: 44,
  bottomNavHeight: NATIVE_BOTTOM_NAV_CONTENT_HEIGHT,
} as const;

const DARK = {
  scheme: 'dark' as const,
  primary: '#0f6cbd',
  primaryLight: '#479ef5',
  primaryDark: '#115ea3',
  secondary: '#038387',
  pageBg: '#0f1115',
  shellBg: '#11151b',
  navBg: '#171a1f',
  panelBg: '#171a1f',
  panelMuted: '#1b1f26',
  panelInset: '#262b31',
  panelSolid: '#1f2329',
  surfaceRaised: '#1f2329',
  borderSoft: 'rgba(255, 255, 255, 0.08)',
  border: 'rgba(255, 255, 255, 0.12)',
  borderStrong: 'rgba(255, 255, 255, 0.18)',
  accentSoft: 'rgba(15, 108, 189, 0.18)',
  selected: 'rgba(15, 108, 189, 0.20)',
  selectedBorder: 'rgba(102, 179, 255, 0.30)',
  actionBg: 'rgba(255, 255, 255, 0.04)',
  actionBorder: 'rgba(255, 255, 255, 0.12)',
  actionHover: 'rgba(255, 255, 255, 0.08)',
  textPrimary: '#f3f2f1',
  textSecondary: '#c8c6c4',
  textTertiary: '#a19f9d',
  textDisabled: 'rgba(200, 198, 196, 0.62)',
  iconPrimary: '#f3f2f1',
  iconMuted: '#d2d0ce',
  error: '#ff99a4',
  warning: '#ffb900',
  success: '#6ccb5f',
  emptyStateBg: 'rgba(255, 255, 255, 0.025)',
  headerBandBg: '#1b1f26',
  shadowSoft: '0 8px 24px rgba(0, 0, 0, 0.20)',
  bottomNavShadow: '0 -12px 30px rgba(0, 0, 0, 0.28)',
  radius: 12,
  cardRadius: 16,
  controlRadius: 12,
  minTouch: 44,
  bottomNavHeight: NATIVE_BOTTOM_NAV_CONTENT_HEIGHT,
} as const;

export type FluentTokens = typeof LIGHT | typeof DARK;

export const FluentThemeContext = createContext<FluentTokens>(
  getFluentTokens(resolveFluentScheme('system', Appearance.getColorScheme() || 'light')),
);

export function useAppFluentTokens(): FluentTokens {
  return useContext(FluentThemeContext);
}

export function resolveFluentScheme(
  themeMode: FluentThemeMode | string | undefined,
  systemScheme: ColorSchemeName,
): FluentColorScheme {
  if (themeMode === 'dark') return 'dark';
  if (themeMode === 'light') return 'light';
  return systemScheme === 'dark' ? 'dark' : 'light';
}

export function getFluentTokens(scheme: FluentColorScheme): FluentTokens {
  return scheme === 'dark' ? DARK : LIGHT;
}

function readSystemScheme(): ColorSchemeName {
  return Appearance.getColorScheme() || 'light';
}

export function useFluentTokens(themeMode: FluentThemeMode | string = 'system'): FluentTokens {
  const [systemScheme, setSystemScheme] = useState<ColorSchemeName>(readSystemScheme);

  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme || 'light');
    });
    return () => subscription.remove();
  }, []);

  return useMemo(
    () => getFluentTokens(resolveFluentScheme(themeMode, systemScheme)),
    [systemScheme, themeMode],
  );
}
