import { describe, expect, it, vi } from 'vitest';
import { POINT_POSITION_PARTS, loadBranchContextParts } from './networksBranchContext';

const makeApi = () => ({
  getBranchOverview: vi.fn(async () => ({ total: 1 })),
  getDevices: vi.fn(async () => ({ devices: [{ id: 1 }] })),
  getMaps: vi.fn(async () => ({ maps: [{ id: 2 }] })),
  getMapPoints: vi.fn(async () => ({ points: [{ id: 3 }] })),
  getAudit: vi.fn(async () => ({ items: [{ id: 4 }] })),
  getBranchSockets: vi.fn(async () => ({ sockets: [{ id: 5 }] })),
});

describe('loadBranchContextParts', () => {
  it('after a marker drag reads only points and audit, not the heavy socket and port lists', async () => {
    const api = makeApi();
    const { patch, errors } = await loadBranchContextParts(api, 9, POINT_POSITION_PARTS);
    expect(patch).toEqual({ points: [{ id: 3 }], audit: [{ id: 4 }] });
    expect(errors).toEqual({});
    expect(api.getMapPoints).toHaveBeenCalledWith(9);
    expect(api.getAudit).toHaveBeenCalledWith({ branch_id: 9, limit: 100 });
    for (const heavy of ['getBranchSockets', 'getDevices', 'getMaps', 'getBranchOverview']) {
      expect(api[heavy]).not.toHaveBeenCalled();
    }
  });

  it('keeps the old value of a part whose read failed instead of blanking it', async () => {
    const api = makeApi();
    api.getAudit.mockRejectedValue(new Error('boom'));
    const { patch, errors } = await loadBranchContextParts(api, 9, ['points', 'audit']);
    expect(patch).toEqual({ points: [{ id: 3 }] });
    expect(Object.keys(errors)).toEqual(['audit']);
  });
});
