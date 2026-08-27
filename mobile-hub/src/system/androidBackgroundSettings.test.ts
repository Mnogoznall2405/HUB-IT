import * as IntentLauncher from 'expo-intent-launcher';
import { openAndroidBackgroundSettingsForPackage } from './androidBackgroundSettings';

jest.mock('expo-application', () => ({ applicationId: 'ru.zsgp.hubit.mobile' }));
jest.mock('expo-intent-launcher', () => ({
  ActivityAction: {
    VIEW_ADVANCED_POWER_USAGE_DETAIL: 'android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL',
    APPLICATION_DETAILS_SETTINGS: 'android.settings.APPLICATION_DETAILS_SETTINGS',
  },
  startActivityAsync: jest.fn(async () => undefined),
}));

describe('Android background settings', () => {
  it('opens the app-specific battery screen without requesting an exemption', async () => {
    await expect(openAndroidBackgroundSettingsForPackage('ru.zsgp.hubit.mobile')).resolves.toEqual({
      opened: true,
      destination: 'battery',
    });
    expect(IntentLauncher.startActivityAsync).toHaveBeenCalledWith(
      'android.settings.VIEW_ADVANCED_POWER_USAGE_DETAIL',
      { data: 'package:ru.zsgp.hubit.mobile' },
    );
    expect(IntentLauncher.startActivityAsync).not.toHaveBeenCalledWith(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      expect.anything(),
    );
  });

  it('falls back to the application details screen on OEMs without the battery intent', async () => {
    jest.mocked(IntentLauncher.startActivityAsync)
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockResolvedValueOnce({ resultCode: 0 });

    await expect(openAndroidBackgroundSettingsForPackage('ru.zsgp.hubit.mobile')).resolves.toEqual({
      opened: true,
      destination: 'application',
    });
    expect(IntentLauncher.startActivityAsync).toHaveBeenLastCalledWith(
      'android.settings.APPLICATION_DETAILS_SETTINGS',
      { data: 'package:ru.zsgp.hubit.mobile' },
    );
  });
});
