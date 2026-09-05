import { File } from 'expo-file-system';
import type { MyFileRecord } from '../api/myFilesApi';
import {
  clearNativeMyFilesOffline,
  getNativeMyFilesOfflineFile,
  getNativeMyFilesOfflineIds,
  pinNativeMyFileOffline,
  removeNativeMyFileOffline,
} from './nativeMyFilesOfflineStore';

const mockFiles = new Map<string, number>();
const mockDirectories = new Set<string>();
const mockManifests = new Map<string, string>();
let mockAvailableDiskSpace = 8 * 1024 ** 3;

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;
    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = [base.replace(/\/$/, ''), ...segments].join('/');
    }
    get exists() {
      return mockDirectories.has(this.uri) || [...mockFiles.keys()].some((uri) => uri.startsWith(`${this.uri}/`));
    }
    create() { mockDirectories.add(this.uri); }
    list() {
      const prefix = `${this.uri}/`;
      return [...mockFiles.keys()]
        .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map((uri) => new MockFile(uri));
    }
    delete() {
      const prefix = `${this.uri}/`;
      for (const uri of [...mockFiles.keys()]) if (uri.startsWith(prefix)) mockFiles.delete(uri);
      for (const uri of [...mockDirectories]) if (uri === this.uri || uri.startsWith(prefix)) mockDirectories.delete(uri);
    }
  }
  class MockFile {
    uri: string;
    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = segments.length ? [base.replace(/\/$/, ''), ...segments].join('/') : base;
    }
    get exists() { return mockFiles.has(this.uri); }
    get size() { return mockFiles.get(this.uri) || 0; }
    get name() { return this.uri.split('/').pop() || ''; }
    delete() { mockFiles.delete(this.uri); }
    async copy(destination: MockFile) { mockFiles.set(destination.uri, this.size); }
    async move(destination: MockFile) {
      const size = this.size;
      mockFiles.delete(this.uri);
      this.uri = destination.uri;
      mockFiles.set(this.uri, size);
    }
  }
  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: {
      document: 'file:///document',
      get availableDiskSpace() { return mockAvailableDiskSpace; },
    },
  };
});

jest.mock('../cache/nativeSnapshotStorage', () => ({
  writeEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number, value: string) => {
    mockManifests.set(`${scope}:${userId}`, value);
    return true;
  }),
  readEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number) => (
    mockManifests.get(`${scope}:${userId}`) || null
  )),
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, userId: number) => {
    mockManifests.delete(`${scope}:${userId}`);
  }),
}));

const readyFile: MyFileRecord = {
  id: 'f-1', original_file_name: 'report.pdf', download_file_name: 'report.pdf',
  mime_type: 'application/pdf', download_mime_type: 'application/pdf', original_size_bytes: 1024,
  stored_size_bytes: 1024, saved_size_bytes: 0, retention_days: 7, status: 'ready', storage_mode: 'stored',
  error_text: '', security_scan_status: 'clean', preview_kind: 'pdf', preview_available: true,
  preview_status: 'ready', preview_max_bytes: 0, is_shared: false, share_expires_at: null,
  created_at: null, updated_at: '2026-09-02T10:00:00Z', expires_at: '2030-09-02T10:00:00Z',
};

beforeEach(() => {
  mockFiles.clear();
  mockDirectories.clear();
  mockManifests.clear();
  mockAvailableDiskSpace = 8 * 1024 ** 3;
});

it('copies a file into user-scoped persistent storage and reopens it without cache', async () => {
  mockFiles.set('file:///cache/report.pdf', 1024);

  const pinned = await pinNativeMyFileOffline(7, readyFile, new File('file:///cache/report.pdf'));

  expect(pinned.uri).toContain('file:///document/hubit-my-files-offline/user-7/');
  await expect(getNativeMyFilesOfflineFile(7, readyFile)).resolves.toMatchObject({ uri: pinned.uri });
  await expect(getNativeMyFilesOfflineFile(8, readyFile)).resolves.toBeNull();
  await expect(getNativeMyFilesOfflineIds(7, [readyFile])).resolves.toEqual(new Set(['f-1']));
});

it('removes only the local offline copy without touching the source file', async () => {
  mockFiles.set('file:///cache/report.pdf', 1024);
  await pinNativeMyFileOffline(7, readyFile, new File('file:///cache/report.pdf'));

  await removeNativeMyFileOffline(7, readyFile.id);

  expect(mockFiles.has('file:///cache/report.pdf')).toBe(true);
  await expect(getNativeMyFilesOfflineFile(7, readyFile)).resolves.toBeNull();
});

it('keeps valid offline copies when the current server list is partial', async () => {
  const secondFile = { ...readyFile, id: 'f-2', original_file_name: 'second.pdf' };
  mockFiles.set('file:///cache/report.pdf', 1024);
  mockFiles.set('file:///cache/second.pdf', 1024);
  await pinNativeMyFileOffline(7, readyFile, new File('file:///cache/report.pdf'));
  await pinNativeMyFileOffline(7, secondFile, new File('file:///cache/second.pdf'));

  await expect(getNativeMyFilesOfflineIds(7, [readyFile])).resolves.toEqual(new Set(['f-1']));
  await expect(getNativeMyFilesOfflineFile(7, secondFile)).resolves.toMatchObject({
    uri: expect.stringContaining('/user-7/f-2-'),
  });
});

it('rejects a persistent copy when the device cannot keep a safety reserve', async () => {
  mockFiles.set('file:///cache/report.pdf', 1024);
  mockAvailableDiskSpace = 1024;

  await expect(pinNativeMyFileOffline(7, readyFile, new File('file:///cache/report.pdf')))
    .rejects.toThrow('Недостаточно свободного места');
});

it('clears persistent My Files data for the signed-out user', async () => {
  mockFiles.set('file:///cache/report.pdf', 1024);
  await pinNativeMyFileOffline(7, readyFile, new File('file:///cache/report.pdf'));

  await clearNativeMyFilesOffline(7);

  await expect(getNativeMyFilesOfflineFile(7, readyFile)).resolves.toBeNull();
  expect([...mockFiles.keys()].some((uri) => uri.includes('/user-7/'))).toBe(false);
});
