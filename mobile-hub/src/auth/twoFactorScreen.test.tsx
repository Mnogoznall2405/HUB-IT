import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import * as Clipboard from 'expo-clipboard';
import { Linking } from 'react-native';

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

  it('sends a code only once when two keyboard events arrive before the response', async () => {
    const verifyTwoFactor = jest.fn((_code: string, _isBackup?: boolean) => new Promise<void>(() => {}));
    mockAuthValue = {
      verifyTwoFactor,
      loginChallengeId: 'synthetic-challenge',
      hasPermission: () => true,
      user: { id: 7, username: 'synthetic', role: 'user', permissions: [] },
    };
    const view = await render(<TwoFactorScreen />);
    await fireEvent.changeText(view.getByTestId('text-input-outlined'), '123456');
    const submit = view.getByTestId('text-input-outlined').props.onSubmitEditing;
    await act(async () => { submit(); submit(); });
    expect(verifyTwoFactor).toHaveBeenCalledTimes(1);
  });

  it('validates six digits locally and keeps backup code formatting separate', async () => {
    mockAuthValue = {
      verifyTwoFactor: jest.fn(async (_code: string, _backup?: boolean): Promise<void> => undefined), loginChallengeId: 'synthetic',
      hasPermission: () => false, user: { id: 7, username: 'test', role: 'user', permissions: [] },
    };
    const view = await render(<TwoFactorScreen />);
    await fireEvent.changeText(view.getByTestId('text-input-outlined'), '12345');
    await fireEvent.press(view.getByText('Подтвердить'));
    expect(mockAuthValue.verifyTwoFactor).not.toHaveBeenCalled();
    await fireEvent.press(view.getByText('Использовать резервный код'));
    expect(view.getByTestId('text-input-outlined').props.value).toBe('');
    await fireEvent.changeText(view.getByTestId('text-input-outlined'), '  AbCD-9876  ');
    await fireEvent.press(view.getByText('Подтвердить'));
    expect(mockAuthValue.verifyTwoFactor).toHaveBeenCalledWith('AbCD-9876', true);
  });

  it.each(['Login confirmation session expired. Sign in again', 'Сессия подтверждения истекла. Войдите снова'])('offers a fresh login after confirmed expiry: %s', async (detail) => {
    mockAuthValue = {
      verifyTwoFactor: jest.fn(async (_code: string, _backup?: boolean): Promise<void> => { throw { isAxiosError: true, response: { status: 400, data: { detail } } }; }),
      loginChallengeId: 'synthetic', hasPermission: () => false,
      user: { id: 7, username: 'test', role: 'user', permissions: [] },
    };
    const view = await render(<TwoFactorScreen />);
    await fireEvent.changeText(view.getByTestId('text-input-outlined'), '123 456');
    await fireEvent.press(view.getByText('Подтвердить'));
    expect(mockAuthValue.verifyTwoFactor).toHaveBeenCalledWith('123456', false);
    expect(view.getByRole('alert')).toHaveTextContent('Время подтверждения истекло. Начните вход заново.');
    await fireEvent(view.getByTestId('text-input-outlined'), 'submitEditing');
    expect(mockAuthValue.verifyTwoFactor).toHaveBeenCalledTimes(1);
    await fireEvent.press(view.getByText('Войти заново'));
    expect(router.replace).toHaveBeenCalledWith('/(auth)/login');
  });

  it.each([new Error('Сеть недоступна'), { isAxiosError: true, response: { status: 429, data: { detail: 'Слишком много попыток. Повторите позже.' } } }])('keeps temporary failure %# retryable with the same code', async (cause) => {
    mockAuthValue = {
      verifyTwoFactor: jest.fn().mockRejectedValueOnce(cause).mockResolvedValueOnce(undefined),
      loginChallengeId: 'synthetic', hasPermission: () => false,
      user: { id: 7, username: 'test', role: 'user', permissions: [] },
    };
    const view = await render(<TwoFactorScreen />);
    await fireEvent.changeText(view.getByTestId('text-input-outlined'), '123456');
    await fireEvent.press(view.getByText('Подтвердить'));
    expect(view.getByTestId('text-input-outlined').props.value).toBe('123456');
    await fireEvent.press(view.getByText('Подтвердить'));
    expect(mockAuthValue.verifyTwoFactor).toHaveBeenCalledTimes(2);
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
  it('keeps manual setup available when the authenticator cannot open and hides native secret-bearing errors', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('synthetic sensitive URI'));
    const view = await render(<SetupRequiredScreen />);
    await view.findByTestId('two-factor-manual-key');
    await fireEvent.press(view.getByText('Открыть аутентификатор'));
    expect(await view.findByRole('alert')).toHaveTextContent(/добавьте ключ вручную/);
    expect(view.queryByText('synthetic sensitive URI')).toBeNull();
    expect(view.getByTestId('two-factor-manual-key')).toBeTruthy();
    open.mockRestore();
  });

  it('shows copy failure for both the setup key and backup codes and permits retry', async () => {
    const copy = jest.spyOn(Clipboard, 'setStringAsync').mockRejectedValue(new Error('synthetic clipboard failure'));
    const view = await render(<SetupRequiredScreen />);
    await view.findByTestId('two-factor-manual-key');
    await fireEvent.press(view.getByText('Скопировать ключ'));
    expect(await view.findByRole('alert')).toHaveTextContent(/скопируйте его вручную/);
    await fireEvent.changeText(view.getByTestId('two-factor-setup-code'), '123456');
    await fireEvent.press(view.getByTestId('two-factor-setup-confirm'));
    await view.findByText('BACKUP-ONE');
    await fireEvent.press(view.getByText('Скопировать все коды'));
    expect(await view.findByRole('alert')).toHaveTextContent(/скопируйте его вручную/);
    copy.mockResolvedValueOnce(true);
    await fireEvent.press(view.getByText('Скопировать все коды'));
    await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
    expect(view.getByText('Скопировано')).toBeTruthy();
    expect(view.getByText('BACKUP-ONE')).toBeTruthy();
    copy.mockRestore();
  });

});
