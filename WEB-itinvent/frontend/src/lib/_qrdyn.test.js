import { describe, expect, it, vi } from 'vitest';
const spy = vi.hoisted(() => vi.fn(async (t) => 'mock:' + t));
vi.mock('qrcode', () => ({ default: { toDataURL: spy } }));
describe('dyn', () => {
  it('mocks both dynamic imports', async () => {
    const a = await import('qrcode').then(({ default: Q }) => Q.toDataURL('one'));
    const b = await import('qrcode').then(({ default: Q }) => Q.toDataURL('two'));
    console.log('A:', a, 'B:', b, 'calls:', spy.mock.calls.length);
    expect(a).toBe('mock:one');
    expect(b).toBe('mock:two');
  });
});
