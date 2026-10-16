import { Directory, File, Paths } from 'expo-file-system';
import { addNativeSnapshotClearListener } from '../cache/nativeSnapshotCache';

// Очередь фото, которые ещё не дошли до сервера. Живёт на диске приложения, чтобы
// снимки со сканера не пропали, если приложение закрыли или система его выгрузила.
// Каждому снимку сохраняется своя копия: кэш камеры система может чистить.

const DIRECTORY_NAME = 'hubit-photo-uploads';
const INDEX_FILE_NAME = 'queue.json';

export type PendingPhoto = {
  id: string;
  itemId: number;
  databaseId: string;
  invNo: string;
  file: { uri: string; name: string; mimeType: string };
};

function directory(): Directory {
  const dir = new Directory(Paths.document, DIRECTORY_NAME);
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function indexFile(): File {
  return new File(directory(), INDEX_FILE_NAME);
}

function readIndex(): PendingPhoto[] {
  try {
    const file = indexFile();
    if (!file.exists) return [];
    const parsed = JSON.parse(file.textSync());
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.id && entry.file?.uri) : [];
  } catch {
    return [];
  }
}

// Записи меняются строго по очереди: параллельные read-modify-write потеряли бы снимок.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => T): Promise<T> {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
}

function writeIndex(entries: PendingPhoto[]): void {
  const file = indexFile();
  if (!file.exists) file.create({ intermediates: true });
  file.write(JSON.stringify(entries));
}

export function persistPendingPhoto(entry: Omit<PendingPhoto, 'file'> & {
  file: { uri: string; name: string; mimeType: string };
}): Promise<PendingPhoto | null> {
  ensureClearListener();
  return serialized(() => {
    try {
      const extension = /\.([A-Za-z0-9]{2,5})$/.exec(entry.file.name)?.[1] || 'jpg';
      const copy = new File(directory(), `${entry.id}.${extension}`);
      new File(entry.file.uri).copy(copy);
      const stored: PendingPhoto = { ...entry, file: { ...entry.file, uri: copy.uri } };
      writeIndex([...readIndex().filter((item) => item.id !== entry.id), stored]);
      return stored;
    } catch {
      // Нет места или файла: загрузка идёт как обычно, просто без защиты от перезапуска.
      return null;
    }
  });
}

export function removePendingPhoto(id: string): Promise<void> {
  return serialized(() => {
    try {
      const entries = readIndex();
      const target = entries.find((item) => item.id === id);
      writeIndex(entries.filter((item) => item.id !== id));
      if (target) {
        const copy = new File(target.file.uri);
        if (copy.exists) copy.delete();
      }
    } catch {
      // Лишняя запись не страшна: сервер не создаст дубль, повторная загрузка вернёт то же фото.
    }
  });
}

export function loadPendingPhotos(): Promise<PendingPhoto[]> {
  return serialized(() => readIndex().filter((entry) => new File(entry.file.uri).exists));
}

export function clearPendingPhotos(): Promise<void> {
  return serialized(() => {
    try {
      const dir = new Directory(Paths.document, DIRECTORY_NAME);
      if (dir.exists) dir.delete();
    } catch {
      // Каталога может не быть.
    }
  });
}

// Выход из учётной записи: чужие неотправленные снимки не должны уйти под следующим пользователем.
// Подписка ставится при первой записи, а не при загрузке модуля.
let clearListenerInstalled = false;
function ensureClearListener(): void {
  if (clearListenerInstalled) return;
  try {
    addNativeSnapshotClearListener(() => { void clearPendingPhotos(); });
    clearListenerInstalled = true;
  } catch {
    // Без подписки снимки остаются в очереди — не страшнее, чем потерять их.
  }
}
