import { describe, expect, it } from 'vitest';
import { buildItRequestFieldDefaults } from './useMailItRequest';

describe('buildItRequestFieldDefaults', () => {
  it('builds string field defaults from an IT request template', () => {
    expect(buildItRequestFieldDefaults({
      fields: [
        { key: 'inventory_number', default_value: 101795 },
        { key: 'roles', default_value: ['reader', 'editor'] },
        { key: '', default_value: 'ignored' },
        { key: 'comment', default_value: null },
      ],
    })).toEqual({
      inventory_number: '101795',
      roles: 'reader, editor',
      comment: '',
    });
  });
});
