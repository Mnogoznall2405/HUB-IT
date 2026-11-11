import { describe, expect, it } from 'vitest';

import {
  resolveDocumentPreviewKind,
  sniffBytesKind,
} from './documentPreviewKind';

describe('sniffBytesKind', () => {
  it('detects PDF / image / OLE / ZIP signatures', () => {
    expect(sniffBytesKind(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('pdf');
    expect(sniffBytesKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(sniffBytesKind(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]))).toBe('ole');
    expect(sniffBytesKind(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]))).toBe('zip');
  });
});

describe('resolveDocumentPreviewKind', () => {
  it('prefers PDF sniff over generic content-type', () => {
    expect(resolveDocumentPreviewKind({
      contentType: 'application/octet-stream',
      fileName: 'act.bin',
      sniff: 'pdf',
    })).toEqual({ kind: 'pdf', error: '' });
  });

  it('rejects Word and OLE acts with a clear message', () => {
    const word = resolveDocumentPreviewKind({
      contentType: 'application/msword',
      fileName: 'act.doc',
    });
    expect(word.kind).toBe('unsupported');
    expect(word.error).toMatch(/Word/i);

    const ole = resolveDocumentPreviewKind({
      contentType: 'application/octet-stream',
      fileName: 'act.bin',
      sniff: 'ole',
    });
    expect(ole.kind).toBe('unsupported');
    expect(ole.error).toMatch(/Word|Office/i);
  });

  it('rejects images', () => {
    const image = resolveDocumentPreviewKind({
      contentType: 'image/jpeg',
      fileName: 'scan.jpg',
    });
    expect(image.kind).toBe('unsupported');
    expect(image.error).toMatch(/изображение/i);
  });
});
