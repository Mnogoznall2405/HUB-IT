import { render } from '@testing-library/react-native';
import React from 'react';

const mockCheckForUpdate = jest.fn(async () => undefined);

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    logout: jest.fn(async () => undefined),
    user: { id: 7, username: 'test-user' },
  }),
}));

jest.mock('./useReducedMotion', () => ({
  useReducedMotion: () => true,
}));

jest.mock('../updates/useMobileUpdater', () => ({
  useMobileUpdater: () => ({
    state: {
      status: 'downloading',
      currentVersion: '1.1.5',
      currentBuild: '7',
      feed: {
        version: '1.1.6',
        versionCode: 8,
        sizeBytes: 48_000_000,
        changelog: ['Улучшена доступность'],
      },
      progress: 0.42,
      message: 'Загружаем обновление…',
      canOpenInstallerSettings: false,
      required: true,
    },
    checkForUpdate: mockCheckForUpdate,
    installUpdate: jest.fn(async () => undefined),
    openInstallerSettings: jest.fn(async () => undefined),
  }),
}));

import { MobileUpdateGate } from '../updates/MobileUpdateGate';

it('keeps mandatory update actions scrollable and exposes semantic progress', async () => {
  const screen = await render(<MobileUpdateGate />);

  expect(screen.getByTestId('mobile-update-scroll')).toBeTruthy();
  expect(screen.getByRole('header', { name: 'Нужно обновить HUB-IT' })).toBeTruthy();
  const progress = screen.getByRole('progressbar', { name: 'Загрузка обновления' });
  expect(progress.props.accessibilityValue).toEqual({
    min: 0,
    max: 100,
    now: 42,
    text: '42 процентов',
  });
});
