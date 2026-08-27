import { Directory } from 'expo-file-system';
import type { MailAttachment } from '../api/mailApi';
import { sanitizeNativeFileName } from '../files/filePolicy';
import { resolveNativeMailAttachmentMimeType } from './nativeMailAttachmentVisual';
import { downloadMailAttachment } from './nativeMailFiles';

export type NativeMailAttachmentSaveResult = {
  cancelled: boolean;
  directoryName: string;
  saved: string[];
  failed: Array<{ name: string; reason: string }>;
};

function uniqueFileName(value: unknown, usedNames: Set<string>): string {
  const safeName = sanitizeNativeFileName(String(value || 'mail-file'));
  const extensionIndex = safeName.lastIndexOf('.');
  const hasExtension = extensionIndex > 0 && extensionIndex < safeName.length - 1;
  const base = hasExtension ? safeName.slice(0, extensionIndex) : safeName;
  const extension = hasExtension ? safeName.slice(extensionIndex) : '';
  let candidate = safeName;
  let suffix = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${base} (${suffix})${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

function isDirectoryPickerCancellation(error: unknown): boolean {
  const message = String(error instanceof Error ? error.message : error || '').toLocaleLowerCase();
  return message.includes('picker was cancelled') || message.includes('picker was canceled');
}

export async function saveNativeMailAttachmentsToDirectory(
  messageId: string,
  mailboxId: string,
  attachments: MailAttachment[],
): Promise<NativeMailAttachmentSaveResult> {
  const downloadable = attachments.filter((attachment) => attachment.downloadable !== false);
  if (!downloadable.length) throw new Error('В письме нет вложений, доступных для сохранения');
  let directory: Directory;
  try {
    directory = await Directory.pickDirectoryAsync();
  } catch (error) {
    if (isDirectoryPickerCancellation(error)) {
      return { cancelled: true, directoryName: '', saved: [], failed: [] };
    }
    throw error;
  }

  const usedNames = new Set(directory.list().map((entry) => entry.name.toLocaleLowerCase()));
  const result: NativeMailAttachmentSaveResult = {
    cancelled: false,
    directoryName: directory.name || 'выбранная папка',
    saved: [],
    failed: [],
  };
  for (const attachment of downloadable) {
    const name = uniqueFileName(attachment.name, usedNames);
    let destination: ReturnType<Directory['createFile']> | null = null;
    try {
      const source = await downloadMailAttachment(messageId, mailboxId, attachment);
      destination = directory.createFile(name, resolveNativeMailAttachmentMimeType(attachment, source.type));
      await source.copy(destination, { overwrite: true });
      result.saved.push(name);
    } catch (error) {
      if (destination?.exists) destination.delete();
      result.failed.push({
        name,
        reason: String(error instanceof Error ? error.message : error || 'Неизвестная ошибка'),
      });
    }
  }
  return result;
}
