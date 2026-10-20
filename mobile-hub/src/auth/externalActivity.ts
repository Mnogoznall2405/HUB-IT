// Системная камера и выбор файла уводят приложение в фон на секунды. Блокировка по
// отпечатку не должна срабатывать после каждого снимка, поэтому такие запуски
// помечаются здесь, а AppLockGate читает отметку при уходе в фон.

// Если приложение «вернулось» из системной камеры позже этого срока, это уже обычный
// уход в фон и блокировка применяется как обычно.
export const EXTERNAL_ACTIVITY_GRACE_MS = 120_000;

let depth = 0;

export function beginExternalActivity(): () => void {
  depth += 1;
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    depth = Math.max(0, depth - 1);
  };
}

export function isExternalActivityActive(): boolean {
  return depth > 0;
}
