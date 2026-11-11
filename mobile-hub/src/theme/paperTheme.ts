import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import { getFluentTokens, type FluentColorScheme } from './fluentTokens';
import { hubTheme } from './hubTheme';

export function createPaperTheme(scheme: FluentColorScheme) {
  const baseTheme = scheme === 'dark' ? MD3DarkTheme : MD3LightTheme;
  const tokens = getFluentTokens(scheme);
  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: tokens.primary,
      secondary: tokens.secondary,
      background: tokens.pageBg,
      surface: tokens.panelSolid,
      onPrimary: '#ffffff',
      onSurface: tokens.textPrimary,
      onSurfaceVariant: tokens.textSecondary,
      error: tokens.error,
    },
    roundness: hubTheme.borderRadius,
  };
}
