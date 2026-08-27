import { consumePendingPortalPath } from './systemIntent';
import { hrefForPortalPath, type NativeModuleHref } from './moduleRegistry';

export type PostAuthDestination = string | NativeModuleHref;

export function postAuthDestination(
  platform: string,
  webFallback: string,
): PostAuthDestination {
  if (platform !== 'web') {
    const pendingPath = consumePendingPortalPath();
    return hrefForPortalPath(pendingPath || '/dashboard');
  }
  return webFallback;
}
