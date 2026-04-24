/**
 * Chat upload preparation pipeline.
 *
 * Stages:
 * 1. Optional image compression for large photos.
 * 2. Optional transport gzip compression for upload payloads.
 */
import { gzip } from 'fflate';
import imageCompression from 'browser-image-compression';
import imageCompressionWorkerUrl from 'browser-image-compression/dist/browser-image-compression.js?url';

import { isArchiveFile } from './chatHelpers';

const CHAT_IMAGE_MAX_DIMENSION = 1920;
const CHAT_IMAGE_QUALITY = 0.8;
const CHAT_PREPARE_ABOVE_BYTES_DEFAULT = 1 * 1024 * 1024;
const CHAT_TRANSPORT_GZIP_LEVEL = 6;
const CHAT_IMAGE_COMPRESSION_WORKER_URL = String(imageCompressionWorkerUrl || '').trim();

const replaceFileExtension = (fileName, nextExtension) => {
  const normalized = String(fileName || '').trim() || 'image';
  const baseName = normalized.replace(/\.[^.]+$/, '') || 'image';
  return `${baseName}.${nextExtension}`;
};

const getFileExtension = (fileName) => {
  const normalized = String(fileName || '').trim();
  if (!normalized.includes('.')) return '';
  return normalized.split('.').pop()?.toLowerCase() || '';
};

const buildChatUploadSignature = (file) => {
  if (!file) return '';
  return `${String(file?.name || '').trim()}:${Number(file?.size || 0)}:${Number(file?.lastModified || 0)}:${String(file?.type || '').trim()}`;
};

const normalizePreparedItem = (sourceFile, overrides = {}) => {
  const preparedFile = overrides.file || sourceFile || null;
  const transferFile = overrides.transferFile || preparedFile || null;
  const originalSize = Number(overrides.originalSize ?? sourceFile?.size ?? 0);
  const preparedSize = Number(overrides.preparedSize ?? preparedFile?.size ?? 0);
  const transferSize = Number(overrides.transferSize ?? transferFile?.size ?? preparedSize ?? 0);

  return {
    signature: buildChatUploadSignature(sourceFile || preparedFile),
    file: preparedFile,
    transferFile,
    originalSize,
    preparedSize,
    transferSize,
    finalSize: Number(overrides.finalSize ?? transferSize),
    transferEncoding: String(overrides.transferEncoding || 'identity').trim() || 'identity',
    wasPrepared: false,
    imageWasPrepared: false,
    transportWasPrepared: false,
    changedFormat: false,
    skippedReason: '',
    ...overrides,
  };
};

const isImageFile = (file) => String(file?.type || '').toLowerCase().startsWith('image/');

const isVideoFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  return mimeType.startsWith('video/');
};

const isMediaFile = (file) => isImageFile(file) || isVideoFile(file);

const isGifFile = (file) => {
  const mimeType = String(file?.type || '').toLowerCase();
  return mimeType === 'image/gif' || getFileExtension(file?.name) === 'gif';
};

const detectAnimatedGif = async (file) => {
  try {
    // browser-image-compression handles animated GIFs gracefully,
    // but we skip image recompression to preserve animation.
    if (isGifFile(file)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

const gzipBytesAsync = (payload, options = {}) => new Promise((resolve, reject) => {
  gzip(
    payload,
    {
      level: Math.max(0, Math.min(9, Number(options.level ?? CHAT_TRANSPORT_GZIP_LEVEL))),
    },
    (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data);
    },
  );
});

const readFileBytes = async (file) => {
  if (file && typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  if (typeof Response === 'function') {
    const response = new Response(file);
    return new Uint8Array(await response.arrayBuffer());
  }
  if (typeof FileReader !== 'undefined') {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new TypeError('Failed to read file payload'));
      reader.onload = () => resolve(new Uint8Array(reader.result || new ArrayBuffer(0)));
      reader.readAsArrayBuffer(file);
    });
  }
  throw new TypeError('File arrayBuffer is not supported in this environment');
};

const buildTransportCompressedFile = async (file, options = {}) => {
  if (!file || options.disableTransportCompression || isMediaFile(file)) {
    return null;
  }

  const payload = await readFileBytes(file);
  if (payload.byteLength <= 0) {
    return null;
  }

  const compressedPayload = await gzipBytesAsync(payload, {
    level: options.transportCompressionLevel,
  });
  if (!(compressedPayload instanceof Uint8Array) || compressedPayload.byteLength <= 0) {
    return null;
  }
  if (compressedPayload.byteLength >= payload.byteLength) {
    return null;
  }

  return new File([compressedPayload], String(file.name || 'file.bin').trim() || 'file.bin', {
    // Preserve the logical mime type; transfer encoding is carried separately.
    type: file.type || 'application/octet-stream',
    lastModified: Number(file.lastModified || Date.now()),
  });
};

