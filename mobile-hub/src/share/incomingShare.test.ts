import {
  clearQueuedIncomingShareForTests,
  consumeIncomingShare,
  normalizeIncomingTextShare,
  queueIncomingShare,
} from './incomingShare';

const share = {
  id: 'share-1',
  text: 'https://example.com/report',
  subject: 'Отчёт',
  mimeType: 'text/plain',
  receivedAt: 1_787_400_000_000,
};

beforeEach(clearQueuedIncomingShareForTests);

it('accepts bounded plain-text shares and rejects unsafe payloads', () => {
  expect(normalizeIncomingTextShare(share)).toEqual(share);
  expect(normalizeIncomingTextShare({ ...share, mimeType: 'application/octet-stream' })).toBeNull();
  expect(normalizeIncomingTextShare({ ...share, text: '' })).toBeNull();
  expect(normalizeIncomingTextShare({ ...share, id: '' })).toBeNull();
});

it('passes an incoming share to the selected native composer exactly once', () => {
  queueIncomingShare(share, 'task');
  expect(consumeIncomingShare('mail')).toBeNull();
  expect(consumeIncomingShare('task')).toEqual({ ...share, target: 'task' });
  expect(consumeIncomingShare('task')).toBeNull();
});
