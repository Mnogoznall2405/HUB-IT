import { resolveNativeAuthRedirect } from './nativeAuthGuard';

const user = {
  id: 7,
  username: 'mobile-user',
  role: 'viewer' as const,
  permissions: ['dashboard.read'],
};

it('redirects an expired native shell session to login', () => {
  expect(resolveNativeAuthRedirect({ loading: false, user: null, loginChallengeId: null }))
    .toBe('/(auth)/login');
});

it('keeps authenticated users inside the native shell', () => {
  expect(resolveNativeAuthRedirect({ loading: false, user, loginChallengeId: null })).toBeNull();
});

it('requires onboarding only for an explicit pending server flag', () => {
  expect(resolveNativeAuthRedirect({
    loading: false,
    user: { ...user, about_onboarding_completed_at: null },
    loginChallengeId: null,
  })).toBe('/(auth)/about-onboarding');
  expect(resolveNativeAuthRedirect({
    loading: false,
    user: { ...user, about_onboarding_completed_at: '2026-08-24T10:00:00Z' },
    loginChallengeId: null,
  })).toBeNull();
  expect(resolveNativeAuthRedirect({ loading: false, user, loginChallengeId: null })).toBeNull();
});

it('preserves the required two-factor route before opening the shell', () => {
  expect(resolveNativeAuthRedirect({ loading: false, user: null, loginChallengeId: 'setup' }))
    .toBe('/(auth)/setup-required');
  expect(resolveNativeAuthRedirect({ loading: false, user: null, loginChallengeId: 'challenge-1' }))
    .toBe('/(auth)/two-factor');
});
