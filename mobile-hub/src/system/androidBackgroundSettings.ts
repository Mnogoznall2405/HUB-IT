import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

export type AndroidBackgroundSettingsResult = {
  opened: true;
  destination: 'battery' | 'application';
};

export async function openAndroidBackgroundSettingsForPackage(
  rawPackageName: string,
): Promise<AndroidBackgroundSettingsResult> {
  const packageName = String(rawPackageName || '').trim();
  if (!packageName) throw new Error('Android package is unavailable');
  const data = `package:${packageName}`;
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.VIEW_ADVANCED_POWER_USAGE_DETAIL,
      { data },
    );
    return { opened: true, destination: 'battery' };
  } catch {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data },
    );
    return { opened: true, destination: 'application' };
  }
}

export async function openAndroidBackgroundSettings(): Promise<AndroidBackgroundSettingsResult> {
  if (Platform.OS !== 'android') throw new Error('Android background settings are unavailable');
  return openAndroidBackgroundSettingsForPackage(String(Application.applicationId || ''));
}
