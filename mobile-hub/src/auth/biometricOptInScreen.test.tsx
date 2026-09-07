import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

const mockSkip = jest.fn(async () => undefined);
const mockEnable = jest.fn(async () => undefined);
const mockUser = { id: 7, role: 'viewer' };
jest.mock('./AuthContext', () => ({
  useAuth: () => ({
    user: mockUser, hasPermission: () => false,
    skipBiometrics: mockSkip, enableBiometrics: mockEnable,
  }),
}));
jest.mock('./biometricAuth', () => ({
  getBiometricCapability: async () => ({ available: true, enrolled: true, fingerprint: true }),
}));
import BiometricOptInScreen from '../../app/(auth)/biometric-opt-in';

it('retains the opt-in screen after a failed skip and allows retry without reporting native details', async () => {
  jest.mocked(router.replace).mockClear();
  mockSkip.mockRejectedValueOnce(new Error('synthetic storage detail'));
  const view = await render(<BiometricOptInScreen />);
  await fireEvent.press(view.getByText('Не сейчас'));
  expect(await view.findByRole('alert')).toHaveTextContent('Не удалось сохранить выбор. Попробуйте ещё раз.');
  expect(router.replace).not.toHaveBeenCalled();
  expect(view.queryByText('synthetic storage detail')).toBeNull();
  await fireEvent.press(view.getByText('Не сейчас'));
  await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
  expect(mockSkip).toHaveBeenCalledTimes(2);
});
