import type { NotificationResponse } from 'expo-notifications';
import {
  hrefForPortalPath,
  routePathForPortalPath,
  type NativeModuleHref,
} from '../navigation/moduleRegistry';
import { rememberSystemIntentDestination } from '../navigation/systemIntent';
import { normalizeNativeRoutePath } from '../navigation/nativeRoutePath';

export type NotificationOpenHref = NativeModuleHref;

export function notificationData(response: NotificationResponse): Record<string, unknown> {
  const data = response?.notification?.request?.content?.data;
  return data && typeof data === 'object' ? data as Record<string, unknown> : {};
}

export function portalPathFromNotificationResponse(response: NotificationResponse): string {
  const data = notificationData(response);
  const route = String(data.route || '').trim();
  if (route) return normalizeNativeRoutePath(route);

  const conversationId = String(data.conversation_id || data.conversationId || '').trim();
  if (conversationId) {
    return `/chat?conversation=${encodeURIComponent(conversationId)}`;
  }

  return '/dashboard';
}

export function notificationOpenHrefFromResponse(response: NotificationResponse): NotificationOpenHref {
  return hrefForPortalPath(portalPathFromNotificationResponse(response));
}

export function rememberNotificationDestination(response: NotificationResponse): void {
  rememberSystemIntentDestination(
    routePathForPortalPath(portalPathFromNotificationResponse(response)),
  );
}
