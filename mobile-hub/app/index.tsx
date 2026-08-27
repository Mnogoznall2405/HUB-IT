import { Redirect } from 'expo-router';
import { Platform } from 'react-native';
import { BrandedLoader } from '../src/components/ui/BrandedLoader';
import { useAuth } from '../src/auth/AuthContext';
import { filterNavItems, firstNavRoute } from '../src/navigation/navItems';
import { postAuthDestination } from '../src/navigation/postAuthDestination';
import { needsNativeAboutOnboarding } from '../src/auth/nativeAuthGuard';

export default function Index() {
  const { user, loading, loginChallengeId, hasPermission } = useAuth();

  if (loading) return <BrandedLoader />;
  if (loginChallengeId === 'setup') return <Redirect href="/(auth)/setup-required" />;
  if (loginChallengeId) return <Redirect href="/(auth)/two-factor" />;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (needsNativeAboutOnboarding(user)) return <Redirect href="/(auth)/about-onboarding" />;

  const home = firstNavRoute(filterNavItems(hasPermission, user.role));
  return <Redirect href={postAuthDestination(Platform.OS, home) as never} />;
}
