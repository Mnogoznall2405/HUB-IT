// Targeted re-read of a branch's context: after a mutation only the parts it can change are fetched,
// instead of all six reads plus the 10 000-row port list.
const PART_LOADERS = {
  overview: (api, id) => api.getBranchOverview(id).then((value) => ({ overview: value || null })),
  devices: (api, id) => api.getDevices(id).then((value) => ({ devices: Array.isArray(value?.devices) ? value.devices : [] })),
  maps: (api, id) => api.getMaps(id).then((value) => ({ maps: Array.isArray(value?.maps) ? value.maps : [] })),
  points: (api, id) => api.getMapPoints(id).then((value) => ({ points: Array.isArray(value?.points) ? value.points : [] })),
  audit: (api, id) => api.getAudit({ branch_id: id, limit: 100 }).then((value) => ({ audit: Array.isArray(value?.items) ? value.items : [] })),
  sockets: (api, id) => api.getBranchSockets(id, { limit: 10000 }).then((value) => ({ sockets: Array.isArray(value?.sockets) ? value.sockets : [] })),
};

// A marker drag changes only the point's position and appends an audit record.
export const POINT_POSITION_PARTS = ['points', 'audit'];

// Returns the fields that were read successfully; a failed part is left out so the screen keeps its old value.
export async function loadBranchContextParts(api, branchId, parts) {
  const names = [...new Set(parts)].filter((name) => PART_LOADERS[name]);
  const settled = await Promise.allSettled(names.map((name) => PART_LOADERS[name](api, branchId)));
  const patch = {};
  const errors = {};
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') Object.assign(patch, result.value);
    else errors[names[index]] = result.reason;
  });
  return { patch, errors };
}
