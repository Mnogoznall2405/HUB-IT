import apiClient from './client';
import { getConstructionObjects, getConstructionRequests, getConstructionRequest, getConstructionWork } from './constructionApi';
jest.mock('./client', () => ({ __esModule: true, default: { get: jest.fn() } }));
beforeEach(() => { jest.clearAllMocks(); (apiClient.get as jest.Mock).mockResolvedValue({ data: { items: [] } }); });
it('reads object and direction progress using the existing date and archive contract', async () => {
  const signal = new AbortController().signal;
  const params = { as_of: '2026-09-08', include_archived: true };
  await getConstructionWork({ objectId: 'o?' }, params, signal);
  expect(apiClient.get).toHaveBeenLastCalledWith('/construction/objects/o%3F/work-progress', { timeout: 50000, signal, params });
  await getConstructionWork({ objectId: 'o', groupRef: 'g#' }, params, signal);
  expect(apiClient.get).toHaveBeenLastCalledWith('/construction/objects/o/directions/g%23/work-progress', { timeout: 50000, signal, params });
});
it('passes filters and pagination using the existing construction API contract', async () => {
  const signal = new AbortController().signal;
  await getConstructionObjects({ q: 'Север', kind: 'project', cursor: 'next' }, signal);
  expect(apiClient.get).toHaveBeenCalledWith('/construction/objects', { timeout: 50000, signal, params: { q: 'Север', kind: 'project', cursor: 'next', limit: 24 } });
  await getConstructionRequests({ objectId: 'object', groupRef: 'group' }, { view: 'history' }, signal);
  expect(apiClient.get).toHaveBeenLastCalledWith('/construction/objects/object/directions/group/requests', expect.objectContaining({ signal, params: { view: 'history', limit: 25 } }));
});
it('encodes identifiers and reads the direct request response without an invented envelope', async () => {
  const request = { request_ref: 'ref', request_number: '100' };
  (apiClient.get as jest.Mock).mockResolvedValue({ data: request });
  await expect(getConstructionRequest({ objectId: 'object?', requestRef: 'ref#' })).resolves.toEqual(request);
  expect(apiClient.get).toHaveBeenCalledWith('/construction/objects/object%3F/requests/ref%23', expect.any(Object));
});
