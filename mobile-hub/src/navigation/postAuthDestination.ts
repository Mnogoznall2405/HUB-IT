import { consumePendingPortalPath } from './systemIntent';
import { hrefForPortalPath, type NativeModuleHref } from './moduleRegistry';

export type PostAuthDestination = string | NativeModuleHref;

export function postAuthDestination(
  platform: string,
  webFallback: string,
): PostAuthDestination {
  if (platform !== 'web') {
    const pendingPath = consumePendingPortalPath();
    // `webFallback` is the user's home route: chats when they are available.
    return hrefForPortalPath(pendingPath || (webFallback === '/(shell)/chat' ? '/chat' : '/dashboard'));
  }
  return webFallback;
}
