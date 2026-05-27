import { MD3LightTheme } from 'react-native-paper';
import { hubTheme } from './hubTheme';

export const paperTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: hubTheme.primary,
    secondary: hubTheme.secondary,
    background: hubTheme.background,
    surface: hubTheme.paper,
    error: hubTheme.error,
  },
  roundness: hubTheme.borderRadius,
};
