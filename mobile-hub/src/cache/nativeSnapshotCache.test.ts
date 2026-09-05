import * as SecureStore from 'expo-secure-store';

const mockSnapshotFiles = new Map<string, string>();
let mockMoveFailure: Error | null = null;
let mockMoveFailureAtAttempt: number | null = null;
let mockMoveAttempts = 0;

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
    async copy(destination: MockFile, options?: { overwrite?: boolean }) {
      if (destination.exists && !options?.overwrite) throw new Error('Destination exists');
      mockSnapshotFiles.set(destination.uri, mockSnapshotFiles.get(this.uri) || '');
    }
    async move(destination: MockFile, options?: { overwrite?: boolean }) {
      mockMoveAttempts += 1;
      if (mockMoveFailureAtAttempt === mockMoveAttempts) throw new Error('Selected atomic move failed');
      if (mockMoveFailure) throw mockMoveFailure;
      await this.copy(destination, options);
      this.delete();
      this.uri = destination.uri;
    }
  }

  return {
    Directory: MockDirectory,
    File: MockFile,
    Paths: { cache: 'file:///cache', document: 'file:///document' },
  };
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
  readNativeCollectionSnapshot,
  readNativeEntitySnapshot,
  readNativeSnapshot,
  writeNativeCollectionSnapshot,
  writeNativeEntitySnapshot,
  writeNativeSnapshot,
} from './nativeSnapshotCache';
import { getNativeSnapshotInventory, getRequiredNativeOfflineScopes } from './nativeSnapshotInventory';
import { writeNativeEquipmentCatalogSnapshot } from './nativeEquipmentCatalogSnapshot';

