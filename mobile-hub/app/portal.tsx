import { Redirect, useLocalSearchParams } from 'expo-router';
import { hrefForPortalPath } from '../src/navigation/moduleRegistry';

/** Compatibility redirect for links created by older mobile releases. */
export default function LegacyPortalRedirect() {
  const params = useLocalSearchParams<{ path?: string | string[] }>();
  const path = Array.isArray(params.path) ? params.path[0] : params.path;
  return <Redirect href={hrefForPortalPath(path || '/dashboard') as never} />;
}
