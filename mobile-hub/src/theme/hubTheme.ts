import { Appearance } from 'react-native';

export const isDarkAppearance = Appearance.getColorScheme() === 'dark';

export const hubTheme = {
  primary: isDarkAppearance ? '#8cc8ff' : '#1976d2',
  primaryDark: isDarkAppearance ? '#5eacf0' : '#004ba0',
  secondary: isDarkAppearance ? '#6bd8ca' : '#00796b',
  background: isDarkAppearance ? '#0d141c' : '#f5f7fa',
  paper: isDarkAppearance ? '#151e28' : '#ffffff',
  error: isDarkAppearance ? '#ffb4ab' : '#d32f2f',
  warning: isDarkAppearance ? '#ffbd7a' : '#ed6c02',
  success: isDarkAppearance ? '#88dc94' : '#2e7d32',
  textPrimary: isDarkAppearance ? '#f2f5f7' : 'rgba(0, 0, 0, 0.87)',
  textSecondary: isDarkAppearance ? '#b6c1cc' : 'rgba(0, 0, 0, 0.6)',
  spacing: 8,
  borderRadius: 8,
  minTouch: 44,
} as const;
