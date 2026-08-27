import { resolveNativeMailImageViewerGesture } from './nativeMailImageViewer';

describe('native mail image viewer gestures', () => {
  it('pages horizontally and dismisses only on a dominant downward swipe', () => {
    expect(resolveNativeMailImageViewerGesture({ dx: -110, dy: 12, canPrevious: true, canNext: true })).toBe('next');
    expect(resolveNativeMailImageViewerGesture({ dx: 105, dy: 8, canPrevious: true, canNext: true })).toBe('previous');
    expect(resolveNativeMailImageViewerGesture({ dx: 18, dy: 130, canPrevious: true, canNext: true })).toBe('dismiss');
    expect(resolveNativeMailImageViewerGesture({ dx: 100, dy: 120, canPrevious: true, canNext: true })).toBe('settle');
  });

  it('does not page past gallery boundaries', () => {
    expect(resolveNativeMailImageViewerGesture({ dx: 120, dy: 0, canPrevious: false, canNext: true })).toBe('settle');
    expect(resolveNativeMailImageViewerGesture({ dx: -120, dy: 0, canPrevious: true, canNext: false })).toBe('settle');
  });
});
