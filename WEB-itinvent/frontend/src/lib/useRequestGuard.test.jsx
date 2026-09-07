import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import useRequestGuard from './useRequestGuard';

it('invalidates earlier requests, changed scopes, and unmounted consumers', () => {
  const { result, rerender, unmount } = renderHook(({ scope }) => useRequestGuard(scope), {
    initialProps: { scope: 'A' },
  });
  const old = result.current();
  const latest = result.current();
  expect(old()).toBe(false);
  expect(latest()).toBe(true);
  rerender({ scope: 'B' });
  expect(latest()).toBe(false);
  rerender({ scope: 'A' });
  expect(latest()).toBe(false);
  const pending = result.current();
  unmount();
  expect(pending()).toBe(false);
});
