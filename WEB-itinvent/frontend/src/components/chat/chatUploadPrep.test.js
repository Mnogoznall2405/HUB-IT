import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('browser-image-compression', () => ({
  default: vi.fn(),
}));

vi.mock('fflate', () => ({
  gzip: vi.fn(),
}));

import imageCompression from 'browser-image-compression';
import { gzip } from 'fflate';

import { prepareChatUploadFile } from './chatUploadPrep';

const mockGzipWithDelta = (deltaBytes) => {
  gzip.mockImplementation((payload, _options, callback) => {
    const nextSize = Math.max(1, Number(payload?.byteLength || 0) + Number(deltaBytes || 0));
    callback(null, new Uint8Array(nextSize));
  });
};

describe('prepareChatUploadFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGzipWithDelta(32);
  });

  it('keeps ordinary images untouched by default for the fast upload path', async () => {
    const sourceFile = new File([new Uint8Array(2048)], 'photo.png', { type: 'image/png', lastModified: 1 });

    const prepared = await prepareChatUploadFile(sourceFile);

    expect(prepared.file).toBe(sourceFile);
    expect(prepared.transferFile).toBe(sourceFile);
    expect(prepared.transferEncoding).toBe('identity');
    expect(prepared.wasPrepared).toBe(false);
    expect(imageCompression).not.toHaveBeenCalled();
  });

  it('compresses photos above the default threshold without forcePrepare', async () => {
    const sourceFile = new File(['raw-image'], 'photo.jpg', { type: 'image/jpeg', lastModified: 6 });
    const compressedFile = new File(['compressed-image'], 'photo.jpg', { type: 'image/jpeg', lastModified: 6 });
    Object.defineProperty(sourceFile, 'size', { configurable: true, value: 2 * 1024 * 1024 });
    Object.defineProperty(compressedFile, 'size', { configurable: true, value: 400 * 1024 });
    imageCompression.mockResolvedValue(compressedFile);

    const prepared = await prepareChatUploadFile(sourceFile);

    expect(imageCompression).toHaveBeenCalledTimes(1);
    expect(prepared.wasPrepared).toBe(true);
    expect(prepared.imageWasPrepared).toBe(true);
    expect(prepared.transportWasPrepared).toBe(false);
    expect(prepared.file.size).toBeLessThan(sourceFile.size);
    expect(prepared.transferEncoding).toBe('identity');
  });

  it('skips animated GIF image recompression to preserve animation', async () => {
    const sourceFile = new File([new Uint8Array(512)], 'clip.gif', { type: 'image/gif', lastModified: 3 });

    const prepared = await prepareChatUploadFile(sourceFile, {
      forcePrepare: true,
    });

    expect(prepared.file).toBe(sourceFile);
    expect(prepared.wasPrepared).toBe(false);
    expect(prepared.skippedReason).toBe('animated-gif');
    expect(imageCompression).not.toHaveBeenCalled();
  });

  it('compresses large images with a bundled local worker url', async () => {
    const sourceFile = new File([new Uint8Array(2048)], 'photo.png', { type: 'image/png', lastModified: 1 });
    const compressedFile = new File([new Uint8Array(320)], 'photo.jpg', { type: 'image/jpeg', lastModified: 1 });
    imageCompression.mockResolvedValue(compressedFile);

    const prepared = await prepareChatUploadFile(sourceFile, {
      forcePrepare: true,
    });

    expect(imageCompression).toHaveBeenCalledTimes(1);
    const [calledFile, options] = imageCompression.mock.calls[0];
    expect(calledFile).toBe(sourceFile);
    expect(options).toEqual(expect.objectContaining({
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      initialQuality: 0.8,
      fileType: 'image/png',
    }));
    expect(options.libURL).toEqual(expect.any(String));
    expect(options.libURL).not.toMatch(/jsdelivr/i);
    expect(prepared.wasPrepared).toBe(true);
    expect(prepared.imageWasPrepared).toBe(true);
    expect(prepared.file.type).toBe('image/jpeg');
    expect(prepared.file.name).toBe('photo.jpg');
    expect(prepared.file.size).toBeLessThan(sourceFile.size);
  });

  it('applies transport gzip compression to non-image files when it reduces payload size', async () => {
    mockGzipWithDelta(-1024);
    const sourceFile = new File([new Uint8Array(2048)], 'report.pdf', { type: 'application/pdf', lastModified: 9 });

    const prepared = await prepareChatUploadFile(sourceFile);

    expect(imageCompression).not.toHaveBeenCalled();
    expect(prepared.file).toBe(sourceFile);
    expect(prepared.transferFile).not.toBe(sourceFile);
    expect(prepared.transferEncoding).toBe('gzip');
    expect(prepared.transportWasPrepared).toBe(true);
    expect(prepared.wasPrepared).toBe(true);
    expect(prepared.preparedSize).toBe(sourceFile.size);
    expect(prepared.transferSize).toBeLessThan(sourceFile.size);
  });

  it('does not apply transport gzip to images even when gzip would reduce payload size', async () => {
    mockGzipWithDelta(-1024);
    const sourceFile = new File([new Uint8Array(2048)], 'camera.jpg', { type: 'image/jpeg', lastModified: 11 });

    const prepared = await prepareChatUploadFile(sourceFile);

    expect(prepared.file).toBe(sourceFile);
    expect(prepared.transferFile).toBe(sourceFile);
    expect(prepared.transferEncoding).toBe('identity');
    expect(prepared.transportWasPrepared).toBe(false);
    expect(gzip).not.toHaveBeenCalled();
  });

  it('keeps the original transfer payload when gzip does not help', async () => {
    const sourceFile = new File([new Uint8Array(500)], 'scan.pdf', { type: 'application/pdf', lastModified: 4 });

    const prepared = await prepareChatUploadFile(sourceFile, {
      forcePrepare: true,
    });

    expect(prepared.file).toBe(sourceFile);
    expect(prepared.transferFile).toBe(sourceFile);
    expect(prepared.transferEncoding).toBe('identity');
    expect(prepared.wasPrepared).toBe(false);
  });

  it('skips archive payloads before any compression step', async () => {
    const sourceFile = new File([new Uint8Array(1024)], 'backup.zip', { type: 'application/zip', lastModified: 5 });

    const prepared = await prepareChatUploadFile(sourceFile, {
      forcePrepare: true,
    });

    expect(prepared.file).toBe(sourceFile);
    expect(prepared.transferFile).toBe(sourceFile);
    expect(prepared.skippedReason).toBe('archive');
    expect(imageCompression).not.toHaveBeenCalled();
    expect(gzip).not.toHaveBeenCalled();
  });

  it('falls back to the original file when image compression throws', async () => {
    const sourceFile = new File([new Uint8Array(1024)], 'broken.png', { type: 'image/png', lastModified: 5 });
    imageCompression.mockRejectedValue(new Error('compression failed'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const prepared = await prepareChatUploadFile(sourceFile, {
      forcePrepare: true,
    });

    expect(prepared.file).toBe(sourceFile);
    expect(prepared.transferFile).toBe(sourceFile);
    expect(prepared.wasPrepared).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
