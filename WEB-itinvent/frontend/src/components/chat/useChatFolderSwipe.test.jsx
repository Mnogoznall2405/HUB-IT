import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useChatFolderSwipe } from './useChatFolderSwipe';

function SwipeHarness({
  enabled,
  activeFolderKey,
  customFolders,
  onFolderChange,
}) {
  const { setScrollElement } = useChatFolderSwipe({
    enabled,
    activeFolderKey,
    customFolders,
    onFolderChange,
  });

  return (
    <div ref={setScrollElement} data-testid="swipe-zone">
      <button type="button">row</button>
    </div>
  );
}

describe('useChatFolderSwipe', () => {
  it('switches to the next folder on left swipe over a list row button', () => {
    const onFolderChange = vi.fn();
    render(
      <SwipeHarness
        enabled
        activeFolderKey="personal"
        customFolders={[]}
        onFolderChange={onFolderChange}
      />,
    );

    const row = screen.getByRole('button', { name: 'row' });
    fireEvent.touchStart(row, { touches: [{ clientX: 220, clientY: 300 }] });
    fireEvent.touchMove(row, { touches: [{ clientX: 120, clientY: 302 }] });
    fireEvent.touchEnd(row);

    expect(onFolderChange).toHaveBeenCalledWith('tasks');
  });

  it('does not switch folders on vertical gesture', () => {
    const onFolderChange = vi.fn();
    render(
      <SwipeHarness
        enabled
        activeFolderKey="personal"
        customFolders={[]}
        onFolderChange={onFolderChange}
      />,
    );

    const zone = screen.getByTestId('swipe-zone');
    fireEvent.touchStart(zone, { touches: [{ clientX: 220, clientY: 200 }] });
    fireEvent.touchMove(zone, { touches: [{ clientX: 222, clientY: 320 }] });
    fireEvent.touchEnd(zone);

    expect(onFolderChange).not.toHaveBeenCalled();
  });

  it('ignores gestures when disabled', () => {
    const onFolderChange = vi.fn();
    render(
      <SwipeHarness
        enabled={false}
        activeFolderKey="personal"
        customFolders={[]}
        onFolderChange={onFolderChange}
      />,
    );

    const zone = screen.getByTestId('swipe-zone');
    fireEvent.touchStart(zone, { touches: [{ clientX: 220, clientY: 300 }] });
    fireEvent.touchMove(zone, { touches: [{ clientX: 100, clientY: 300 }] });
    fireEvent.touchEnd(zone);

    expect(onFolderChange).not.toHaveBeenCalled();
  });
});
