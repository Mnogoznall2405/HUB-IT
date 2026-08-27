import * as Crypto from 'expo-crypto';
import { createFeedClientRequestId } from './feedRequestId';

describe('createFeedClientRequestId', () => {
  it('uses the native UUID and always has a non-empty fallback', () => {
    const spy = jest.spyOn(Crypto, 'randomUUID');
    spy.mockReturnValueOnce('native-id');
    expect(createFeedClientRequestId()).toBe('native-id');
    spy.mockReturnValueOnce(undefined as never);
    expect(createFeedClientRequestId()).toMatch(/^feed-/);
    spy.mockRestore();
  });
});