describe('native snapshot cache', () => {
  beforeEach(() => {
    mockSnapshotFiles.clear();
    mockMoveFailure = null;
    mockMoveFailureAtAttempt = null;
    mockMoveAttempts = 0;
  });

  it('requires the inventory bootstrap, list and complete catalog for database.read', () => {
    expect(getRequiredNativeOfflineScopes(['database.read'])).toEqual([
      'database-bootstrap',
      'database-inbox',
      'database-catalog',
    ]);
  });

  it('requires cached conversations, folders and notifications for native chat offline readiness', () => {
    expect(getRequiredNativeOfflineScopes(['chat.read'])).toEqual([
      'chat-inbox',
      'chat-folders',
      'notifications',
    ]);
  });

  it('does not report a truncated chat list as fully prepared', async () => {
    await writeNativeSnapshot('chat-inbox', 7, {
      items: [{ id: 'conversation-1' }],
      has_more: true,
      next_cursor: 'cursor-2',
    });
    await writeNativeSnapshot('chat-folders', 7, {
      items: [],
      conversation_ids_by_folder: {},
    });
    await writeNativeSnapshot('notifications', 7, {
      hubItems: [],
      mailItems: [],
      hubUnread: 0,
      mailUnread: 0,
    });

    await expect(getNativeSnapshotInventory(
      7,
      getRequiredNativeOfflineScopes(['chat.read']),
    )).resolves.toEqual(expect.objectContaining({
      ready: false,
      missingScopes: ['chat-inbox'],
      lastSyncAt: expect.any(Number),
    }));
  });

  it('does not report an unfinished paged 1C DO list as fully prepared', async () => {
    await writeNativeCollectionSnapshot('docflow-inbox', 7, 'inbox', {
      result: {
        items: [{ ref: 'task-1' }],
        total: 2,
        has_more: true,
        next_offset: 1,
        truncated: true,
      },
    });

    const inventory = await getNativeSnapshotInventory(
      7,
      getRequiredNativeOfflineScopes(['docflow.read']),
    );

    expect(inventory.ready).toBe(false);
    expect(inventory.missingScopes).toEqual(['docflow-inbox']);
    expect(inventory.lastSyncAt).toBeGreaterThan(0);
  });

  it('checks completeness through the sharded chat collection manifest', async () => {
    await writeNativeCollectionSnapshot('chat-inbox', 7, 'default', {
      items: [{ id: 'conversation-1' }],
      has_more: true,
      next_cursor: 'cursor-2',
    });
    await writeNativeSnapshot('chat-folders', 7, {
      items: [],
      conversation_ids_by_folder: {},
    });
    await writeNativeSnapshot('notifications', 7, {
      hubItems: [],
      mailItems: [],
      hubUnread: 0,
      mailUnread: 0,
    });

    await expect(getNativeSnapshotInventory(
      7,
      getRequiredNativeOfflineScopes(['chat.read']),
    )).resolves.toEqual(expect.objectContaining({
      ready: false,
      missingScopes: ['chat-inbox'],
      lastSyncAt: expect.any(Number),
    }));
  });

  it('does not report Inventory ready until every advertised database catalog is readable', async () => {
    await writeNativeSnapshot('database-bootstrap', 7, {
      databases: [{ id: 'ITINVENT', name: 'Основная' }],
      currentDatabase: { id: 'ITINVENT', name: 'Основная', locked: false },
    });
    await writeNativeCollectionSnapshot('database-inbox', 7, 'ITINVENT', {
      signature: 'ITINVENT',
      databaseId: 'ITINVENT',
      mode: 'equipment',
      query: '',
      equipment: [],
      consumables: [],
      acts: [],
      total: 1,
      page: 1,
      pages: 1,
    });
    const required = getRequiredNativeOfflineScopes(['database.read']);

    await expect(getNativeSnapshotInventory(7, required)).resolves.toEqual(expect.objectContaining({
      ready: false,
      missingScopes: ['database-catalog'],
    }));

    await writeNativeEquipmentCatalogSnapshot(7, 'ITINVENT', [{ inv_no: 'INV-1' } as never], 1);
    await expect(getNativeSnapshotInventory(7, required)).resolves.toEqual(expect.objectContaining({
      ready: true,
      scopes: expect.arrayContaining(['database-catalog']),
      missingScopes: [],
    }));
  });

  it('does not report malformed required singleton snapshots as prepared', async () => {
    await writeNativeSnapshot('dashboard', 7, {});
    await writeNativeCollectionSnapshot('feed-inbox', 7, 'all', {
      signature: 'all',
      items: [],
      total: 0,
      unreadTotal: 0,
    });
    await writeNativeSnapshot('notifications', 7, {
      hubItems: [],
      mailItems: [],
      hubUnread: 0,
      mailUnread: 0,
    });

    await expect(getNativeSnapshotInventory(
      7,
      getRequiredNativeOfflineScopes(['dashboard.read']),
    )).resolves.toEqual(expect.objectContaining({
      ready: false,
      missingScopes: ['dashboard'],
    }));
  });

  it('requires a valid initial Inventory list for every advertised database', async () => {
    await writeNativeSnapshot('database-bootstrap', 7, {
      databases: [
        { id: 'ITINVENT', name: 'Primary' },
        { id: 'MSK', name: 'Moscow' },
      ],
      currentDatabase: { id: 'ITINVENT', name: 'Primary', locked: false },
    });
    await writeNativeCollectionSnapshot('database-inbox', 7, 'ITINVENT', {
      signature: 'ITINVENT',
      databaseId: 'ITINVENT',
      mode: 'equipment',
      query: '',
      equipment: [{ inv_no: 'INV-1' }],
      consumables: [],
      acts: [],
      total: 1,
      page: 1,
      pages: 1,
    });
    await writeNativeEquipmentCatalogSnapshot(7, 'ITINVENT', [{ inv_no: 'INV-1' } as never], 1);
    await writeNativeEquipmentCatalogSnapshot(7, 'MSK', [{ inv_no: 'MSK-1' } as never], 1);

    await expect(getNativeSnapshotInventory(
      7,
      getRequiredNativeOfflineScopes(['database.read']),
    )).resolves.toEqual(expect.objectContaining({
      ready: false,
      missingScopes: ['database-inbox'],
    }));
  });

  it('keeps a bounded user-scoped snapshot in encrypted device storage', async () => {
    await writeNativeSnapshot('dashboard', 7, { title: 'Последние данные' });

    await expect(readNativeSnapshot<{ title: string }>('dashboard', 7)).resolves.toEqual(
      expect.objectContaining({ data: { title: 'Последние данные' } }),
    );
    await expect(readNativeSnapshot('dashboard', 8)).resolves.toBeNull();
  });

  it('stores snapshots in persistent app documents instead of evictable cache', async () => {
    await writeNativeSnapshot('dashboard', 7, { title: 'persistent' });

    expect([...mockSnapshotFiles.keys()]).toEqual([
      'file:///document/hubit-native-snapshots/snapshot-7-dashboard.aes',
    ]);
  });

  it('keeps prepared offline data after more than seven days', async () => {
    const now = jest.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      await writeNativeSnapshot('dashboard', 7, { title: 'still available' });
      now.mockReturnValue(1_000 + 30 * 24 * 60 * 60 * 1000);

      await expect(readNativeSnapshot<{ title: string }>('dashboard', 7)).resolves.toEqual(
        expect.objectContaining({ data: { title: 'still available' } }),
      );
    } finally {
      now.mockRestore();
    }
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

  it('keeps more than twenty-four opened entity cards in independent encrypted shards', async () => {
    for (let index = 0; index < 30; index += 1) {
      await writeNativeEntitySnapshot('chat-thread-details', 7, `conversation-${index}`, {
        messages: [{ id: `message-${index}`, body_text: `body-${index}` }],
      });
    }

    await expect(readNativeEntitySnapshot<{ messages: Array<{ id: string }> }>(
      'chat-thread-details',
      7,
      'conversation-0',
    )).resolves.toEqual(expect.objectContaining({
      data: { messages: [{ id: 'message-0', body_text: 'body-0' }] },
    }));
  });

  it('keeps several opened list variants instead of replacing the previous filter', async () => {
    await writeNativeCollectionSnapshot('tasks-inbox', 7, 'assignee', { items: [{ id: 'task-1' }] });
    await writeNativeCollectionSnapshot('tasks-inbox', 7, 'creator', { items: [{ id: 'task-2' }] });

    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'tasks-inbox',
      7,
      'assignee',
    )).resolves.toEqual(expect.objectContaining({ data: { items: [{ id: 'task-1' }] } }));
    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'tasks-inbox',
      7,
      'creator',
    )).resolves.toEqual(expect.objectContaining({ data: { items: [{ id: 'task-2' }] } }));
  });

  it('reads the inline collection bundle written by older application versions', async () => {
    await writeNativeSnapshot('tasks-inbox', 7, {
      entries: [{ key: 'assignee', savedAt: Date.now(), data: { items: [{ id: 'legacy-task' }] } }],
    });

    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'tasks-inbox',
      7,
      'assignee',
    )).resolves.toEqual(expect.objectContaining({ data: { items: [{ id: 'legacy-task' }] } }));
  });

  it('migrates retained inline collection entries when a new key is written', async () => {
    await writeNativeSnapshot('tasks-inbox', 7, {
      entries: [{ key: 'assignee', savedAt: Date.now(), data: { items: [{ id: 'legacy-task' }] } }],
    });

    await writeNativeCollectionSnapshot('tasks-inbox', 7, 'creator', {
      items: [{ id: 'new-task' }],
    });

    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'tasks-inbox',
      7,
      'assignee',
    )).resolves.toEqual(expect.objectContaining({ data: { items: [{ id: 'legacy-task' }] } }));
    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'tasks-inbox',
      7,
      'creator',
    )).resolves.toEqual(expect.objectContaining({ data: { items: [{ id: 'new-task' }] } }));
  });

  it('reads the legacy unkeyed chat page as the default collection', async () => {
    const legacy = { items: [{ id: 'conversation-1' }], has_more: false, next_cursor: null };
    await writeNativeSnapshot('chat-inbox', 7, legacy);

    await expect(readNativeCollectionSnapshot<typeof legacy>('chat-inbox', 7, 'default'))
      .resolves.toEqual(expect.objectContaining({ data: legacy }));
  });

  it('stores and restores a collection larger than the generic two MiB snapshot limit', async () => {
    const large = { items: [{ id: 'large', body: 'x'.repeat(2 * 1024 * 1024 + 64 * 1024) }] };

    await expect(writeNativeCollectionSnapshot('mail-inbox', 7, 'large-mailbox', large))
      .resolves.toBe(true);
    await expect(readNativeCollectionSnapshot<typeof large>('mail-inbox', 7, 'large-mailbox'))
      .resolves.toEqual(expect.objectContaining({ data: large }));

    const shardFiles = [...mockSnapshotFiles.keys()].filter((uri) => (
      uri.includes('mail-inbox-collection-') && uri.endsWith('.aes')
    ));
    expect(shardFiles.length).toBeGreaterThan(1);
  });

  it('preserves the previous collection when a sharded replacement is interrupted', async () => {
    await writeNativeCollectionSnapshot('mail-inbox', 7, 'all-mail', {
      items: [{ id: 'mail-1', body: 'last readable value' }],
    });
    mockMoveFailure = new Error('process interrupted during shard write');

    await expect(writeNativeCollectionSnapshot('mail-inbox', 7, 'all-mail', {
      items: [{ id: 'mail-2', body: 'x'.repeat(2 * 1024 * 1024 + 64 * 1024) }],
    })).resolves.toBe(false);
    mockMoveFailure = null;

    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'mail-inbox',
      7,
      'all-mail',
    )).resolves.toEqual(expect.objectContaining({
      data: { items: [{ id: 'mail-1', body: 'last readable value' }] },
    }));
  });

  it('does not publish new shards when the manifest commit is interrupted', async () => {
    await writeNativeCollectionSnapshot('mail-inbox', 7, 'all-mail', {
      items: [{ id: 'mail-1', body: 'last readable value' }],
    });
    const oldShardFiles = [...mockSnapshotFiles.keys()].filter((uri) => (
      uri.includes('mail-inbox-collection-') && uri.endsWith('.aes')
    ));
    mockMoveFailureAtAttempt = mockMoveAttempts + 2;

    await expect(writeNativeCollectionSnapshot('mail-inbox', 7, 'all-mail', {
      items: [{ id: 'mail-2', body: 'uncommitted replacement' }],
    })).resolves.toBe(false);

    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'mail-inbox',
      7,
      'all-mail',
    )).resolves.toEqual(expect.objectContaining({
      data: { items: [{ id: 'mail-1', body: 'last readable value' }] },
    }));
    expect([...mockSnapshotFiles.keys()].filter((uri) => (
      uri.includes('mail-inbox-collection-') && uri.endsWith('.aes')
    ))).toEqual(oldShardFiles);
  });

  it('removes the previous shard generation after replacing a collection', async () => {
    await writeNativeCollectionSnapshot('mail-inbox', 7, 'all-mail', {
      items: [{ id: 'mail-1', body: 'x'.repeat(600 * 1024) }],
    });
    const previousShards = [...mockSnapshotFiles.keys()].filter((uri) => (
      uri.includes('mail-inbox-collection-') && uri.endsWith('.aes')
    ));
    expect(previousShards.length).toBeGreaterThan(1);

    await writeNativeCollectionSnapshot('mail-inbox', 7, 'all-mail', {
      items: [{ id: 'mail-2', body: 'replacement' }],
    });

    expect(previousShards.every((uri) => !mockSnapshotFiles.has(uri))).toBe(true);
    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'mail-inbox',
      7,
      'all-mail',
    )).resolves.toEqual(expect.objectContaining({
      data: { items: [{ id: 'mail-2', body: 'replacement' }] },
    }));
  });

  it('keeps eight collection keys and removes shards of the evicted ninth key', async () => {
    for (let index = 0; index < 9; index += 1) {
      await writeNativeCollectionSnapshot('tasks-inbox', 7, `filter-${index}`, {
        items: [{ id: `task-${index}` }],
      });
    }

    await expect(readNativeCollectionSnapshot('tasks-inbox', 7, 'filter-0')).resolves.toBeNull();
    await expect(readNativeCollectionSnapshot('tasks-inbox', 7, 'filter-1'))
      .resolves.toEqual(expect.objectContaining({ data: { items: [{ id: 'task-1' }] } }));
    expect([...mockSnapshotFiles.keys()].filter((uri) => (
      uri.includes('tasks-inbox-collection-') && uri.endsWith('.aes')
    ))).toHaveLength(8);
  });

  it('keeps the latest one thousand opened cards and removes the evicted shard', async () => {
    for (let index = 0; index < 1001; index += 1) {
      await writeNativeEntitySnapshot('task-details', 7, `task-${index}`, { id: `task-${index}` });
    }

    await expect(readNativeEntitySnapshot('task-details', 7, 'task-0')).resolves.toBeNull();
    await expect(readNativeEntitySnapshot('task-details', 7, 'task-1'))
      .resolves.toEqual(expect.objectContaining({ data: { id: 'task-1' } }));
    expect([...mockSnapshotFiles.keys()].filter((uri) => (
      uri.includes('task-details-entity-') && uri.endsWith('.aes')
    ))).toHaveLength(1000);
  });

  it('keeps an opened 1C DO task card for offline access', async () => {
    await writeNativeEntitySnapshot('docflow-task-details', 7, 'docflow-task-1', {
      title: 'Согласовать договор',
    });

    await expect(readNativeEntitySnapshot<{ title: string }>(
      'docflow-task-details',
      7,
      'docflow-task-1',
    )).resolves.toEqual(expect.objectContaining({ data: { title: 'Согласовать договор' } }));
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

  it('preserves the last readable snapshot when the atomic replacement is interrupted', async () => {
    await writeNativeSnapshot('dashboard', 7, { title: 'last readable value' });
    mockMoveFailure = new Error('process interrupted during replace');

    await expect(writeNativeSnapshot('dashboard', 7, { title: 'incomplete replacement' }))
      .resolves.toBe(false);
    mockMoveFailure = null;

    await expect(readNativeSnapshot<{ title: string }>('dashboard', 7)).resolves.toEqual(
      expect.objectContaining({ data: { title: 'last readable value' } }),
    );
  });

  it('keeps a complete address book larger than a regular screen snapshot', async () => {
    const directory = { items: [{ full_name: 'Employee', note: 'x'.repeat(3 * 1024 * 1024) }] };

    await expect(writeNativeSnapshot('address-book', 7, directory)).resolves.toBe(true);
    await expect(readNativeSnapshot<typeof directory>('address-book', 7)).resolves.toEqual(
      expect.objectContaining({ data: directory }),
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

  it('restores list variants and opened cards after the JavaScript runtime restarts', async () => {
    await writeNativeCollectionSnapshot('mail-inbox', 7, 'all-mail', {
      signature: 'all-mail',
      items: [{ id: 'mail-1' }],
    });
    await writeNativeCollectionSnapshot('mail-inbox', 7, 'unread-mail', {
      signature: 'unread-mail',
      items: [{ id: 'mail-2' }],
    });
    await writeNativeEntitySnapshot('task-details', 7, 'task-1', { title: 'Открытая задача' });
    await writeNativeEntitySnapshot('docflow-task-details', 7, 'docflow-1', { title: 'Задание 1С ДО' });

    let restartedCache: typeof import('./nativeSnapshotCache') | undefined;
    jest.isolateModules(() => {
      restartedCache = require('./nativeSnapshotCache') as typeof import('./nativeSnapshotCache');
    });

    await expect(restartedCache!.readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'mail-inbox',
      7,
      'all-mail',
    )).resolves.toEqual(expect.objectContaining({ data: expect.objectContaining({ items: [{ id: 'mail-1' }] }) }));
    await expect(restartedCache!.readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'mail-inbox',
      7,
      'unread-mail',
    )).resolves.toEqual(expect.objectContaining({ data: expect.objectContaining({ items: [{ id: 'mail-2' }] }) }));
    await expect(restartedCache!.readNativeEntitySnapshot<{ title: string }>(
      'task-details',
      7,
      'task-1',
    )).resolves.toEqual(expect.objectContaining({ data: { title: 'Открытая задача' } }));
    await expect(restartedCache!.readNativeEntitySnapshot<{ title: string }>(
      'docflow-task-details',
      7,
      'docflow-1',
    )).resolves.toEqual(expect.objectContaining({ data: { title: 'Задание 1С ДО' } }));
    await expect(restartedCache!.readNativeCollectionSnapshot('mail-inbox', 8, 'all-mail'))
      .resolves.toBeNull();
  });

  it('does not replace a complete offline list with the first online page', async () => {
    await writeNativeCollectionSnapshot('feed-inbox', 7, 'all-feed', {
      signature: 'all-feed',
      items: [{ id: 'feed-1' }, { id: 'feed-2' }],
      total: 2,
    });

    await expect(writeNativeCollectionSnapshot('feed-inbox', 7, 'all-feed', {
      signature: 'all-feed',
      items: [{ id: 'feed-1', title: 'fresh first page' }],
      total: 2,
    })).resolves.toBe(true);

    await expect(readNativeCollectionSnapshot<{ items: Array<{ id: string }> }>(
      'feed-inbox',
      7,
      'all-feed',
    )).resolves.toEqual(expect.objectContaining({
      data: expect.objectContaining({ items: [{ id: 'feed-1' }, { id: 'feed-2' }] }),
    }));
  });
});
