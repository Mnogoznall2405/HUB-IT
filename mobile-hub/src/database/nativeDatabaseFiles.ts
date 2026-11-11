import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { API_V1_BASE } from '../api/config';
import { getSessionUserId } from '../auth/tokenStore';
import { downloadAuthenticatedFile } from '../files/authenticatedFileDownload';
import { sanitizeNativeFileName } from '../files/filePolicy';

function databaseCacheDirectory(): Directory {
  const directory = new Directory(Paths.document, 'hubit-database');
  directory.create({ intermediates: true, idempotent: true });
  return directory;
}

async function databaseCacheFile(fileName: string): Promise<File> {
  const userId = Number(await getSessionUserId());
  if (!Number.isInteger(userId) || userId <= 0) throw new Error('Сессия истекла. Войдите снова');
  return new File(databaseCacheDirectory(), `${userId}-${fileName}`);
}

export function clearNativeDatabaseFileCache(): void {
  for (const entry of databaseCacheDirectory().list()) entry.delete();
}

export function getNativeDatabaseFileCacheSize(): number {
  return databaseCacheDirectory().list().reduce((total, entry) => (
    entry instanceof File && entry.exists ? total + Math.max(0, Number(entry.size || 0)) : total
  ), 0);
}

export async function downloadEquipmentAct(
  docNo: number,
  options: { itemId?: number | null; invNo?: string; fileName?: string; databaseId?: string } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  if (!Number.isInteger(docNo) || docNo <= 0) throw new Error('Некорректный номер акта');
  const query = new URLSearchParams();
  if (options.itemId && Number.isInteger(options.itemId)) query.set('item_id', String(options.itemId));
  if (options.invNo) query.set('inv_no', String(options.invNo).trim());
  const suffix = query.toString();
  const sourceUrl = `${API_V1_BASE}/equipment/acts/${encodeURIComponent(String(docNo))}/file${suffix ? `?${suffix}` : ''}`;
  const fileName = sanitizeNativeFileName(options.fileName || `act-${docNo}.pdf`);
  const destination = await databaseCacheFile(`${docNo}-${fileName}`);
  if (destination.exists && destination.size > 0) return destination;
  if (destination.exists) destination.delete();

  try {
    return await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      headers: {
        ...(options.databaseId ? { 'X-Database-ID': String(options.databaseId).trim() } : {}),
      },
    });
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

function photoCacheExtension(fileName?: string): string {
  const normalized = String(fileName || '').trim().toLowerCase();
  const match = normalized.match(/\.(jpe?g|png|gif|webp|bmp)$/);
  return match ? match[0] : '.jpg';
}

// После поворота на сервере кэшированные файлы фото (полное и миниатюра) устарели.
export function invalidateEquipmentPhotoCache(itemId: number, fileNo: number): void {
  const marker = `-photo-${itemId}-${fileNo}`;
  try {
    for (const entry of databaseCacheDirectory().list()) {
      const name = String(entry.name || '');
      if (name.includes(`${marker}.`) || name.includes(`${marker}-thumb.`)) entry.delete();
    }
  } catch {
    // Кэш — только оптимизация: не удалось почистить, повторное скачивание перезапишет файл.
  }
}

export async function downloadEquipmentPhoto(
  itemId: number,
  fileNo: number,
  options: { thumb?: boolean; fileName?: string; databaseId?: string; rev?: number } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(fileNo) || fileNo <= 0) {
    throw new Error('Некорректный идентификатор фото');
  }
  const thumb = Boolean(options.thumb);
  const sourceUrl = `${API_V1_BASE}/equipment/${encodeURIComponent(String(itemId))}/photos/${encodeURIComponent(String(fileNo))}/content${thumb ? '?thumb=1' : ''}${options.rev && options.rev > 0 ? `${thumb ? '&' : '?'}v=${options.rev}` : ''}`;
  const destination = await databaseCacheFile(
    `photo-${itemId}-${fileNo}${thumb ? '-thumb' : ''}${photoCacheExtension(options.fileName)}`,
  );
  if (destination.exists && destination.size > 0) return destination;
  if (destination.exists) destination.delete();

  try {
    return await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      headers: {
        ...(options.databaseId ? { 'X-Database-ID': String(options.databaseId).trim() } : {}),
      },
    });
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}

export async function downloadGeneratedTransferAct(
  actId: string,
  options: { fileName?: string; fileType?: 'pdf' | 'docx'; databaseId?: string } = {},
): Promise<File> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Нативное скачивание доступно только в приложении');
  }
  const normalizedActId = String(actId || '').trim();
  if (!normalizedActId) throw new Error('Некорректный идентификатор акта');
  const sourceUrl = `${API_V1_BASE}/equipment/transfer/act/${encodeURIComponent(normalizedActId)}`;
  const extension = options.fileType === 'docx' ? 'docx' : 'pdf';
  const fileName = sanitizeNativeFileName(options.fileName || `transfer-${normalizedActId}.${extension}`);
  const destination = await databaseCacheFile(`${normalizedActId}-${fileName}`);
  if (destination.exists && destination.size > 0) return destination;
  if (destination.exists) destination.delete();

  try {
    return await downloadAuthenticatedFile(sourceUrl, destination, {
      idempotent: true,
      headers: {
        ...(options.databaseId ? { 'X-Database-ID': String(options.databaseId).trim() } : {}),
      },
    });
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  }
}
