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

function mergeChatWorkspaceParam(path: string, workspace: string): string {
  try {
    const parsed = new URL(path, 'https://hubit.invalid');
    if (parsed.origin !== 'https://hubit.invalid' || parsed.pathname !== '/chat') return path;
    parsed.searchParams.set('workspace', workspace);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return path;
  }
}

export function portalPathFromNotificationResponse(response: NotificationResponse): string {
  const data = notificationData(response);
  const workspace = String(data.conversation_kind || '').trim().toLowerCase() === 'ai' ? 'ai' : '';
  const route = String(data.route || '').trim();
  if (route) {
    const normalized = normalizeNativeRoutePath(route);
    return workspace ? mergeChatWorkspaceParam(normalized, workspace) : normalized;
  }

  const conversationId = String(data.conversation_id || data.conversationId || '').trim();
  if (conversationId) {
    return `/chat?conversation=${encodeURIComponent(conversationId)}${workspace ? `&workspace=${workspace}` : ''}`;
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
