import { Platform } from 'react-native';
import HubitShareIntentModule from '../../modules/hubit-share-intent';
import {
  clearQueuedIncomingShareForTests,
  consumeIncomingShare,
  copyIncomingShareFiles,
  normalizeIncomingTextShare,
  queueIncomingShare,
} from './incomingShare';

jest.mock('../../modules/hubit-share-intent', () => ({
  __esModule: true,
  default: {
    getPendingShareAsync: jest.fn(),
    copySharedFilesAsync: jest.fn(),
    discardSharedFilesAsync: jest.fn(async () => undefined),
    addListener: jest.fn(),
  },
}));

const share = {
  id: 'share-1',
  text: 'https://example.com/report',
  subject: 'Отчёт',
  mimeType: 'text/plain',
  receivedAt: 1_787_400_000_000,
};

beforeEach(clearQueuedIncomingShareForTests);

it('accepts bounded plain-text shares and rejects unsafe payloads', () => {
  expect(normalizeIncomingTextShare(share)).toEqual(share);
  expect(normalizeIncomingTextShare({ ...share, mimeType: 'application/octet-stream' })).toBeNull();
  expect(normalizeIncomingTextShare({ ...share, text: '' })).toBeNull();
  expect(normalizeIncomingTextShare({ ...share, id: '' })).toBeNull();
});

it('passes an incoming share to the selected native composer exactly once', () => {
  queueIncomingShare(share, 'task');
  expect(consumeIncomingShare('mail')).toBeNull();
  expect(consumeIncomingShare('task')).toEqual({ ...share, target: 'task' });
  expect(consumeIncomingShare('task')).toBeNull();
});

describe('file shares (photos and documents from other apps)', () => {
  const fileShare = {
    ...share,
    text: '',
    mimeType: 'image/jpeg',
    files: [
      { name: 'IMG_0001.jpg', mimeType: 'image/jpeg', size: 2_400_000 },
      { name: 'Отчёт.pdf', mimeType: 'application/pdf', size: 150_000 },
    ],
  };

  it('accepts a share that carries files and no text, with any MIME type', () => {
    expect(normalizeIncomingTextShare(fileShare)).toEqual(fileShare);
    expect(normalizeIncomingTextShare({ ...fileShare, files: [] })).toBeNull();
  });

  it('bounds the number of files and cleans their names', () => {
    const many = Array.from({ length: 25 }, (_, index) => ({ name: `a/b:${index}.txt`, mimeType: 'text/plain', size: 10 }));
    const normalized = normalizeIncomingTextShare({ ...fileShare, files: many });
    expect(normalized?.files).toHaveLength(10);
    expect(normalized?.files?.[0].name).toBe('a_b_0.txt');
  });

  it('hands a chat share only to the conversation it was addressed to, once', () => {
    queueIncomingShare(fileShare, 'chat', {
      conversationId: 'chat-7',
      copiedFiles: [{ uri: 'file:///cache/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 10, source: 'gallery' }],
    });
    expect(consumeIncomingShare('chat', 'chat-8')).toBeNull();
    expect(consumeIncomingShare('mail')).toBeNull();
    expect(consumeIncomingShare('chat', 'chat-7')?.copiedFiles).toHaveLength(1);
    expect(consumeIncomingShare('chat', 'chat-7')).toBeNull();
  });

  describe('copying into the app cache', () => {
    const native = HubitShareIntentModule as unknown as { copySharedFilesAsync: jest.Mock };
    beforeEach(() => { jest.replaceProperty(Platform, 'OS', 'android'); });
    afterEach(() => jest.restoreAllMocks());

    it('keeps usable files, marks images as gallery items, and drops blocked or empty ones', async () => {
      native.copySharedFilesAsync.mockResolvedValueOnce([
        { uri: 'file:///cache/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg', size: 1000 },
        { uri: 'file:///cache/b.pdf', name: 'b.pdf', mimeType: 'application/pdf', size: 2000 },
        { uri: 'file:///cache/virus.exe', name: 'virus.exe', mimeType: 'application/x-msdownload', size: 3000 },
        { uri: 'file:///cache/empty.txt', name: 'empty.txt', mimeType: 'text/plain', size: 0 },
        { uri: 'content://other.app/secret', name: 'x.jpg', mimeType: 'image/jpeg', size: 10 },
      ]);
      const files = await copyIncomingShareFiles(fileShare);
      expect(files.map((file) => [file.name, file.source])).toEqual([['a.jpg', 'gallery'], ['b.pdf', 'document']]);
    });

    it('does nothing for a text-only share', async () => {
      expect(await copyIncomingShareFiles(share)).toEqual([]);
      expect(native.copySharedFilesAsync).not.toHaveBeenCalled();
    });
  });
});
