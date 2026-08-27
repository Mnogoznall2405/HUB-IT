export function parseNativeNotificationsEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function resolveNativeNotificationsEnabled(value: string | undefined): boolean {
  return value === undefined ? true : parseNativeNotificationsEnabled(value);
}

export const NATIVE_NOTIFICATIONS_ENABLED = resolveNativeNotificationsEnabled(
  process.env.EXPO_PUBLIC_NATIVE_NOTIFICATIONS_ENABLED,
);
