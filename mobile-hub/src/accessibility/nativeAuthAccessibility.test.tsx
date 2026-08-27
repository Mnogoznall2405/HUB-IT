import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

const mockLogin = jest.fn();

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    biometricEnabled: false,
    login: mockLogin,
    hasPermission: () => false,
    unlockWithBiometrics: jest.fn(),
    user: null,
  }),
}));

import LoginScreen from '../../app/(auth)/login';

it('exposes a heading and identifies the first missing login field', async () => {
  const screen = await render(<LoginScreen />);

  expect(screen.getByRole('header', { name: 'HUB-IT' })).toBeTruthy();
  await fireEvent.press(screen.getByText('Войти'));
  expect(screen.getByRole('alert')).toHaveTextContent('Введите логин');

  const fields = screen.getAllByTestId('text-input-outlined');
  expect(fields[0].props.accessibilityHint).toBe('Поле обязательно для входа');

  await fireEvent.changeText(fields[0], 'mobile-user');
  await fireEvent.press(screen.getByText('Войти'));
  expect(screen.getByRole('alert')).toHaveTextContent('Введите пароль');
  expect(screen.getAllByTestId('text-input-outlined')[1].props.accessibilityHint)
    .toBe('Поле обязательно для входа');
  expect(mockLogin).not.toHaveBeenCalled();
});