export { buildChatUploadSignature };

export const prepareChatUploadFile = async (file, options = {}) => {
  const originalItem = normalizePreparedItem(file);
  if (!file) {
    return originalItem;
  }
  if (isArchiveFile(file)) {
    return normalizePreparedItem(file, { skippedReason: 'archive' });
  }

  let preparedFile = file;
  let imageWasPrepared = false;
  let changedFormat = false;
  let skippedReason = '';

  if (isImageFile(file) && !isVideoFile(file)) {
    const isAnimated = await detectAnimatedGif(file);
    if (isAnimated) {
      skippedReason = 'animated-gif';
    } else {
      const prepareAboveBytes = Math.max(0, Number(options.prepareAboveBytes ?? CHAT_PREPARE_ABOVE_BYTES_DEFAULT));
      if (options.forcePrepare || Number(file?.size || 0) > prepareAboveBytes) {
        try {
          const compressedFile = await imageCompression(file, {
            maxSizeMB: (options.maxSizeMB ?? undefined),
            maxWidthOrHeight: options.maxDimension || CHAT_IMAGE_MAX_DIMENSION,
            useWebWorker: true,
            initialQuality: options.quality || CHAT_IMAGE_QUALITY,
            libURL: options.libURL || CHAT_IMAGE_COMPRESSION_WORKER_URL || undefined,
            fileType: file.type,
          });

          if (compressedFile.size > 0 && compressedFile.size < Number(file?.size || 0)) {
            const ext = getFileExtension(compressedFile.name) || getFileExtension(file.name);
            preparedFile = new File([compressedFile], replaceFileExtension(file.name, ext), {
              type: compressedFile.type || file.type,
              lastModified: file.lastModified,
            });
            imageWasPrepared = true;
            changedFormat = preparedFile.type !== file.type || preparedFile.name !== file.name;
          }
        } catch (error) {
          console.warn('Image compression failed, using original:', error);
        }
      }
    }
  }

  let transferFile = preparedFile;
  let transferEncoding = 'identity';
  let transportWasPrepared = false;
  try {
    const compressedTransportFile = await buildTransportCompressedFile(preparedFile, options);
    if (compressedTransportFile && Number(compressedTransportFile.size || 0) < Number(preparedFile?.size || 0)) {
      transferFile = compressedTransportFile;
      transferEncoding = 'gzip';
      transportWasPrepared = true;
    }
  } catch (error) {
    console.warn('Transport compression failed, using original payload:', error);
  }

  return normalizePreparedItem(file, {
    file: preparedFile,
    preparedSize: Number(preparedFile?.size || 0),
    transferFile,
    transferSize: Number(transferFile?.size || preparedFile?.size || 0),
    finalSize: Number(transferFile?.size || preparedFile?.size || 0),
    transferEncoding,
    wasPrepared: imageWasPrepared || transportWasPrepared,
    imageWasPrepared,
    transportWasPrepared,
    changedFormat,
    skippedReason,
  });
};

export const prepareChatUploadFiles = async (files, options = {}) => {
  const source = Array.isArray(files) ? files.filter(Boolean) : [];
  const items = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = await prepareChatUploadFile(source[index], options);
    items.push(item);

    if (typeof options.onProgress === 'function') {
      options.onProgress({
        completed: index + 1,
        total: source.length,
        item,
      });
    }
  }

  const originalTotalBytes = items.reduce((sum, item) => sum + Number(item?.originalSize || 0), 0);
  const finalTotalBytes = items.reduce((sum, item) => sum + Number(item?.finalSize || item?.transferSize || 0), 0);
  const compressedCount = items.reduce(
    (sum, item) => sum + (Number(item?.finalSize || item?.transferSize || 0) < Number(item?.originalSize || 0) ? 1 : 0),
    0,
  );

  return {
    items,
    count: items.length,
    originalTotalBytes,
    finalTotalBytes,
    savedBytes: Math.max(0, originalTotalBytes - finalTotalBytes),
    compressedCount,
  };
};

export const summarizePreparedChatUploadItems = (items) => {
  const source = Array.isArray(items) ? items : [];
  const originalTotalBytes = source.reduce((sum, item) => sum + Number(item?.originalSize || item?.file?.size || 0), 0);
  const finalTotalBytes = source.reduce((sum, item) => sum + Number(item?.finalSize || item?.transferSize || item?.file?.size || 0), 0);
  const savedBytes = Math.max(0, originalTotalBytes - finalTotalBytes);
  const compressedCount = source.reduce(
    (sum, item) => sum + (Number(item?.finalSize || item?.transferSize || item?.file?.size || 0) < Number(item?.originalSize || item?.file?.size || 0) ? 1 : 0),
    0,
  );
  return {
    count: source.length,
    originalTotalBytes,
    finalTotalBytes,
    savedBytes,
    compressedCount,
  };
};
