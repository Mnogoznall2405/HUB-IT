import { act, renderHook } from '@testing-library/react-native';

const mockEnableBiometrics = jest.fn(async () => undefined);
const mockSkipBiometrics = jest.fn(async () => undefined);
const mockCheckForUpdate = jest.fn(async () => ({}));
const mockInstallUpdate = jest.fn(async () => ({}));
const mockOpenInstallerSettings = jest.fn(async () => undefined);
const mockExecuteNativeCommand = jest.fn(async (_command, _payload, deps) => deps);

let mockBiometricEnabled = false;
let mockUpdaterVersion = '1.1.15';

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: `user-${mockUpdaterVersion}` },
    biometricEnabled: mockBiometricEnabled,
    enableBiometrics: mockEnableBiometrics,
    skipBiometrics: mockSkipBiometrics,
  }),
}));

jest.mock('../updates/useMobileUpdater', () => ({
  useMobileUpdater: () => ({
    state: {
      status: 'idle',
      currentVersion: mockUpdaterVersion,
      currentBuild: '1',
      feed: null,
      progress: 0,
      message: '',
      canOpenInstallerSettings: false,
      required: false,
    },
    checkForUpdate: mockCheckForUpdate,
    installUpdate: mockInstallUpdate,
    openInstallerSettings: mockOpenInstallerSettings,
  }),
}));

jest.mock('./nativeCommandRuntime', () => ({
  executeNativeCommand: (command: unknown, payload: unknown, deps: unknown) => (
    mockExecuteNativeCommand(command, payload, deps)
  ),
}));

import { useNativeCommands } from './useNativeCommands';

describe('useNativeCommands', () => {
  beforeEach(() => {
    mockBiometricEnabled = false;
    mockUpdaterVersion = '1.1.15';
    mockExecuteNativeCommand.mockClear();
  });

  it('keeps execute stable across renders and reads the latest native dependencies', async () => {
    const { result, rerender } = await renderHook(() => useNativeCommands());
    const initialExecute = result.current.execute;

    mockBiometricEnabled = true;
    mockUpdaterVersion = '1.1.16';
    await rerender({});

    expect(result.current.execute).toBe(initialExecute);

    await act(async () => {
      await initialExecute('update.getState');
    });

    expect(mockExecuteNativeCommand).toHaveBeenCalledWith(
      'update.getState',
      {},
      expect.objectContaining({
        biometricEnabled: true,
        user: expect.objectContaining({ username: 'user-1.1.16' }),
        updater: expect.objectContaining({
          state: expect.objectContaining({ currentVersion: '1.1.16' }),
        }),
      }),
    );
  });
});
