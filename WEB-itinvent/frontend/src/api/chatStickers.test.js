import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./client', () => ({ default: apiClientMock }));

import { chatStickersAPI } from './chatStickers';

describe('chatStickersAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows long Telegram pack imports to finish', async () => {
    apiClientMock.post.mockResolvedValue({ data: { items: [] } });

    await chatStickersAPI.importPack(' https://t.me/addstickers/frrl52 ');

    expect(apiClientMock.post).toHaveBeenCalledWith(
      '/chat/sticker-packs/import',
      { source: 'https://t.me/addstickers/frrl52' },
      { timeout: 120000 },
    );
  });
});
