import { Redirect, useLocalSearchParams } from 'expo-router';
import { hrefForPortalPath } from '../../src/navigation/moduleRegistry';

/**
 * Compatibility route for old APK links. The mobile application no longer
 * renders the HUB web portal; legacy links are reduced to the closest native
 * screen instead.
 */
export default function LegacyWebRouteRedirect() {
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const path = Array.isArray(params.path) ? params.path[0] : params.path;
  return <Redirect href={hrefForPortalPath(path || '/dashboard') as never} />;
}
