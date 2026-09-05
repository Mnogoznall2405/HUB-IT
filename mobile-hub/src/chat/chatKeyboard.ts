import { Platform } from 'react-native';

export function chatKeyboardAvoidingProps(platform: string = Platform.OS) {
  return {
    behavior: platform === 'ios' ? ('padding' as const) : ('height' as const),
  };
}
