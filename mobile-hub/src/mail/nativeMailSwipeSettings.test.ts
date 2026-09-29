import * as SecureStore from 'expo-secure-store';
import {
  normalizeNativeMailSwipeSettings,
  readNativeMailSwipeSettings,
  writeNativeMailSwipeSettings,
} from './nativeMailSwipeSettings';
import { DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS } from './nativeMailModel';

it('keeps the agreed defaults: right — read, left — archive', async () => {
  expect(DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS).toEqual({ right: 'toggle-read', left: 'archive' });
  await expect(readNativeMailSwipeSettings(7)).resolves.toEqual({ right: 'toggle-read', left: 'archive' });
  await expect(readNativeMailSwipeSettings(0)).resolves.toEqual(DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS);
});

it('normalizes unknown values back to defaults instead of trusting storage', () => {
  expect(normalizeNativeMailSwipeSettings(null)).toEqual(DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS);
  expect(normalizeNativeMailSwipeSettings({ right: 'star', left: 'delete' })).toEqual({ right: 'toggle-read', left: 'delete' });
});

it('persists settings per user in SecureStore', async () => {
  await writeNativeMailSwipeSettings(7, { right: 'delete', left: 'none' });
  await expect(SecureStore.getItemAsync('hubit_mail_swipe_settings_v1:7')).resolves.toBe('{"right":"delete","left":"none"}');
  await expect(readNativeMailSwipeSettings(7)).resolves.toEqual({ right: 'delete', left: 'none' });
  await expect(readNativeMailSwipeSettings(8)).resolves.toEqual(DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS);
});

it('recovers defaults when storage contains corrupt JSON', async () => {
  await SecureStore.setItemAsync('hubit_mail_swipe_settings_v1:7', '{broken');
  await expect(readNativeMailSwipeSettings(7)).resolves.toEqual(DEFAULT_NATIVE_MAIL_SWIPE_SETTINGS);
});
