import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClientMocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('./client', () => ({ default: apiClientMocks }));

import { desktopPresenceAPI } from './desktopPresence';

describe('desktopPresenceAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the authenticated session without sending a client identity', async () => {
    apiClientMocks.post.mockResolvedValue({ data: { active: true, expires_in_seconds: 180 } });
    apiClientMocks.get.mockResolvedValue({ data: { active: true, expires_in_seconds: 120 } });
    apiClientMocks.delete.mockResolvedValue({ data: { active: false, expires_in_seconds: 0 } });

    await expect(desktopPresenceAPI.heartbeat()).resolves.toEqual({
      active: true,
      expires_in_seconds: 180,
    });
    await expect(desktopPresenceAPI.getStatus()).resolves.toEqual({
      active: true,
      expires_in_seconds: 120,
    });
    await expect(desktopPresenceAPI.disconnect()).resolves.toEqual({
      active: false,
      expires_in_seconds: 0,
    });

    expect(apiClientMocks.post).toHaveBeenCalledWith('/desktop-presence/heartbeat', {});
    expect(apiClientMocks.get).toHaveBeenCalledWith('/desktop-presence/status');
    expect(apiClientMocks.delete).toHaveBeenCalledWith('/desktop-presence/current');
  });
});
