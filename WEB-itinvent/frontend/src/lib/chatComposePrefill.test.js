import { describe, expect, it, beforeEach } from 'vitest';
import {
  CHAT_COMPOSE_PREFILL_STORAGE_KEY,
  clearChatComposePrefill,
  readChatComposePrefill,
  stashChatComposePrefill,
} from './chatComposePrefill';

describe('chatComposePrefill', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('stores and reads peer prefill payload', () => {
    stashChatComposePrefill({ peerUserId: 42, bodyText: 'Ссылка для скачивания:\nhttps://example.com' });
    const prefill = readChatComposePrefill();
    expect(prefill?.peerUserId).toBe(42);
    expect(prefill?.bodyText).toContain('https://example.com');
  });

  it('clears stored prefill', () => {
    stashChatComposePrefill({ peerUserId: 1, bodyText: 'test' });
    clearChatComposePrefill();
    expect(window.sessionStorage.getItem(CHAT_COMPOSE_PREFILL_STORAGE_KEY)).toBeNull();
    expect(readChatComposePrefill()).toBeNull();
  });
});
