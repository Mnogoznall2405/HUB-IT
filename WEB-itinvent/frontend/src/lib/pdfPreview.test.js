import { describe, expect, it, vi } from 'vitest';

import {
  clampPdfDisplayScale,
  renderPdfPage,
  resolveInitialPdfFitZoom,
  resolvePdfOutputScale,
} from './pdfPreview';

describe('pdfPreview helpers', () => {
  it('clamps display scale to supported zoom bounds', () => {
    expect(clampPdfDisplayScale(0.1)).toBe(0.25);
    expect(clampPdfDisplayScale(1)).toBe(1);
    expect(clampPdfDisplayScale(3)).toBe(2.5);
  });

  it('caps output scale for HiDPI canvases', () => {
    expect(resolvePdfOutputScale(1)).toBe(1);
    expect(resolvePdfOutputScale(2)).toBe(2);
    expect(resolvePdfOutputScale(3.5)).toBe(3);
    expect(resolvePdfOutputScale(undefined)).toBe(1);
  });

  it('fits wide PDF pages to the available preview width', () => {
    expect(resolveInitialPdfFitZoom({
      pageWidth: 800,
      containerWidth: 400,
      horizontalPadding: 24,
    })).toBe(0.5);
    expect(resolveInitialPdfFitZoom({
      pageWidth: 360,
      containerWidth: 400,
      horizontalPadding: 24,
    })).toBe(1);
  });
});

describe('renderPdfPage', () => {
  it('renders with devicePixelRatio transform for sharp canvas output', async () => {
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    const getViewport = vi.fn(({ scale }) => ({
      width: 400 * scale,
      height: 560 * scale,
    }));
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: () => ({
        setTransform: vi.fn(),
        clearRect: vi.fn(),
      }),
    };
    const pdf = {
      getPage: vi.fn().mockResolvedValue({
        getViewport,
        render,
      }),
    };

    await renderPdfPage({
      pdf,
      pageNumber: 1,
      canvas,
      scale: 1,
      devicePixelRatio: 2,
    });

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(1120);
    expect(canvas.style.width).toBe('400px');
    expect(canvas.style.height).toBe('560px');
    expect(render).toHaveBeenCalledWith({
      canvasContext: expect.any(Object),
      viewport: expect.objectContaining({ width: 400, height: 560 }),
      transform: [2, 0, 0, 2, 0, 0],
    });
  });
});
