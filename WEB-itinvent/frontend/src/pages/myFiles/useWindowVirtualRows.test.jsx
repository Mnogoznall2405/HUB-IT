import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWindowVirtualRows } from './useWindowVirtualRows';

const ROW_H = 64;

function setScroll(y) {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
}

function mountAtTop(container) {
  // The hook works in document coordinates: place the container at docTop=0.
  container.getBoundingClientRect = () => ({ top: -window.scrollY, width: 800, height: 0, left: 0, right: 800, bottom: 0 });
}

function Harness({ itemCount = 100, rowHeight = ROW_H, overscan = 8, attach = true, itemStride = 1 }) {
  const v = useWindowVirtualRows({ itemCount, rowHeight, overscan, itemStride });
  return (
    <div>
      <div ref={attach ? v.containerRef : undefined} data-testid="container">
        <div data-testid="top" style={{ height: v.topSpacerHeight }} />
        {Array.from({ length: v.end - v.start }).map((_, i) => (
          <div data-testid="row" tabIndex={0} key={v.start + i} data-vindex={v.start + i} />
        ))}
        <div data-testid="bottom" style={{ height: v.bottomSpacerHeight }} />
        <span data-testid="meta">{`${v.start}:${v.end}`}</span>
      </div>
    </div>
  );
}

function meta(getByTestId) {
  const [start, end] = getByTestId('meta').textContent.split(':').map(Number);
  return { start, end };
}

describe('useWindowVirtualRows', () => {
  it('does not throw when update runs with no container attached (widthRef regression)', () => {
    const { getByTestId } = render(<Harness itemCount={0} attach={false} />);
    expect(() => act(() => { window.dispatchEvent(new Event('scroll')); })).not.toThrow();
    expect(getByTestId('meta').textContent).toBe('0:0');
  });

  it('keeps 0 <= start <= end <= itemCount and a consistent spacer sum on deep scroll', async () => {
    const { getByTestId, rerender } = render(<Harness itemCount={100} rowHeight={ROW_H} />);
    const container = getByTestId('container');
    mountAtTop(container);
    await act(async () => { window.dispatchEvent(new Event('scroll')); });

    // Scroll far below the list bottom, then shrink itemCount — the window
    // must clamp instead of inverting (old code returned start > itemCount).
    setScroll(10_000);
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    rerender(<Harness itemCount={5} rowHeight={ROW_H} />);
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    await waitFor(() => {
      const { start, end } = meta(getByTestId);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(5);
      expect(start).toBeLessThanOrEqual(end);
    });
    const top = Number(getByTestId('top').style.height.replace('px', ''));
    const bottom = Number(getByTestId('bottom').style.height.replace('px', ''));
    const mounted = meta(getByTestId).end - meta(getByTestId).start;
    expect(top + mounted * ROW_H + bottom).toBe(5 * ROW_H);
  });

  it('mounts the visible window plus overscan and clamps start at zero', async () => {
    const { getByTestId } = render(<Harness itemCount={100} rowHeight={ROW_H} overscan={4} />);
    const container = getByTestId('container');
    mountAtTop(container);
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    const { start, end } = meta(getByTestId);
    expect(start).toBe(0);
    expect(end).toBeGreaterThan(0);
    expect(end).toBeLessThanOrEqual(100);
    // Total rendered height must always equal itemCount * rowHeight.
    const top = Number(getByTestId('top').style.height.replace('px', ''));
    const bottom = Number(getByTestId('bottom').style.height.replace('px', ''));
    expect(top + (end - start) * ROW_H + bottom).toBe(100 * ROW_H);
  });

  it('restores focus to the same item when the focused row unmounts', async () => {
    const { getByTestId, getAllByTestId } = render(<Harness itemCount={100} rowHeight={ROW_H} overscan={2} />);
    const container = getByTestId('container');
    mountAtTop(container);
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    const row = getAllByTestId('row')[2];
    row.focus();
    expect(document.activeElement).toBe(row);
    const vindex = Number(row.dataset.vindex);

    // Scroll far enough that the focused row leaves the mounted slice.
    setScroll(ROW_H * 60);
    await act(async () => { window.dispatchEvent(new Event('scroll')); });
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement?.dataset?.vindex).toBeDefined();
    });
    const restored = Number(document.activeElement.dataset.vindex);
    const { start, end } = meta(getByTestId);
    expect(restored).toBe(Math.max(start, Math.min(vindex, end - 1)));
  });
});
