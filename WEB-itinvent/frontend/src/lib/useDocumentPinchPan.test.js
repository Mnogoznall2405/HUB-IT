import { describe, expect, it } from 'vitest';
import {
  buildDocumentContentSx,
  buildDocumentViewportSx,
  clampDocumentZoom,
} from './useDocumentPinchPan';

describe('useDocumentPinchPan helpers', () => {
  it('clamps zoom values inside allowed bounds', () => {
    expect(clampDocumentZoom(0.2)).toBe(1);
    expect(clampDocumentZoom(1.4)).toBe(1.4);
    expect(clampDocumentZoom(4)).toBe(3);
    expect(clampDocumentZoom(Number.NaN)).toBe(1);
  });

  it('does not apply transform styles at default zoom', () => {
    expect(buildDocumentContentSx({ scale: 1, x: 0, y: 0 }, false)).toEqual({});
  });

  it('applies transform styles only when zoomed', () => {
    expect(buildDocumentContentSx({ scale: 1.5, x: 12, y: 8 }, true)).toEqual({
      transform: 'translate3d(12px, 8px, 0) scale(1.5)',
      transformOrigin: '0 0',
      willChange: 'transform',
    });
  });

  it('uses native scroll styles when not zoomed', () => {
    expect(buildDocumentViewportSx(false)).toMatchObject({
      overflowY: 'auto',
      touchAction: 'pan-y pinch-zoom',
    });
  });

  it('locks viewport scrolling when zoomed', () => {
    expect(buildDocumentViewportSx(true)).toMatchObject({
      overflowY: 'hidden',
      touchAction: 'none',
    });
  });
});
