import * as SecureStore from 'expo-secure-store';
import type { ScanPhotoTarget } from './useNativeScanPhotoSession';

// Настройки и «закладка» режима быстрых фото, которые должны пережить перезапуск.

export type ScanCaptureMode = 'system' | 'scanner';

const MODE_KEY = 'hubit_scan_photo_capture_mode_v1';
const LAUNCH_KEY = 'hubit_scan_photo_camera_launch_v1';
// Системная камера, оставленная дольше, уже не относится к тому снимку.
const LAUNCH_MAX_AGE_MS = 15 * 60_000;

export async function readScanCaptureMode(): Promise<ScanCaptureMode> {
  try {
    return (await SecureStore.getItemAsync(MODE_KEY)) === 'scanner' ? 'scanner' : 'system';
  } catch {
    return 'system';
  }
}

export async function writeScanCaptureMode(mode: ScanCaptureMode): Promise<void> {
  try {
    await SecureStore.setItemAsync(MODE_KEY, mode);
  } catch {
    // Настройка необязательна: режим просто не запомнится.
  }
}

export type CameraLaunchRecord = {
  userId: number;
  target: ScanPhotoTarget;
  at: number;
};

// Перед запуском системной камеры запоминаем, к какой технике относится снимок: если
// Android выгрузит приложение, пока камера открыта, снимок не останется «ничьим».
export async function saveCameraLaunch(userId: number, target: ScanPhotoTarget): Promise<void> {
  try {
    const record: CameraLaunchRecord = { userId, target, at: Date.now() };
    await SecureStore.setItemAsync(LAUNCH_KEY, JSON.stringify(record));
  } catch {
    // Без закладки потеряется только случай «приложение убито во время съёмки».
  }
}

export async function clearCameraLaunch(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(LAUNCH_KEY);
  } catch {
    // ignore
  }
}

// Закладка забирается один раз: повторный запуск не должен вернуть тот же снимок.
export async function takeCameraLaunch(userId: number): Promise<CameraLaunchRecord | null> {
  try {
    const raw = await SecureStore.getItemAsync(LAUNCH_KEY);
    await clearCameraLaunch();
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<CameraLaunchRecord>;
    const target = value.target;
    if (
      Number(value.userId) !== userId
      || !target
      || !Number.isFinite(Number(target.itemId))
      || Number(target.itemId) <= 0
      || !target.invNo
      || Date.now() - Number(value.at || 0) > LAUNCH_MAX_AGE_MS
    ) return null;
    return { userId, target, at: Number(value.at) };
  } catch {
    return null;
  }
}
