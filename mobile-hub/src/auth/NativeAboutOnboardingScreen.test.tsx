import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import NativeAboutOnboardingScreen from '../../app/(auth)/about-onboarding';

const mockCompleteAboutOnboarding = jest.fn();

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ completeAboutOnboarding: mockCompleteAboutOnboarding }),
}));

jest.mock('../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'system' } }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCompleteAboutOnboarding.mockResolvedValue(undefined);
});

it('completes the required native onboarding before entering the shell', async () => {
  const view = await render(<NativeAboutOnboardingScreen />);
  expect(view.getByText('Добро пожаловать в HUB-IT')).toBeTruthy();
  await act(async () => {
    fireEvent.press(view.getByTestId('native-about-onboarding-complete'));
  });
  await waitFor(() => expect(mockCompleteAboutOnboarding).toHaveBeenCalledTimes(1));
  expect(router.replace).toHaveBeenCalledWith('/');
});
