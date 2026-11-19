// Хранилище черновиков — чистый код над key-value стором: TTL/cap/очистка
// невоспроизводимы через E2E без реального старения localStorage.
import { describe, expect, it } from 'vitest';

import {
  CHAT_DRAFT_MAX_KEYS,
  CHAT_DRAFT_TTL_MS,
  clearAllChatDrafts,
  recordChatDraftClear,
  recordChatDraftWrite,
  sweepChatDrafts,
} from './chatDraftsStorage';

const createStorageStub = () => {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(String(key), String(value)); },
    removeItem: (key) => { data.delete(key); },
    data,
  };
};

describe('chatDraftsStorage', () => {
  it('sweep removes drafts older than TTL and prunes their meta entries', () => {
    const storage = createStorageStub();
    const now = 10_000_000;
    storage.setItem('chat:draft:7:old', 'старый текст');
    storage.setItem('chat:draft:7:fresh', 'свежий текст');
    storage.setItem('chat:draft-meta', JSON.stringify({
      'chat:draft:7:old': now - CHAT_DRAFT_TTL_MS - 1,
      'chat:draft:7:fresh': now - 1_000,
    }));

    expect(sweepChatDrafts({ now, storage })).toBe(1);

    expect(storage.getItem('chat:draft:7:old')).toBeNull();
    expect(storage.getItem('chat:draft:7:fresh')).toBe('свежий текст');
    const meta = JSON.parse(storage.getItem('chat:draft-meta'));
    expect(meta['chat:draft:7:old']).toBeUndefined();
    expect(meta['chat:draft:7:fresh']).toBe(now - 1_000);
  });

  it('sweep caps the number of draft keys, dropping the oldest first', () => {
    const storage = createStorageStub();
    const now = 10_000_000;
    for (let index = 0; index < CHAT_DRAFT_MAX_KEYS + 5; index += 1) {
      const key = `chat:draft:7:c-${index}`;
      storage.setItem(key, `текст ${index}`);
      recordChatDraftWrite(key, { now: now - index, storage });
    }

    expect(sweepChatDrafts({ now, storage })).toBe(5);

    expect(storage.getItem('chat:draft:7:c-0')).not.toBeNull();
    expect(storage.getItem(`chat:draft:7:c-${CHAT_DRAFT_MAX_KEYS + 4}`)).toBeNull();
    expect(Object.keys(JSON.parse(storage.getItem('chat:draft-meta')))).toHaveLength(CHAT_DRAFT_MAX_KEYS);
  });

  it('sweep adopts draft keys that predate the meta index instead of deleting them', () => {
    const storage = createStorageStub();
    const now = 10_000_000;
    storage.setItem('chat:draft:7:legacy', 'черновик без индекса');

    expect(sweepChatDrafts({ now, storage })).toBe(0);

    expect(storage.getItem('chat:draft:7:legacy')).toBe('черновик без индекса');
    expect(JSON.parse(storage.getItem('chat:draft-meta'))['chat:draft:7:legacy']).toBe(now);
  });

  it('sweep drops meta entries whose draft keys no longer exist', () => {
    const storage = createStorageStub();
    const now = 10_000_000;
    storage.setItem('chat:draft:7:live', 'текст');
    storage.setItem('chat:draft-meta', JSON.stringify({
      'chat:draft:7:live': now,
      'chat:draft:7:ghost': now,
    }));

    sweepChatDrafts({ now, storage });

    expect(JSON.parse(storage.getItem('chat:draft-meta'))['chat:draft:7:ghost']).toBeUndefined();
  });

  it('recordChatDraftClear removes only the cleared key from the index', () => {
    const storage = createStorageStub();
    recordChatDraftWrite('chat:draft:7:a', { now: 5, storage });
    recordChatDraftWrite('chat:draft:7:b', { now: 6, storage });
    recordChatDraftClear('chat:draft:7:a', { storage });

    const meta = JSON.parse(storage.getItem('chat:draft-meta'));
    expect(meta['chat:draft:7:a']).toBeUndefined();
    expect(meta['chat:draft:7:b']).toBe(6);
  });

  it('clearAllChatDrafts removes draft keys and the index but leaves other keys', () => {
    const storage = createStorageStub();
    storage.setItem('chat:draft:7:a', 'x');
    storage.setItem('chat:draft:9:b', 'y');
    storage.setItem('chat:pinned-message:7:a', '{}');
    recordChatDraftWrite('chat:draft:7:a', { now: 5, storage });

    expect(clearAllChatDrafts({ storage })).toBe(2);

    expect(storage.getItem('chat:draft:7:a')).toBeNull();
    expect(storage.getItem('chat:draft:9:b')).toBeNull();
    expect(storage.getItem('chat:draft-meta')).toBeNull();
    expect(storage.getItem('chat:pinned-message:7:a')).toBe('{}');
  });
});
