import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Linking } from 'react-native';
import { validateUploadBatch, validateUploadFile } from './filePolicy';

export type NativeAttachmentSource = 'camera' | 'gallery' | 'document' | 'voice' | 'gif';

export type NativePickedFile = {
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  source: NativeAttachmentSource;
};

export class NativeFilePermissionError extends Error {
  readonly canAskAgain: boolean;

  constructor(canAskAgain: boolean) {
    super('Для камеры нужно разрешение Android');
    this.name = 'NativeFilePermissionError';
    this.canAskAgain = canAskAgain;
  }
}

function normalizePickedFile(
  source: NativeAttachmentSource,
  uri: string,
  name: string,
  mimeType?: string | null,
  knownSize?: number | null,
): NativePickedFile {
  const localFile = new File(uri);
  const policy = validateUploadFile({
    name,
    mimeType: mimeType || localFile.type,
    size: Number(knownSize || localFile.size || 0),
  });
  return {
    uri,
    name: policy.name,
    mimeType: policy.mimeType || 'application/octet-stream',
    size: policy.size,
    source,
  };
}

export async function pickNativeAttachment(
  source: NativeAttachmentSource,
): Promise<NativePickedFile | null> {
  const files = await pickNativeAttachments(source);
  return files[0] || null;
}

export async function pickNativeAttachments(
  source: NativeAttachmentSource,
): Promise<NativePickedFile[]> {
  if (source === 'document') {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
      type: '*/*',
    });
    if (result.canceled) return [];
    return validateUploadBatch((result.assets || []).map((asset) => (
      normalizePickedFile(source, asset.uri, asset.name, asset.mimeType, asset.size)
    )));
  }

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new NativeFilePermissionError(Boolean(permission.canAskAgain));
  }
  const imageOptions: ImagePicker.ImagePickerOptions = {
    mediaTypes: source === 'gallery' ? ['images', 'videos'] : ['images'],
    quality: 0.85,
    allowsEditing: false,
    allowsMultipleSelection: source === 'gallery',
    selectionLimit: source === 'gallery' ? 5 : 1,
  };
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(imageOptions)
    : await ImagePicker.launchImageLibraryAsync(imageOptions);
  if (result.canceled) return [];
  return validateUploadBatch((result.assets || []).map((asset, index) => normalizePickedFile(
    source,
    asset.uri,
    asset.fileName || `${asset.type === 'video' ? 'video' : 'photo'}-${Date.now()}-${index + 1}.${asset.type === 'video' ? 'mp4' : 'jpg'}`,
    asset.mimeType || (asset.type === 'video' ? 'video/mp4' : 'image/jpeg'),
    asset.fileSize,
  )));
}

export async function openAppPermissionSettings(): Promise<void> {
  await Linking.openSettings();
}

function resolveUploadByteSize(file: NativePickedFile): number {
  const reported = Number(file.size || 0);
  try {
    const localSize = Number(new File(file.uri).size || 0);
    if (Number.isFinite(localSize) && localSize > 0) return localSize;
  } catch {
    // content:// / transient picker URIs may not expose size via File.
  }
  return Number.isFinite(reported) && reported > 0 ? reported : 0;
}

export function buildAttachmentFormData(
  file: NativePickedFile,
  options: {
    body?: string;
    clientMessageId?: string;
    replyToMessageId?: string;
    mediaKind?: 'image' | 'video' | 'file' | 'audio';
    durationSeconds?: number;
  } = {},
): FormData {
  return buildAttachmentsFormData([file], options);
}

export function buildAttachmentsFormData(
  files: NativePickedFile[],
  options: {
    body?: string;
    clientMessageId?: string;
    replyToMessageId?: string;
    mediaKind?: 'image' | 'video' | 'file' | 'audio';
    durationSeconds?: number;
  } = {},
): FormData {
  const formData = new FormData();
  const sizedFiles = files.map((file) => {
    const size = resolveUploadByteSize(file);
    return size > 0 && size !== Number(file.size || 0) ? { ...file, size } : file;
  });
  sizedFiles.forEach((file) => {
    formData.append('files', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType,
    } as unknown as Blob);
  });
  if (sizedFiles.length) {
    formData.append('files_meta_json', JSON.stringify(sizedFiles.map((file, index) => {
      const meta: Record<string, unknown> = {
        transfer_encoding: 'identity',
      };
      const mediaKind = options.mediaKind
        ? index === 0 ? options.mediaKind : undefined
        : file.source === 'document' ? 'file' : undefined;
      if (mediaKind) meta.media_kind = mediaKind;
      if (index === 0 && options.durationSeconds != null) {
        meta.duration_seconds = options.durationSeconds;
      }
      // Only send original_size when we actually know it. A stale picker size
      // after image edit makes the backend reject with size mismatch.
      if (Number(file.size || 0) > 0) meta.original_size = Number(file.size);
      return meta;
    })));
  }
  const body = String(options.body || '').trim();
  const clientMessageId = String(options.clientMessageId || '').trim();
  const replyToMessageId = String(options.replyToMessageId || '').trim();
  if (body) formData.append('body', body);
  if (clientMessageId) formData.append('client_message_id', clientMessageId);
  if (replyToMessageId) formData.append('reply_to_message_id', replyToMessageId);
  return formData;
}
