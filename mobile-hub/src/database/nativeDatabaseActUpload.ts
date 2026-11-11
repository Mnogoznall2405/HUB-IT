import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { UploadedActFile } from '../api/databaseApi';
import { sanitizeNativeFileName } from '../files/filePolicy';

export const NATIVE_DATABASE_ACT_MAX_BYTES = 15 * 1024 * 1024;

export function normalizeUploadedActInventoryInput(value: string): string[] {
  const result: string[] = [];
  String(value || '')
    .split(/[\s,;]+/g)
    .map((token) => token.trim().replace(/^№/, '').replace(/^[.,:|]+|[.,:|]+$/g, ''))
    .filter(Boolean)
    .forEach((token) => {
      const normalized = /^\d+[.,]0+$/.test(token) ? token.split(/[.,]/, 1)[0] : token;
      if (/^\d+$/.test(normalized)) {
        const invNo = String(Number.parseInt(normalized, 10));
        if (!result.includes(invNo)) result.push(invNo);
      }
    });
  return result;
}

export function validateNativeDatabaseActPdf(file: UploadedActFile): UploadedActFile {
  const name = sanitizeNativeFileName(file.name || 'act.pdf');
  const size = Math.max(0, Number(file.size || 0));
  if (!name.toLowerCase().endsWith('.pdf')) throw new Error('Поддерживается только PDF-файл акта');
  if (size <= 0) throw new Error('PDF-файл пустой или недоступен');
  if (size > NATIVE_DATABASE_ACT_MAX_BYTES) throw new Error('Размер PDF превышает 15 МБ');
  return { uri: file.uri, name, mimeType: 'application/pdf', size };
}

export async function pickNativeDatabaseActPdf(): Promise<UploadedActFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    copyToCacheDirectory: true,
    multiple: false,
    type: 'application/pdf',
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  const local = new File(asset.uri);
  if (!local.exists) throw new Error('Выбранный PDF-файл недоступен');
  return validateNativeDatabaseActPdf({
    uri: asset.uri,
    name: asset.name || local.name || 'act.pdf',
    mimeType: 'application/pdf',
    size: Number(asset.size || local.size || 0),
  });
}
