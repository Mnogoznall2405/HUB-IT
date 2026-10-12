// Shared chat device-log events that must exist once per process: keyboard
// show/hide (one RN Keyboard subscription however many chat hosts are mounted)
// and socket connect/disconnect (the inbox and the thread both observe the
// socket, so the last reported state is de-duplicated here).
import { useEffect } from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';
import { logChatDevice } from '../diagnostics/chatDeviceLog';
import { CHAT_KEYBOARD_MODE } from './chatKeyboard';

type Subscription = { remove: () => void };

let keyboardRetainers = 0;
let keyboardSubscriptions: Subscription[] = [];

function logKeyboardEvent(event: string, payload: KeyboardEvent) {
  logChatDevice(event, {
    height: Math.round(Number(payload?.endCoordinates?.height) || 0),
    ms: Math.round(Number(payload?.duration) || 0),
    mode: CHAT_KEYBOARD_MODE,
  });
}

function retainKeyboardLog(): () => void {
  keyboardRetainers += 1;
  if (keyboardRetainers === 1) {
    keyboardSubscriptions = [
      Keyboard.addListener('keyboardDidShow', (payload) => logKeyboardEvent('keyboard_show', payload)),
      Keyboard.addListener('keyboardDidHide', (payload) => logKeyboardEvent('keyboard_hide', payload)),
    ];
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    keyboardRetainers = Math.max(0, keyboardRetainers - 1);
    if (keyboardRetainers === 0) {
      keyboardSubscriptions.forEach((subscription) => subscription.remove());
      keyboardSubscriptions = [];
    }
  };
}

/** Keeps the keyboard device-log subscription alive while a chat host is mounted. */
export function useChatKeyboardDeviceLog(): void {
  useEffect(() => retainKeyboardLog(), []);
}

let lastSocketState: string | null = null;

/** Logs ws_connect / ws_disconnect once per state change, whichever observer reports it. */
export function logChatSocketState(state: string): void {
  if (!state || state === lastSocketState) return;
  const previous = lastSocketState;
  lastSocketState = state;
  if (state === 'connected') {
    logChatDevice('ws_connect', { state });
  } else if (previous === 'connected') {
    logChatDevice('ws_disconnect', { state });
  }
}
