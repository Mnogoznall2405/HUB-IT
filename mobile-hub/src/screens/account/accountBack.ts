import { router } from 'expo-router';

export function goBackOrReplace(fallbackHref: string): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallbackHref as never);
}
