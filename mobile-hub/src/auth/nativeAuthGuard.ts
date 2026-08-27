import type { HubUser } from '../api/types';

export type NativeAuthRedirect =
  | '/(auth)/login'
  | '/(auth)/setup-required'
  | '/(auth)/two-factor'
  | '/(auth)/about-onboarding'
  | null;

export function needsNativeAboutOnboarding(user: HubUser | null): boolean {
  return Boolean(
    user
    && Object.prototype.hasOwnProperty.call(user, 'about_onboarding_completed_at')
    && user.about_onboarding_completed_at === null,
  );
}

export function resolveNativeAuthRedirect({
  loading,
  user,
  loginChallengeId,
}: {
  loading: boolean;
  user: HubUser | null;
  loginChallengeId: string | null;
}): NativeAuthRedirect {
  if (loading) return null;
  if (loginChallengeId === 'setup') return '/(auth)/setup-required';
  if (loginChallengeId) return '/(auth)/two-factor';
  if (!user) return '/(auth)/login';
  if (needsNativeAboutOnboarding(user)) return '/(auth)/about-onboarding';
  return null;
}
