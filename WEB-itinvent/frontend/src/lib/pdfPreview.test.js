import { describe, expect, it, vi } from 'vitest';

import {
  buildPdfDocumentOptions,
  clampPdfDisplayScale,
  renderPdfPageLayers,
  renderPdfPage,
  resolveInitialPdfFitZoom,
  resolvePdfOutputScale,
} from './pdfPreview';

describe('pdfPreview helpers', () => {
  it('enables XFA and local PDF.js rendering assets', () => {
    const data = new ArrayBuffer(8);
    expect(buildPdfDocumentOptions({ data, baseUrl: '/itinvent/' })).toEqual({
      data,
      enableXfa: true,
      cMapUrl: '/itinvent/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/itinvent/pdfjs/standard_fonts/',
      wasmUrl: '/itinvent/pdfjs/wasm/',
      iccUrl: '/itinvent/pdfjs/iccs/',
      useSystemFonts: true,
    });
  });

  it('clamps display scale to supported zoom bounds', () => {
    expect(clampPdfDisplayScale(0.1)).toBe(0.25);
    expect(clampPdfDisplayScale(1)).toBe(1);
    expect(clampPdfDisplayScale(3)).toBe(3);
    expect(clampPdfDisplayScale(5)).toBe(4);
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

describe('renderPdfPageLayers', () => {
  it('renders pure XFA content into a dedicated layer', async () => {
    const xfaHtml = { name: 'div', children: [] };
    const renderXfa = vi.fn();
    const layerContainer = document.createElement('div');
    const viewport = {
      width: 400,
      height: 560,
      clone: vi.fn(() => ({ width: 400, height: 560 })),
    };
    const page = {
      isPureXfa: true,
      getXfa: vi.fn().mockResolvedValue(xfaHtml),
    };

    const result = await renderPdfPageLayers({
      pdfjs: { XfaLayer: { render: renderXfa } },
      pdf: { annotationStorage: {} },
      page,
      viewport,
      layerContainer,
    });

    expect(renderXfa).toHaveBeenCalledWith(expect.objectContaining({
      xfaHtml,
      intent: 'display',
    }));
    expect(result).toEqual(expect.objectContaining({ xfa: true, annotations: 0 }));
    expect(layerContainer.shadowRoot.querySelector('.xfaLayer')).not.toBeNull();
  });

  it('renders AcroForm annotations as read-only controls', async () => {
    const input = document.createElement('input');
    const annotationRender = vi.fn(async ({ div }) => {
      div.append(input);
    });
    class FakeAnnotationLayer {
      render = annotationRender;
    }
    const layerContainer = document.createElement('div');
    const viewport = {
      width: 400,
      height: 560,
      clone: vi.fn(() => ({ width: 400, height: 560 })),
    };
    const page = {
      isPureXfa: false,
      getAnnotations: vi.fn().mockResolvedValue([{ id: 'field-1' }]),
    };

    const result = await renderPdfPageLayers({
      pdfjs: { AnnotationLayer: FakeAnnotationLayer },
      pdf: { annotationStorage: {} },
      page,
      viewport,
      layerContainer,
    });

    expect(annotationRender).toHaveBeenCalledWith(expect.objectContaining({
      renderForms: true,
    }));
    expect(input.readOnly).toBe(true);
    expect(input.tabIndex).toBe(-1);
    expect(result).toEqual(expect.objectContaining({ xfa: false, annotations: 1 }));
  });
});

describe('renderPdfPage', () => {
  it('cancels and settles the previous render before reusing the same canvas', async () => {
    let rejectFirstRender;
    const cancelledError = new Error('Rendering cancelled');
    cancelledError.name = 'RenderingCancelledException';
    const firstTask = {
      cancel: vi.fn(() => rejectFirstRender(cancelledError)),
      promise: new Promise((_resolve, reject) => {
        rejectFirstRender = reject;
      }),
    };
    const secondTask = {
      cancel: vi.fn(),
      promise: Promise.resolve(),
    };
    const render = vi.fn()
      .mockReturnValueOnce(firstTask)
      .mockReturnValueOnce(secondTask);
    const page = {
      getViewport: ({ scale }) => ({ width: 400 * scale, height: 560 * scale }),
      render,
    };
    const pdf = { getPage: vi.fn().mockResolvedValue(page) };
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: () => ({ setTransform: vi.fn(), clearRect: vi.fn() }),
    };

    const firstRender = renderPdfPage({ pdf, pageNumber: 1, canvas });
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));

    const secondRender = renderPdfPage({ pdf, pageNumber: 1, canvas, rotation: 90 });
    await vi.waitFor(() => expect(firstTask.cancel).toHaveBeenCalledTimes(1));
    await expect(firstRender).rejects.toMatchObject({ name: 'RenderingCancelledException' });
    await expect(secondRender).resolves.toMatchObject({ width: 400, height: 560 });
    expect(render).toHaveBeenCalledTimes(2);
  });

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

  it('passes normalized rotation to PDF.js viewport rendering', async () => {
    const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
    const getViewport = vi.fn(({ scale, rotation }) => ({
      width: (rotation === 90 ? 560 : 400) * scale,
      height: (rotation === 90 ? 400 : 560) * scale,
    }));
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: () => ({ setTransform: vi.fn(), clearRect: vi.fn() }),
    };
    const pdf = {
      getPage: vi.fn().mockResolvedValue({ getViewport, render }),
    };

    await renderPdfPage({
      pdf,
      pageNumber: 1,
      canvas,
      scale: 1,
      rotation: 450,
      devicePixelRatio: 1,
    });

    expect(getViewport).toHaveBeenCalledWith({ scale: 1, rotation: 90 });
    expect(canvas.style.width).toBe('560px');
    expect(canvas.style.height).toBe('400px');
  });
});
