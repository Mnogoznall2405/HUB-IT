import { isCapacitorNativeRuntime } from './useWebAuthnAvailability';

export function getHubitPermissionsPlugin() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.Capacitor?.Plugins?.HubitPermissions ?? null;
}

export async function ensureNativeCameraPermission() {
  if (!isCapacitorNativeRuntime()) {
    return true;
  }

  const plugin = getHubitPermissionsPlugin();
  if (!plugin) {
    throw new Error('CameraPermissionPluginMissing');
  }

  try {
    if (typeof plugin.checkCamera === 'function') {
      const initial = await plugin.checkCamera();
      if (initial?.granted) {
        return true;
      }
    }

    if (typeof plugin.requestCamera !== 'function') {
      throw new Error('CameraPermissionPluginMissing');
    }

    await plugin.requestCamera();

    if (typeof plugin.checkCamera === 'function') {
      const verified = await plugin.checkCamera();
      if (!verified?.granted) {
        throw new Error('CameraPermissionDenied');
      }
    }

    return true;
  } catch (error) {
    const message = String(error?.message || error || '').trim();
    const code = String(error?.code || '').trim();
    const denied = (
      code === 'NOT_ALLOWED'
      || message === 'CameraPermissionDenied'
      || /permission denied|notallowed/i.test(message)
    );
    if (denied) {
      throw new Error('CameraPermissionDenied');
    }
    throw error;
  }
}
