import * as SecureStore from 'expo-secure-store';

const mockSnapshotFiles = new Map<string, string>();

jest.mock('expo-file-system', () => {
  class MockDirectory {
    uri: string;

    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = [base.replace(/\/$/, ''), ...segments].join('/');
    }

    create() {}

    list() {
      const prefix = `${this.uri}/`;
      return [...mockSnapshotFiles.keys()]
        .filter((uri) => uri.startsWith(prefix) && !uri.slice(prefix.length).includes('/'))
        .map((uri) => new MockFile(uri));
    }
  }

  class MockFile {
    uri: string;

    constructor(parent: string | { uri: string }, ...segments: string[]) {
      const base = typeof parent === 'string' ? parent : parent.uri;
      this.uri = segments.length ? [base.replace(/\/$/, ''), ...segments].join('/') : base;
    }

    get name() { return this.uri.split('/').pop() || ''; }
    get exists() { return mockSnapshotFiles.has(this.uri); }
    get size() { return mockSnapshotFiles.get(this.uri)?.length || 0; }
    write(value: string) { mockSnapshotFiles.set(this.uri, value); }
    async text() { return mockSnapshotFiles.get(this.uri) || ''; }
    delete() { mockSnapshotFiles.delete(this.uri); }
  }

  return { Directory: MockDirectory, File: MockFile, Paths: { cache: 'file:///cache' } };
});

jest.mock('expo-crypto', () => {
  const { Buffer } = jest.requireActual('buffer') as typeof import('buffer');
  class MockKey {
    private readonly mockValue: string;
    constructor(mockValue = 'snapshot-test-key') { this.mockValue = mockValue; }
    static async generate() { return new MockKey(); }
    static async import(mockValue: string) { return new MockKey(mockValue); }
    async encoded() { return this.mockValue; }
  }
  class MockSealed {
    readonly mockValue: string;
    constructor(mockValue: string) { this.mockValue = mockValue; }
    static fromCombined(mockValue: string) { return new MockSealed(mockValue); }
    async combined() { return this.mockValue; }
  }
  return {
    AESKeySize: { AES256: 256 },
    AESEncryptionKey: MockKey,
    AESSealedData: MockSealed,
    aesEncryptAsync: jest.fn(async (value: Uint8Array) => new MockSealed(Buffer.from(value).toString('base64'))),
    aesDecryptAsync: jest.fn(async (sealed: MockSealed) => new Uint8Array(Buffer.from(sealed.mockValue, 'base64'))),
  };
});
import {
  clearNativeSnapshots,
  getNativeSnapshotInventory,
  readNativeEntitySnapshot,
  readNativeSnapshot,
  writeNativeEntitySnapshot,
  writeNativeSnapshot,
} from './nativeSnapshotCache';

describe('native snapshot cache', () => {
  beforeEach(() => mockSnapshotFiles.clear());

  it('keeps a bounded user-scoped snapshot in encrypted device storage', async () => {
    await writeNativeSnapshot('dashboard', 7, { title: 'Последние данные' });

    await expect(readNativeSnapshot<{ title: string }>('dashboard', 7)).resolves.toEqual(
      expect.objectContaining({ data: { title: 'Последние данные' } }),
    );
    await expect(readNativeSnapshot('dashboard', 8)).resolves.toBeNull();
  });

  it('creates one encryption key when several native snapshots are prepared together', async () => {
    await Promise.all([
      writeNativeSnapshot('dashboard', 9, { title: 'Главная' }),
      writeNativeSnapshot('tasks-inbox', 9, { items: [] }),
      writeNativeSnapshot('mail-inbox', 9, { items: [] }),
    ]);

    const keyWrites = jest.mocked(SecureStore.setItemAsync).mock.calls
      .filter(([key]) => key === 'hubit_native_snapshot_aes_key_v2_9');
    expect(keyWrites).toHaveLength(1);
  });

  it('clears every registered snapshot for the signed-out user', async () => {
    await writeNativeSnapshot('dashboard', 7, { ok: true });
    await writeNativeSnapshot('chat-inbox', 7, { items: [] });

    await clearNativeSnapshots(7);

    await expect(readNativeSnapshot('dashboard', 7)).resolves.toBeNull();
    await expect(readNativeSnapshot('chat-inbox', 7)).resolves.toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalled();
  });

  it('keeps recent entity details independently and reports offline readiness', async () => {
    await writeNativeEntitySnapshot('mail-message-details', 7, 'message-1', { subject: 'Первое' });
    await writeNativeEntitySnapshot('mail-message-details', 7, 'message-2', { subject: 'Второе' });
    await writeNativeSnapshot('tasks-inbox', 7, { items: [] });

    await expect(readNativeEntitySnapshot<{ subject: string }>(
      'mail-message-details',
      7,
      'message-1',
    )).resolves.toEqual(expect.objectContaining({ data: { subject: 'Первое' } }));

    await expect(getNativeSnapshotInventory(7)).resolves.toEqual(expect.objectContaining({
      ready: true,
      scopes: expect.arrayContaining(['mail-message-details', 'tasks-inbox']),
      lastSyncAt: expect.any(Number),
    }));
  });

  it('keeps a previously opened large mail body available offline', async () => {
    const bodyHtml = `<p>${'offline mail '.repeat(30_000)}</p>`;

    await writeNativeEntitySnapshot('mail-message-details', 7, 'large-message', { body_html: bodyHtml });

    await expect(readNativeEntitySnapshot<{ body_html: string }>(
      'mail-message-details',
      7,
      'large-message',
    )).resolves.toEqual(expect.objectContaining({ data: { body_html: bodyHtml } }));
    expect([...mockSnapshotFiles.values()].join('')).not.toContain('offline mail');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      'hubit_native_snapshot_aes_key_v2_7',
      expect.any(String),
    );
    expect(jest.mocked(SecureStore.setItemAsync).mock.calls.every(([, value]) => value.length < 1_000)).toBe(true);
  });

  it('preserves the last readable snapshot when a replacement exceeds the file limit', async () => {
    await writeNativeSnapshot('dashboard', 7, { title: 'last readable value' });

    await expect(writeNativeSnapshot('dashboard', 7, { body: 'x'.repeat(2 * 1024 * 1024 + 1) }))
      .resolves.toBe(false);

    await expect(readNativeSnapshot<{ title: string }>('dashboard', 7)).resolves.toEqual(
      expect.objectContaining({ data: { title: 'last readable value' } }),
    );
  });

  it('migrates a valid legacy SecureStore snapshot into the encrypted file cache', async () => {
    const legacyKey = 'hubit_native_snapshot_v1_dashboard_7';
    await SecureStore.setItemAsync(legacyKey, JSON.stringify({
      version: 1,
      userId: 7,
      savedAt: Date.now(),
      data: { title: 'legacy' },
    }));

    await expect(readNativeSnapshot<{ title: string }>('dashboard', 7)).resolves.toEqual(
      expect.objectContaining({ data: { title: 'legacy' } }),
    );
    await expect(SecureStore.getItemAsync(legacyKey)).resolves.toBeNull();
    expect(mockSnapshotFiles.size).toBe(1);
  });
});
