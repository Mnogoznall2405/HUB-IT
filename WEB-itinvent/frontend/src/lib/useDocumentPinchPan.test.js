import { describe, expect, it } from 'vitest';
import { clampDocumentZoom } from './useDocumentPinchPan';

describe('useDocumentPinchPan helpers', () => {
  it('clamps zoom values inside allowed bounds', () => {
    expect(clampDocumentZoom(0.2)).toBe(1);
    expect(clampDocumentZoom(1.4)).toBe(1.4);
    expect(clampDocumentZoom(4)).toBe(3);
    expect(clampDocumentZoom(Number.NaN)).toBe(1);
  });
});
