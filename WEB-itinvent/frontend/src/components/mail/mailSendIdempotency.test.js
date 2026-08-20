import { describe, expect, it } from 'vitest';
import {
  createMailSendIdempotencyKey,
  takeMailSendIdempotencyKey,
  withMailSendIdempotencyHeaders,
} from './mailSendIdempotency';

describe('mailSendIdempotency', () => {
  it('creates a non-empty client key', () => {
    const key = createMailSendIdempotencyKey();
    expect(key).toEqual(expect.any(String));
    expect(key.length).toBeGreaterThanOrEqual(8);
  });

  it('moves the key from payload into the Idempotency-Key header', () => {
    const { key, body } = takeMailSendIdempotencyKey({
      to: ['a@example.com'],
      idempotencyKey: 'compose-key-1',
    });
    expect(key).toBe('compose-key-1');
    expect(body).toEqual({ to: ['a@example.com'] });
    expect(withMailSendIdempotencyHeaders({ 'Content-Type': 'multipart/form-data' }, key)).toEqual({
      'Content-Type': 'multipart/form-data',
      'Idempotency-Key': 'compose-key-1',
    });
  });
});
