import {
  isDesktopNotificationAvailable,
  showDesktopNotification,
} from './desktopBridge';
import { createSystemNotificationEnvelope } from './systemNotificationEnvelope';

export const SYSTEM_NOTIFICATION_DELIVERED_KEY = 'itinvent_system_notification_delivered_v1';

const pendingNativeIds = new Set();
const STORAGE_VERSION = 1;
const MAXIMUM_DELIVERED_IDS = 300;
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

function readDeliveredIds() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SYSTEM_NOTIFICATION_DELIVERED_KEY) || 'null');
    if (
      !parsed
      || parsed.version !== STORAGE_VERSION
      || !Array.isArray(parsed.ids)
      || Object.keys(parsed).some((key) => key !== 'version' && key !== 'ids')
    ) return [];
    return parsed.ids
      .filter((id) => typeof id === 'string' && id.length <= 128 && ID_PATTERN.test(id))
      .slice(-MAXIMUM_DELIVERED_IDS);
  } catch {
    return [];
  }
}

function persistDeliveredIds(ids) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(SYSTEM_NOTIFICATION_DELIVERED_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      ids: ids.slice(-MAXIMUM_DELIVERED_IDS),
    }));
    return true;
  } catch {
    return false;
  }
}

export function hasDeliveredSystemNotification(id) {
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  return Boolean(normalizedId) && readDeliveredIds().includes(normalizedId);
}

export function markSystemNotificationDelivered(id) {
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  if (!normalizedId || normalizedId.length > 128 || !ID_PATTERN.test(normalizedId)) return false;
  const ids = readDeliveredIds();
  if (ids.includes(normalizedId)) return false;
  ids.push(normalizedId);
  return persistDeliveredIds(ids);
}

function canShowBrowserNotification() {
  return typeof window !== 'undefined'
    && typeof window.Notification === 'function'
    && window.Notification.permission === 'granted';
}

export function routeSystemNotification(value, { onNavigate, source } = {}) {
  const envelope = createSystemNotificationEnvelope(value);
  if (!envelope || hasDeliveredSystemNotification(envelope.id) || pendingNativeIds.has(envelope.id)) return null;

  if (isDesktopNotificationAvailable()) {
    pendingNativeIds.add(envelope.id);
    const posted = showDesktopNotification({
      id: envelope.id,
      title: envelope.title,
      body: envelope.body,
      route: envelope.route,
      onResult: (accepted) => {
        pendingNativeIds.delete(envelope.id);
        if (accepted) markSystemNotificationDelivered(envelope.id);
      },
    });
    if (posted) return { delivery: 'desktop', id: envelope.id };
    pendingNativeIds.delete(envelope.id);
  }

  if (!canShowBrowserNotification()) return null;

  try {
    const notification = new window.Notification(envelope.title, {
      body: envelope.body,
      tag: envelope.id,
      renotify: false,
    });
    markSystemNotificationDelivered(envelope.id);
    notification.onclick = () => {
      try {
        notification.close?.();
      } catch {
        // Browser notification cleanup is best-effort.
      }
      try {
        window.focus?.();
      } catch {
        // Some browser contexts do not permit programmatic focus.
      }
      if (typeof onNavigate === 'function') {
        onNavigate(envelope.route, source);
      }
    };
    return { delivery: 'browser', id: envelope.id, notification };
  } catch {
    return null;
  }
}
