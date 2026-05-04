import { describe, expect, it } from 'vitest';
import { normalizeSelectedMessageIds } from './useMailBulkActions';

describe('normalizeSelectedMessageIds', () => {
  it('keeps stable unique message ids for bulk actions', () => {
    expect(normalizeSelectedMessageIds(['msg-1', '', null, 'msg-2', 'msg-1'])).toEqual(['msg-1', 'msg-2']);
  });
});
