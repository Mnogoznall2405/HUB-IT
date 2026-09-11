// Test-only composition: production owns one delivery host at the shell level.
import { useLayoutEffect, type ComponentProps, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { NativeChatDeliveryHost } from '../chat/NativeChatDeliveryHost';
import { setNativeChatDeliveryBlocked } from '../chat/nativeChatDeliveryGate';
import { NativeChatThreadScreen } from '../screens/chat/NativeChatThreadScreen';
import { NativeChatOutboxScreen } from '../screens/chat/NativeChatOutboxScreen';
function DeliverySession({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const previous = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    if (previous?.configurable !== false) Object.defineProperty(AppState, 'currentState', {
      configurable: true, writable: true, value: 'active',
    });
    setNativeChatDeliveryBlocked(false);
    return () => {
      setNativeChatDeliveryBlocked(true);
      if (previous?.configurable !== false && previous) Object.defineProperty(AppState, 'currentState', previous);
    };
  }, []);
  return <><NativeChatDeliveryHost />{children}</>;
}
export function NativeChatThreadWithDelivery(props: ComponentProps<typeof NativeChatThreadScreen>) {
  return <DeliverySession><NativeChatThreadScreen {...props} /></DeliverySession>;
}
export function NativeChatOutboxWithDelivery() {
  return <DeliverySession><NativeChatOutboxScreen /></DeliverySession>;
}
