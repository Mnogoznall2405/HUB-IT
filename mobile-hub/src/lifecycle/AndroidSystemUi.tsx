import { NavigationBar, type NavigationBarStyle } from 'expo-navigation-bar';
import { useEffect } from 'react';
import { AppState, Keyboard, Platform } from 'react-native';

type AndroidSystemUiProps = {
  navigationBarStyle: NavigationBarStyle;
};

export function AndroidSystemUi({ navigationBarStyle }: AndroidSystemUiProps) {
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const hideNavigationBar = () => {
      NavigationBar.setHidden(true);
    };

    hideNavigationBar();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') hideNavigationBar();
    });
    const keyboardSubscription = Keyboard.addListener('keyboardDidHide', hideNavigationBar);

    return () => {
      appStateSubscription.remove();
      keyboardSubscription.remove();
    };
  }, []);

  return <NavigationBar hidden style={navigationBarStyle} />;
}
