import { Redirect } from 'expo-router';
import { BrandedLoader } from '../src/components/ui/BrandedLoader';
import { useAuth } from '../src/auth/AuthContext';
import { filterNavItems, firstNavRoute } from '../src/navigation/navItems';

export default function Index() {
  const { user, loading, loginChallengeId, hasPermission } = useAuth();

  if (loading) return <BrandedLoader />;
  if (loginChallengeId === 'setup') return <Redirect href="/(auth)/setup-required" />;
  if (loginChallengeId) return <Redirect href="/(auth)/two-factor" />;
  if (!user) return <Redirect href="/(auth)/login" />;

  const home = firstNavRoute(filterNavItems(hasPermission, user.role));
  return <Redirect href={home as never} />;
}
