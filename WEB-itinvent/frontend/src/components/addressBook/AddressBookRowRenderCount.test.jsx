// A22 proof: memoized rows re-render only when their own props change.
// The mock row counts real render calls; `__AB_NO_MEMO` replays the same
// scenario with the pre-A22 (unmemoized) behaviour for a before/after number.
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddressBookEntryList from './AddressBookEntryList';
import { getEntryKey } from './addressBookUtils';
import * as RowModule from './AddressBookEntryRow';

vi.mock('./AddressBookEntryRow', async () => {
  const ReactModule = await import('react');
  const counts = new Map();
  const PlainRow = ({ item, entryKey }) => {
    counts.set(entryKey, (counts.get(entryKey) || 0) + 1);
    return <div data-testid={`address-book-entry-row-${entryKey}`}>{item.full_name}</div>;
  };
  const MemoRow = ReactModule.memo(PlainRow);
  return {
    __esModule: true,
    default: (props) => (
      globalThis.__AB_NO_MEMO
        ? <PlainRow {...props} />
        : <MemoRow {...props} />
    ),
    __counts: counts,
  };
});

const setMatchMedia = () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const buildItems = (count) => Array.from({ length: count }, (_, index) => ({
  full_name: `Person ${index}`,
  department: 'Dept',
  position: 'Engineer',
  employee_code: `E${index}`,
  work_phones: [],
  work_emails: [],
}));

const items = buildItems(20);
const keyOf = (index) => getEntryKey(items[index], index);
const counts = () => RowModule.__counts;
const totalRenders = () => [...counts().values()].reduce((sum, n) => sum + n, 0);

describe('A22 row memoization', () => {
  beforeEach(() => {
    setMatchMedia();
    counts().clear();
    delete globalThis.__AB_NO_MEMO;
  });

  it('selection change re-renders only the affected rows (memo on)', async () => {
    const stable = {
      onSelect: vi.fn(),
      onOpenTelegram: vi.fn(),
      onComposeEmail: vi.fn(),
      onOpenChat: vi.fn(),
    };
    const view = render(
      <AddressBookEntryList items={items} selectedEntryKey={keyOf(0)} {...stable} />,
    );
    await screen.findByTestId(`address-book-entry-row-${keyOf(0)}`);
    counts().clear();

    await act(async () => {
      view.rerender(
        <AddressBookEntryList items={items} selectedEntryKey={keyOf(5)} {...stable} />,
      );
    });

    // Rows 0 and 5 changed (selected/active flags); the other 18 stay memoized.
    expect(counts().get(keyOf(2)) || 0).toBe(0);
    expect(counts().get(keyOf(19)) || 0).toBe(0);
    expect(totalRenders()).toBeLessThanOrEqual(4);
    expect(totalRenders()).toBeGreaterThan(0);
  });

  it('the same scenario without memo re-renders every row (before)', async () => {
    globalThis.__AB_NO_MEMO = true;
    const stable = {
      onSelect: vi.fn(),
      onOpenTelegram: vi.fn(),
      onComposeEmail: vi.fn(),
      onOpenChat: vi.fn(),
    };
    const view = render(
      <AddressBookEntryList items={items} selectedEntryKey={keyOf(0)} {...stable} />,
    );
    await screen.findByTestId(`address-book-entry-row-${keyOf(0)}`);
    counts().clear();

    await act(async () => {
      view.rerender(
        <AddressBookEntryList items={items} selectedEntryKey={keyOf(5)} {...stable} />,
      );
    });

    // Without memo every row re-renders at least once per parent commit.
    expect(counts().get(keyOf(2))).toBeGreaterThanOrEqual(1);
    expect(totalRenders()).toBeGreaterThanOrEqual(items.length);
  });

  it('measures render time of 200 rows before/after memoization', async () => {
    const big = buildItems(200);
    const stable = {
      onSelect: vi.fn(),
      onOpenTelegram: vi.fn(),
      onComposeEmail: vi.fn(),
      onOpenChat: vi.fn(),
    };
    const measure = () => {
      const view = render(
        <AddressBookEntryList items={big} selectedEntryKey={getEntryKey(big[0], 0)} {...stable} />,
      );
      counts().clear();
      const start = performance.now();
      act(() => {
        view.rerender(
          <AddressBookEntryList items={big} selectedEntryKey={getEntryKey(big[7], 7)} {...stable} />,
        );
      });
      const elapsed = performance.now() - start;
      const renders = totalRenders();
      view.unmount();
      return { elapsed, renders };
    };

    const after = measure();
    globalThis.__AB_NO_MEMO = true;
    const before = measure();
    delete globalThis.__AB_NO_MEMO;

    // jsdom timing is informational (mocked rows are cheap); the hard gate is
    // the render count — memoized rows skip re-rendering entirely.
    console.log(
      `A22 jsdom 200-row rerender: before=${before.elapsed.toFixed(1)}ms/${before.renders} renders`
      + ` after=${after.elapsed.toFixed(1)}ms/${after.renders} renders`,
    );
    expect(after.renders).toBeLessThan(before.renders);
    expect(after.renders).toBeLessThanOrEqual(8);
  });
});
