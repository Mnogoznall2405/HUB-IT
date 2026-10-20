import { Platform } from 'react-native';
import HubitDeviceHealthModule from '../../modules/hubit-device-health';

export type BatteryOptimizationState = 'restricted' | 'unrestricted' | 'unknown';

// «Экономия батареи» усыпляет сеть приложения в фоне. unrestricted — приложению разрешено
// работать без ограничений; unknown — старый APK без нативного метода или не Android.
export async function getBatteryOptimizationState(): Promise<BatteryOptimizationState> {
  if (Platform.OS !== 'android' || typeof HubitDeviceHealthModule?.isIgnoringBatteryOptimizationsAsync !== 'function') {
    return 'unknown';
  }
  try {
    return (await HubitDeviceHealthModule.isIgnoringBatteryOptimizationsAsync()) ? 'unrestricted' : 'restricted';
  } catch {
    return 'unknown';
  }
}

export async function openBatteryOptimizationSettings(): Promise<boolean> {
  if (Platform.OS !== 'android' || typeof HubitDeviceHealthModule?.openBatteryOptimizationSettingsAsync !== 'function') {
    return false;
  }
  try {
    return Boolean(await HubitDeviceHealthModule.openBatteryOptimizationSettingsAsync());
  } catch {
    return false;
  }
}
