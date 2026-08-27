import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';

let mockAuthValue: {
  verifyTwoFactor: jest.Mock<Promise<void>, [string, boolean?]>;
  startTwoFactorSetup?: jest.Mock;
  verifyTwoFactorSetup?: jest.Mock;
  loginChallengeId: string | null;
  hasPermission: (permission: string) => boolean;
  user: {
    id: number;
    username: string;
    role: string;
    permissions: string[];
  };
};

jest.mock('./AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

import TwoFactorScreen from '../../app/(auth)/two-factor';
import SetupRequiredScreen from '../../app/(auth)/setup-required';

describe('TwoFactorScreen navigation', () => {
  beforeEach(() => {
    jest.mocked(router.replace).mockClear();
  });

  it('does not redirect back to login when a valid 2FA challenge is consumed', async () => {
    let view: Awaited<ReturnType<typeof render>>;
    const verifyTwoFactor = jest.fn(async (_code: string, _isBackup?: boolean) => {
      mockAuthValue = { ...mockAuthValue, loginChallengeId: null };
      await view.rerender(<TwoFactorScreen />);
    });
    mockAuthValue = {
      verifyTwoFactor,
      loginChallengeId: 'challenge-1',
      hasPermission: () => true,
      user: {
        id: 7,
        username: 'mobile-test',
        role: 'viewer',
        permissions: ['dashboard.read'],
      },
    };

    view = await render(<TwoFactorScreen />);
    await fireEvent.changeText(view.getByTestId('text-input-outlined'), '123456');
    await fireEvent.press(view.getByText('Подтвердить'));

    await waitFor(() => expect(verifyTwoFactor).toHaveBeenCalledWith('123456', false));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/(auth)/biometric-opt-in'));
    expect(router.replace).not.toHaveBeenCalledWith('/(auth)/login');
  });
});

describe('SetupRequiredScreen native enrollment', () => {
  beforeEach(() => {
    jest.mocked(router.replace).mockClear();
    mockAuthValue = {
      verifyTwoFactor: jest.fn(),
      loginChallengeId: 'setup',
      hasPermission: () => false,
      user: {
        id: 7,
        username: 'mobile-test',
        role: 'viewer',
        permissions: [],
      },
      startTwoFactorSetup: jest.fn(async () => ({
        login_challenge_id: 'challenge-setup-1',
        otpauth_uri: 'otpauth://totp/HUB-IT:mobile-test?secret=SECRET123&issuer=HUB-IT',
        issuer: 'HUB-IT',
        account_name: 'mobile-test',
        manual_entry_key: 'SECRET123',
      })),
      verifyTwoFactorSetup: jest.fn(async () => ['BACKUP-ONE', 'BACKUP-TWO']),
    } as typeof mockAuthValue;
  });

  it('enrolls TOTP and shows one-time backup codes without leaving the APK', async () => {
    const view = await render(<SetupRequiredScreen />);
    await waitFor(() => expect(view.getByTestId('two-factor-manual-key')).toHaveTextContent('SECRET123'));
    await fireEvent.changeText(view.getByTestId('two-factor-setup-code'), '123456');
    await fireEvent.press(view.getByTestId('two-factor-setup-confirm'));
    await waitFor(() => expect(mockAuthValue.verifyTwoFactorSetup).toHaveBeenCalledWith('123456'));
    expect(view.getByText('BACKUP-ONE')).toBeTruthy();
    expect(view.getByText('BACKUP-TWO')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalledWith('/(auth)/login');
  });
});
