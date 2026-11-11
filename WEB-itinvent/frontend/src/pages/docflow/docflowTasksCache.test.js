import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DOCFLOW_TASKS_CACHE_FRESH_MS,
  DOCFLOW_TASKS_CACHE_TTL_MS,
  buildDocflowTasksCacheKey,
  clearAllDocflowTasksCache,
  clearDocflowTasksCacheByLogin,
  isDocflowTasksCacheFresh,
  isHeavyDocflowTasksScope,
  patchDocflowTasksCacheAfterCompletion,
  readDocflowTasksCache,
  writeDocflowTasksCache,
} from './docflowTasksCache';


describe('docflowTasksCache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('builds stable keys for login/scope/search', () => {
    expect(buildDocflowTasksCacheKey({ login: 'user.a', scope: 'inbox', search: '' }))
      .toBe('docflow:tasks:v1:user.a:inbox:');
    expect(buildDocflowTasksCacheKey({ login: 'user a', scope: 'approval', search: 'акт' }))
      .toBe(`docflow:tasks:v1:${encodeURIComponent('user a')}:approval:${encodeURIComponent('акт')}`);
  });

  it('writes and reads cache within TTL', () => {
    const now = 1_700_000_000_000;
    writeDocflowTasksCache({
      login: 'personal.login',
      scope: 'inbox',
      search: '',
      items: [{ ref: 't1', title: 'Задание' }],
      truncated: true,
      as_of: '2026-07-30T10:00:00Z',
      now,
    });

    expect(readDocflowTasksCache({
      login: 'personal.login',
      scope: 'inbox',
      search: '',
      now: now + DOCFLOW_TASKS_CACHE_TTL_MS - 1,
    })).toEqual({
      items: [{ ref: 't1', title: 'Задание' }],
      truncated: true,
      as_of: '2026-07-30T10:00:00Z',
      savedAt: now,
    });
  });

  it('marks cache fresh only inside the fresh window', () => {
    const now = 1_700_000_000_000;
    const cached = { savedAt: now };
    expect(isDocflowTasksCacheFresh(cached, now + DOCFLOW_TASKS_CACHE_FRESH_MS - 1)).toBe(true);
    expect(isDocflowTasksCacheFresh(cached, now + DOCFLOW_TASKS_CACHE_FRESH_MS + 1)).toBe(false);
  });

  it('expires cache after TTL', () => {
    const now = 1_700_000_000_000;
    writeDocflowTasksCache({
      login: 'personal.login',
      scope: 'inbox',
      search: '',
      items: [{ ref: 't1' }],
      truncated: false,
      as_of: '',
      now,
    });

    expect(readDocflowTasksCache({
      login: 'personal.login',
      scope: 'inbox',
      search: '',
      now: now + DOCFLOW_TASKS_CACHE_TTL_MS + 1,
    })).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('clears only matching login keys', () => {
    writeDocflowTasksCache({
      login: 'a',
      scope: 'inbox',
      search: '',
      items: [{ ref: '1' }],
      truncated: false,
      as_of: '',
    });
    writeDocflowTasksCache({
      login: 'b',
      scope: 'inbox',
      search: '',
      items: [{ ref: '2' }],
      truncated: false,
      as_of: '',
    });

    expect(clearDocflowTasksCacheByLogin('a')).toBe(1);
    expect(readDocflowTasksCache({ login: 'a', scope: 'inbox', search: '' })).toBeNull();
    expect(readDocflowTasksCache({ login: 'b', scope: 'inbox', search: '' })?.items).toEqual([{ ref: '2' }]);
  });

  it('clears all docflow task cache keys', () => {
    writeDocflowTasksCache({
      login: 'a',
      scope: 'inbox',
      search: '',
      items: [],
      truncated: false,
      as_of: '',
    });
    writeDocflowTasksCache({
      login: 'b',
      scope: 'approval',
      search: 'q',
      items: [],
      truncated: false,
      as_of: '',
    });
    sessionStorage.setItem('other:key', '1');

    expect(clearAllDocflowTasksCache()).toBe(2);
    expect(sessionStorage.getItem('other:key')).toBe('1');
  });

  it('marks completed/all as heavy scopes', () => {
    expect(isHeavyDocflowTasksScope('inbox')).toBe(false);
    expect(isHeavyDocflowTasksScope('completed')).toBe(true);
    expect(isHeavyDocflowTasksScope('all')).toBe(true);
  });

  it('moves executed task from inbox cache into completed cache', () => {
    const now = 1_700_000_000_000;
    writeDocflowTasksCache({
      login: 'samkov',
      scope: 'inbox',
      search: '',
      items: [{ ref: 't-active', title: 'A' }, { ref: 't-done', title: 'B' }],
      truncated: false,
      as_of: 'old',
      now,
    });
    writeDocflowTasksCache({
      login: 'samkov',
      scope: 'completed',
      search: '',
      items: [{ ref: 'old', title: 'Old' }],
      truncated: true,
      as_of: 'old',
      now,
    });
    writeDocflowTasksCache({
      login: 'samkov',
      scope: 'all',
      search: '',
      items: [{ ref: 'mix' }],
      truncated: false,
      as_of: 'old',
      now,
    });

    const patched = patchDocflowTasksCacheAfterCompletion({
      login: 'samkov',
      task: { ref: 't-done', title: 'B', completed: true },
      search: '',
      now: now + 1000,
    });

    expect(patched).toEqual({ inbox: true, completed: true });
    expect(readDocflowTasksCache({ login: 'samkov', scope: 'inbox', search: '', now: now + 1000 })?.items)
      .toEqual([{ ref: 't-active', title: 'A' }]);
    expect(readDocflowTasksCache({ login: 'samkov', scope: 'completed', search: '', now: now + 1000 })?.items)
      .toEqual([{ ref: 't-done', title: 'B', completed: true }, { ref: 'old', title: 'Old' }]);
    expect(readDocflowTasksCache({ login: 'samkov', scope: 'all', search: '', now: now + 1000 })).toBeNull();
  });
});
