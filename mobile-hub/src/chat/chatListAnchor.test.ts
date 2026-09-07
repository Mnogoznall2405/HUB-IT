import {
  isNearBottomOffset,
  shouldAnimateBottomAnchor,
  shouldRequestBottomAnchor,
  shouldUseMaintainVisibleContentPosition,
} from './chatListAnchor';

describe('inverted chat list anchor', () => {
  it('keeps maintainVisibleContentPosition only while older messages prepend', () => {
    expect(shouldUseMaintainVisibleContentPosition(true)).toBe(true);
    expect(shouldUseMaintainVisibleContentPosition(false)).toBe(false);
  });

  it('anchors own send and keeps a resized composer attached to the bottom', () => {
    expect(shouldRequestBottomAnchor('own-send', false)).toBe(true);
    expect(shouldRequestBottomAnchor('composer-layout', true)).toBe(true);
    expect(shouldRequestBottomAnchor('composer-layout', false)).toBe(false);
    expect(shouldRequestBottomAnchor('incoming', true)).toBe(true);
    expect(shouldRequestBottomAnchor('incoming', false)).toBe(false);
    expect(shouldRequestBottomAnchor('prepend-older', true)).toBe(false);
  });

  it('does not animate the first landing of an outgoing message', () => {
    expect(shouldAnimateBottomAnchor('own-send', false)).toBe(false);
    expect(shouldAnimateBottomAnchor('layout', false)).toBe(false);
    expect(shouldAnimateBottomAnchor('incoming', false)).toBe(true);
    expect(shouldAnimateBottomAnchor('incoming', true)).toBe(false);
  });

  it('treats inverted offset below the threshold as near the composer', () => {
    expect(isNearBottomOffset(0)).toBe(true);
    expect(isNearBottomOffset(95)).toBe(true);
    expect(isNearBottomOffset(96)).toBe(false);
  });
});

it('preserves the visible message while reading history when new data arrives', () => {
  expect(shouldUseMaintainVisibleContentPosition(false, false)).toBe(true);
  expect(shouldRequestBottomAnchor('incoming', false)).toBe(false);
  expect(shouldRequestBottomAnchor('composer-layout', false)).toBe(false);
});
