import { describe, expect, it } from 'vitest';
import { sweepLogoutSessionData } from './logoutDataSweep';

const createStorage = (seed = {}) => {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map,
  };
};

describe('logoutDataSweep', () => {
  it('removes scoped mail searches and upload resume keys, keeps unrelated data', () => {
    const storage = createStorage({
      'mail_recent_searches_v1': '[]',
      'mail_recent_searches_v1:100': '[{"q":"счёт"}]',
      'mail_recent_searches_v1:200': '[{"q":"акт"}]',
      'hubit-my-files-uploads:100': '{"f|1|root|0":{"savedAt":1}}',
      'hubit-my-files-uploads:200': '{}',
      'web_preferences_cache': '{"theme_mode":"dark"}',
      'mail_recent_cache_v3': '{"100":{}}',
    });

    expect(sweepLogoutSessionData({ storage })).toBe(5);
    expect(storage._map.has('mail_recent_searches_v1:100')).toBe(false);
    expect(storage._map.has('mail_recent_searches_v1:200')).toBe(false);
    expect(storage._map.has('mail_recent_searches_v1')).toBe(false);
    expect(storage._map.has('hubit-my-files-uploads:100')).toBe(false);
    expect(storage._map.has('hubit-my-files-uploads:200')).toBe(false);
    expect(storage._map.has('web_preferences_cache')).toBe(true);
    expect(storage._map.has('mail_recent_cache_v3')).toBe(true);
  });

  it('returns 0 and does not throw when storage is missing or empty', () => {
    expect(sweepLogoutSessionData({ storage: null })).toBe(0);
    expect(sweepLogoutSessionData({ storage: createStorage() })).toBe(0);
  });
});
