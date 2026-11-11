import { createMailRichSnapshotRequest } from './mailRichSnapshotRequest';

afterEach(() => jest.useRealTimers());

it('accepts only the matching response and rejects concurrent requests', async () => {
  const requests = createMailRichSnapshotRequest();
  let id = 0;
  const pending = requests.request((value) => { id = value; });
  await expect(requests.request(() => undefined)).rejects.toThrow('Дождитесь');
  expect(requests.receive({ type: 'snapshot', id: id - 1, html: 'old', text: 'old' })).toBe(false);
  expect(requests.receive({ type: 'snapshot', id, html: '<b>Последняя</b>', text: 'Последняя' })).toBe(true);
  await expect(pending).resolves.toEqual({ html: '<b>Последняя</b>', text: 'Последняя' });
});

it('times out without falling back to a stale value, then allows a fresh request', async () => {
  jest.useFakeTimers();
  const requests = createMailRichSnapshotRequest();
  let oldId = 0;
  const timedOut = expect(requests.request((id) => { oldId = id; })).rejects.toThrow('последнюю версию');
  jest.advanceTimersByTime(3500); await timedOut;
  let newId = 0;
  const fresh = requests.request((id) => { newId = id; });
  expect(requests.receive({ type: 'snapshot', id: oldId, html: 'old', text: 'old' })).toBe(false);
  requests.receive({ type: 'snapshot', id: newId, html: 'new', text: 'new' });
  await expect(fresh).resolves.toEqual({ html: 'new', text: 'new' });
});

it.each(['unmount', 'invalid', 'injection'] as const)('rejects a pending snapshot on %s', async (failure) => {
  const requests = createMailRichSnapshotRequest();
  let id = 0;
  const result = requests.request((value) => { id = value; if (failure === 'injection') throw new Error('Synthetic'); });
  const rejected = expect(result).rejects.toThrow('последнюю версию');
  if (failure === 'unmount') requests.cancel();
  if (failure === 'invalid') requests.receive({ type: 'snapshot', id, html: 123, text: 'text' });
  await rejected;
});
