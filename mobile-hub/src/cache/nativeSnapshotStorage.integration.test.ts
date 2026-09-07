/** Disk + real AES-GCM harness. Expo bridge contracts are modelled from the installed SDK 57;
 * this is not an Android/Hermes execution test. All data and keys are synthetic. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

let mockRoot: string;
let mockEmptyRead: 'pending' | 'aes' | null = null;
let mockBackupDeleteFailure = false;
let mockBeforeMove: (() => Promise<void>) | null = null;

jest.mock('expo-file-system', () => {
  const disk = jest.requireActual('node:fs') as typeof fs;
  const paths = jest.requireActual('node:path') as typeof path;
  class Directory {
    uri: string;
    constructor(parent: string | { uri: string }, ...parts: string[]) {
      this.uri = paths.join(typeof parent === 'string' ? parent : parent.uri, ...parts);
    }
    get exists() { return disk.existsSync(this.uri); }
    create() { disk.mkdirSync(this.uri, { recursive: true }); }
    list() { return disk.readdirSync(this.uri).map((name) => new File(this, name)); }
  }
  class File extends Directory {
    get name() { return paths.basename(this.uri); }
    get size() { return this.exists ? disk.statSync(this.uri).size : 0; }
    write(value: string) { disk.writeFileSync(this.uri, value, 'utf8'); }
    async text() {
      if (mockEmptyRead && this.uri.endsWith(`.${mockEmptyRead}`)) {
        mockEmptyRead = null;
        return '';
      }
      return disk.readFileSync(this.uri, 'utf8');
    }
    delete() {
      if (mockBackupDeleteFailure && this.uri.endsWith('.backup')) {
        mockBackupDeleteFailure = false;
        throw new Error('EACCES: permission denied');
      }
      disk.unlinkSync(this.uri);
    }
    async copy(to: File, options?: { overwrite?: boolean }) {
      disk.copyFileSync(this.uri, to.uri, options?.overwrite ? 0 : disk.constants.COPYFILE_EXCL);
    }
    async move(to: File, options?: { overwrite?: boolean }) {
      if (to.exists && !options?.overwrite) throw new Error('Destination exists');
      // SDK 57 LocalFile.prepareAsDestination removes the old destination first.
      if (to.exists) disk.unlinkSync(to.uri);
      await mockBeforeMove?.();
      disk.renameSync(this.uri, to.uri);
      this.uri = to.uri; // Native FileSystemPath.move mutates the source URI.
    }
  }
  return {
    File, Directory,
    Paths: { get document() { return mockRoot; }, get cache() { return paths.join(mockRoot, 'cache'); } },
  };
});

jest.mock('expo-crypto', () => jest.requireActual('expo-crypto'));

jest.mock('expo-crypto/build/aes/ExpoCryptoAES', () => {
  const crypto = jest.requireActual('node:crypto') as typeof import('node:crypto');
  const { Buffer } = jest.requireActual('node:buffer') as typeof import('node:buffer');
  class Key {
    readonly bytes: Buffer;
    constructor(value: Buffer) { this.bytes = value; }
    static async generate() { return new Key(crypto.randomBytes(32)); }
    static async import(value: string) { return new Key(Buffer.from(value, 'base64')); }
    async encoded() { return this.bytes.toString('base64'); }
  }
  class Sealed {
    readonly bytes: Buffer;
    constructor(value: Buffer) { this.bytes = value; }
    static fromCombined(value: Uint8Array) {
      if (!(value instanceof Uint8Array)) {
        // MethodMetadata::convertJSIArgsToJNI -> ByteArrayFrontendConverter -> Value::asObject.
        throw new Error('[fromCombined] Cannot convert [redacted] to a Kotlin type. Value is a string, expected an Object');
      }
      return new Sealed(Buffer.from(value));
    }
    async combined() { return this.bytes.toString('base64'); }
  }
  return {
    EncryptionKey: Key, SealedData: Sealed,
    encryptAsync: async (value: Uint8Array, key: Key, options: { additionalData: string }) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key.bytes, iv);
      cipher.setAAD(Buffer.from(options.additionalData, 'base64'));
      return new Sealed(Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]));
    },
    decryptAsync: async (value: Sealed, key: Key, options: { additionalData: string }) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key.bytes, value.bytes.subarray(0, 12));
      decipher.setAuthTag(value.bytes.subarray(-16));
      decipher.setAAD(Buffer.from(options.additionalData, 'base64'));
      return new Uint8Array(Buffer.concat([decipher.update(value.bytes.subarray(12, -16)), decipher.final()]));
    },
  };
});

import { readEncryptedNativeSnapshot as read, writeEncryptedNativeSnapshot as write } from './nativeSnapshotStorage';
import { readNativeAddressBookSnapshot, writeNativeAddressBookSnapshot } from './nativeAddressBookSnapshot';
import { recordNativeOfflineCoverageSuccess } from '../offline/nativeOfflineCoverage';

beforeEach(() => {
  mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hubit-synthetic-snapshots-'));
  mockEmptyRead = null;
  mockBackupDeleteFailure = false;
  mockBeforeMove = null;
});
afterEach(() => {
  const target = path.resolve(mockRoot);
  if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('hubit-synthetic-snapshots-')) {
    throw new Error('Refusing cleanup outside the synthetic test directory');
  }
  fs.rmSync(target, { recursive: true, force: true });
});

it('reproduces the installed Expo JS/native fromCombined string contract mismatch', () => {
  const crypto = jest.requireActual('expo-crypto') as typeof import('expo-crypto');
  expect(() => crypto.AESSealedData.fromCombined('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='))
    .toThrow('Value is a string, expected an Object');
  expect(() => crypto.AESSealedData.fromCombined(new Uint8Array(28))).not.toThrow();
});

it('round-trips Cyrillic, emoji, whitespace and replacement with real AES-GCM', async () => {
  for (const value of ['', 'a', 'ab', 'abc', '  Кириллица Ёж 🦔\n', 'Новая версия'.repeat(30_000), 'Я'.repeat(700_000)]) {
    expect(await write('dashboard', 17, value)).toBe(true);
    expect(await read('dashboard', 17)).toBe(value);
    const encoded = fs.readFileSync(path.join(mockRoot, 'hubit-native-snapshots/snapshot-17-dashboard.aes'), 'utf8');
    expect(encoded).not.toContain('Кириллица');
    expect(Buffer.from(encoded, 'base64').length).toBe(Buffer.byteLength(value) + 12 + 16);
  }
});

it.each(['existing', 'missing-with-backup', 'corrupt-with-backup'])(
  'reads the unchanged v2 base64 file format: %s', async (scenario) => {
    const value = 'Существующий зашифрованный кэш';
    const key = await Crypto.AESEncryptionKey.generate(Crypto.AESKeySize.AES256);
    await SecureStore.setItemAsync('hubit_native_snapshot_aes_key_v2_17', await key.encoded('base64'));
    const sealed = await Crypto.aesEncryptAsync(new TextEncoder().encode(value), key, {
      additionalData: new TextEncoder().encode('hubit-native-snapshot:v2:17:dashboard'),
    });
    // Seed bytes directly, as the old writer did; do not use the patched writer.
    const encoded = await sealed.combined('base64');
    const root = path.join(mockRoot, 'hubit-native-snapshots');
    fs.mkdirSync(root, { recursive: true });
    const target = path.join(root, 'snapshot-17-dashboard.aes');
    if (scenario === 'existing') fs.writeFileSync(target, encoded);
    else {
      fs.writeFileSync(path.join(root, 'snapshot-17-dashboard.backup'), encoded);
      if (scenario === 'corrupt-with-backup') {
        const corrupt = Buffer.from(encoded, 'base64');
        corrupt[corrupt.length - 1] ^= 1;
        fs.writeFileSync(target, corrupt.toString('base64'));
      }
    }
    expect(await read('dashboard', 17)).toBe(value);
    expect(fs.readFileSync(target, 'utf8')).toBe(encoded);
    expect(await read('dashboard', 17)).toBe(value);
  },
);

it('does not report success when the committed file cannot be read back', async () => {
  mockEmptyRead = 'aes';
  expect(await write('dashboard', 17, 'синтетические данные')).toBe(false);
});

it('does not roll back a valid committed file when backup cleanup fails after move', async () => {
  expect(await write('dashboard', 17, 'старое')).toBe(true);
  mockBackupDeleteFailure = true;
  expect(await write('dashboard', 17, 'новое')).toBe(true);
  expect(await read('dashboard', 17)).toBe('новое');
});

it('retains an existing snapshot when pending verification fails', async () => {
  expect(await write('dashboard', 17, 'старое')).toBe(true);
  mockEmptyRead = 'pending';
  expect(await write('dashboard', 17, 'новое')).toBe(false);
  expect(await read('dashboard', 17)).toBe('старое');
  const events = JSON.parse((await SecureStore.getItemAsync('hubit_diagnostics_v1')) || '[]');
  expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
    code: 'native_snapshot_error',
    snapshot: expect.objectContaining({
      scope: 'dashboard', stage: 'pending-read', errorType: 'Error',
      message: 'Snapshot staging verification failed',
      sizes: expect.objectContaining({ plaintextBytes: 10, readChars: 0 }),
      files: expect.objectContaining({ pending: expect.objectContaining({ exists: true, size: expect.any(Number) }) }),
      stack: expect.stringContaining('nativeSnapshotStorage.ts:'),
    }),
  })]));
});

it('keeps the encrypted file on a transient read error, allowing a later offline retry', async () => {
  expect(await write('dashboard', 17, 'данные')).toBe(true);
  const target = path.join(mockRoot, 'hubit-native-snapshots/snapshot-17-dashboard.aes');
  mockEmptyRead = 'aes';
  expect(await read('dashboard', 17)).toBeNull();
  expect(fs.existsSync(target)).toBe(true);
  expect(await read('dashboard', 17)).toBe('данные');
});

it('restores a verified backup when an overwrite was interrupted after destination removal', async () => {
  expect(await write('dashboard', 17, 'предыдущая версия')).toBe(true);
  mockBeforeMove = async () => { throw new Error('EACCES: permission denied'); };
  expect(await write('dashboard', 17, 'новая версия')).toBe(false);
  expect(await read('dashboard', 17)).toBe('предыдущая версия');
});

it('authenticates the scope and key and preserves ciphertext after failed authentication', async () => {
  expect(await write('dashboard', 17, 'данные')).toBe(true);
  const root = path.join(mockRoot, 'hubit-native-snapshots');
  fs.copyFileSync(path.join(root, 'snapshot-17-dashboard.aes'), path.join(root, 'snapshot-17-notifications.aes'));
  expect(await read('notifications', 17)).toBeNull();
  const key = (await SecureStore.getItemAsync('hubit_native_snapshot_aes_key_v2_17'))!;
  await SecureStore.setItemAsync('hubit_native_snapshot_aes_key_v2_17', Buffer.alloc(32, 1).toString('base64'));
  expect(await read('dashboard', 17)).toBeNull();
  await SecureStore.setItemAsync('hubit_native_snapshot_aes_key_v2_17', key);
  expect(await read('dashboard', 17)).toBe('данные');
});

it('orders a concurrent read after the in-flight write to the same scope', async () => {
  expect(await write('dashboard', 17, 'старое')).toBe(true);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  mockBeforeMove = async () => { entered(); await gate; };
  const writing = write('dashboard', 17, 'новое');
  await started;
  const reading = read('dashboard', 17);
  release();
  expect(await writing).toBe(true);
  expect(await reading).toBe('новое');
});

it('serializes concurrent sharded directory replacements and reads without losing the index', async () => {
  const payload = (count: number) => ({
    items: Array.from({ length: count }, (_, id) => ({ id, full_name: `Тест ${id}`, note: 'Я'.repeat(200) })),
    total: count, has_more: false,
  });
  const first = payload(2701);
  const second = payload(2702);
  expect(await Promise.all([
    writeNativeAddressBookSnapshot(17, first),
    writeNativeAddressBookSnapshot(17, second),
  ])).toEqual([true, true]);
  expect((await readNativeAddressBookSnapshot(17))?.data).toEqual(second);
  expect(fs.readdirSync(path.join(mockRoot, 'hubit-native-snapshots')).filter((name) => name.includes('address-book-shard')).length).toBeGreaterThan(1);
// This checks disk/AES consistency of two full directory replacements, not a
// five-second latency SLA. Keep the full dataset and assertions on slower CI.
}, 15_000);

it('reads encrypted disk data using the persisted key after JS modules restart, with no network', async () => {
  const value = 'После перезапуска';
  expect(await write('dashboard', 17, value)).toBe(true);
  const directory = {
    items: Array.from({ length: 1500 }, (_, id) => ({ id, note: 'Тест'.repeat(100) })),
    total: 1500, has_more: false,
  };
  expect(await writeNativeAddressBookSnapshot(17, directory)).toBe(true);
  expect(await Promise.all(['addressBook', 'dashboard'].map((module) => recordNativeOfflineCoverageSuccess(17, module, {
    status: 'complete', loaded: 1, total: 1, unit: 'test',
  })))).toEqual([true, true]);
  jest.resetModules();
  const restarted = require('./nativeSnapshotStorage') as typeof import('./nativeSnapshotStorage');
  expect(await restarted.readEncryptedNativeSnapshot('dashboard', 17)).toBe(value);
  const restartedDirectory = require('./nativeAddressBookSnapshot') as typeof import('./nativeAddressBookSnapshot');
  expect((await restartedDirectory.readNativeAddressBookSnapshot(17))?.data).toEqual(directory);
  const restartedCoverage = require('../offline/nativeOfflineCoverage') as typeof import('../offline/nativeOfflineCoverage');
  expect((await restartedCoverage.readNativeOfflineCoverage(17))?.entries).toMatchObject({
    addressBook: { status: 'complete' }, dashboard: { status: 'complete' },
  });
});
