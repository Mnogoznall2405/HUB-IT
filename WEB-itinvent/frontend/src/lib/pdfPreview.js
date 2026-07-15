const MAX_PDF_OUTPUT_SCALE = 3;

let workerReady = false;
let pdfjsModulePromise = null;
const activeCanvasRenders = new WeakMap();

const createPdfRenderAbortError = () => {
  const error = new Error('PDF render was cancelled.');
  error.name = 'AbortError';
  return error;
};

export const isPdfRenderCancellation = (error) => (
  error?.name === 'AbortError' || error?.name === 'RenderingCancelledException'
);

async function getPdfjsRuntime() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs');
      const viewerStyles = await import('pdfjs-dist/web/pdf_viewer.css?inline');
      return {
        pdfjs,
        WorkerMessageHandler: worker.WorkerMessageHandler,
        viewerCss: viewerStyles.default || '',
      };
    })();
  }
  return pdfjsModulePromise;
}

export const clampPdfDisplayScale = (value) => {
  const normalized = Number(value || 1);
  if (!Number.isFinite(normalized)) return 1;
  // Allow up to 4× so pinch-zoom can re-render sharp pages (CSS-only scale stays blurry).
  return Math.min(4, Math.max(0.25, normalized));
};

export const resolvePdfOutputScale = (devicePixelRatio = 1) => {
  const normalized = Number(devicePixelRatio || 1);
  if (!Number.isFinite(normalized) || normalized <= 0) return 1;
  return Math.min(MAX_PDF_OUTPUT_SCALE, normalized);
};

export const resolveInitialPdfFitZoom = ({
  pageWidth = 0,
  containerWidth = 0,
  horizontalPadding = 24,
  minZoom = 0.5,
  maxZoom = 2.5,
} = {}) => {
  const availableWidth = Math.max(0, Number(containerWidth || 0) - Number(horizontalPadding || 0));
  const normalizedPageWidth = Number(pageWidth || 0);
  if (availableWidth <= 0 || normalizedPageWidth <= 0) return 1;
  if (normalizedPageWidth <= availableWidth * 1.05) return 1;
  return Math.min(maxZoom, Math.max(minZoom, availableWidth / normalizedPageWidth));
};

export const ensurePdfWorker = async () => {
  if (workerReady) return;
  const { pdfjs, WorkerMessageHandler } = await getPdfjsRuntime();
  globalThis.pdfjsWorker = { WorkerMessageHandler };
  // workerSrc is still read before fake-worker fallback; keep a harmless placeholder.
  pdfjs.GlobalWorkerOptions.workerSrc ||= 'data:text/javascript,export{}';
  workerReady = true;
};

const normalizePdfAssetBaseUrl = (baseUrl = '/') => {
  const value = String(baseUrl || '/').trim() || '/';
  return value.endsWith('/') ? value : `${value}/`;
};

export const buildPdfDocumentOptions = ({
  data,
  baseUrl = import.meta.env.BASE_URL,
} = {}) => {
  const assetBaseUrl = `${normalizePdfAssetBaseUrl(baseUrl)}pdfjs/`;
  return {
    data,
    enableXfa: true,
    cMapUrl: `${assetBaseUrl}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetBaseUrl}standard_fonts/`,
    wasmUrl: `${assetBaseUrl}wasm/`,
    iccUrl: `${assetBaseUrl}iccs/`,
    useSystemFonts: true,
  };
};

export const loadPdfDocumentFromUrl = async (objectUrl) => {
  if (!objectUrl) {
    throw new Error('PDF preview URL is missing.');
  }
  const { pdfjs } = await getPdfjsRuntime();
  await ensurePdfWorker();
  const response = await fetch(objectUrl);
  if (!response.ok) {
    throw new Error(`Failed to load PDF preview (${response.status}).`);
  }
  const data = await response.arrayBuffer();
  const loadingTask = pdfjs.getDocument(buildPdfDocumentOptions({ data }));
  return loadingTask.promise;
};

export const measurePdfPageSize = async (pdf, pageNumber = 1, scale = 1) => {
  if (!pdf) {
    throw new Error('PDF document is missing.');
  }
  const safePage = Math.max(1, Math.round(Number(pageNumber || 1)));
  const page = await pdf.getPage(safePage);
  const viewport = page.getViewport({ scale: clampPdfDisplayScale(scale) });
  return {
    width: viewport.width,
    height: viewport.height,
  };
};

export const normalizePdfRotation = (value = 0) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  const snapped = Math.round(numeric / 90) * 90;
  return ((snapped % 360) + 360) % 360;
};

const createReadOnlyPdfLinkService = () => ({
  eventBus: null,
  isInPresentationMode: false,
  externalLinkEnabled: false,
  addLinkAttributes(link) {
    link.href = '#';
    link.tabIndex = -1;
  },
  getDestinationHash: () => '#',
  getAnchorUrl: () => '#',
  goToDestination: () => undefined,
  executeNamedAction: () => undefined,
  executeSetOCGState: () => undefined,
});

const ensurePdfLayerSurface = ({ layerContainer, viewerCss, viewport, displayScale }) => {
  const shadowRoot = layerContainer.shadowRoot || layerContainer.attachShadow({ mode: 'open' });
  shadowRoot.replaceChildren();

  const style = document.createElement('style');
  style.textContent = `${viewerCss || ''}\n
:host { display: block; pointer-events: none; }
.pdfPreviewLayerSurface { position: relative; width: 100%; height: 100%; overflow: hidden; }
.annotationLayer, .xfaLayer { inset: 0; pointer-events: none; }
.annotationLayer *, .xfaLayer * { pointer-events: none !important; }
`;
  const surface = document.createElement('div');
  surface.className = 'pdfPreviewLayerSurface';
  surface.style.setProperty('--scale-factor', String(displayScale));
  surface.style.setProperty('--total-scale-factor', String(displayScale));
  surface.style.width = `${Math.floor(viewport.width)}px`;
  surface.style.height = `${Math.floor(viewport.height)}px`;
  shadowRoot.append(style, surface);

  Object.assign(layerContainer.style, {
    position: 'absolute',
    top: '0px',
    left: '50%',
    width: `${Math.floor(viewport.width)}px`,
    height: `${Math.floor(viewport.height)}px`,
    transform: 'translateX(-50%)',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '1',
  });
  return surface;
};

const makePdfLayerControlsReadOnly = (surface) => {
  surface.querySelectorAll('input, textarea').forEach((control) => {
    control.readOnly = true;
    control.tabIndex = -1;
    control.setAttribute('aria-readonly', 'true');
  });
  surface.querySelectorAll('select, button, a').forEach((control) => {
    control.tabIndex = -1;
    control.setAttribute('aria-disabled', 'true');
  });
};

export const renderPdfPageLayers = async ({
  pdfjs,
  pdf,
  page,
  viewport,
  displayScale = 1,
  layerContainer,
  viewerCss = '',
  annotationCanvasMap,
  signal,
}) => {
  if (!layerContainer || typeof document === 'undefined') {
    return { xfa: false, annotations: 0 };
  }
  if (signal?.aborted) throw createPdfRenderAbortError();

  const surface = ensurePdfLayerSurface({
    layerContainer,
    viewerCss,
    viewport,
    displayScale,
  });
  const layerViewport = typeof viewport.clone === 'function'
    ? viewport.clone({ dontFlip: true })
    : viewport;
  const linkService = createReadOnlyPdfLinkService();
  const annotationStorage = pdf?.annotationStorage;

  if (page.isPureXfa) {
    const xfaHtml = await page.getXfa();
    if (signal?.aborted) throw createPdfRenderAbortError();
    if (!xfaHtml) {
      throw new Error('PDF contains an XFA form that cannot be displayed.');
    }
    const xfaLayer = document.createElement('div');
    xfaLayer.className = 'xfaLayer';
    surface.append(xfaLayer);
    pdfjs.XfaLayer.render({
      viewport: layerViewport,
      div: xfaLayer,
      xfaHtml,
      annotationStorage,
      linkService,
      intent: 'display',
    });
    makePdfLayerControlsReadOnly(surface);
    return { xfa: true, annotations: 0 };
  }

  const annotations = typeof page.getAnnotations === 'function'
    ? await page.getAnnotations({ intent: 'display' })
    : [];
  if (signal?.aborted) throw createPdfRenderAbortError();
  if (!annotations.length || !pdfjs.AnnotationLayer) {
    return { xfa: false, annotations: 0 };
  }

  const annotationDiv = document.createElement('div');
  annotationDiv.className = 'annotationLayer disabled';
  surface.append(annotationDiv);
  const annotationLayer = new pdfjs.AnnotationLayer({
    div: annotationDiv,
    page,
    viewport: layerViewport,
    linkService,
    annotationStorage,
    annotationCanvasMap,
  });
  await annotationLayer.render({
    viewport: layerViewport,
    div: annotationDiv,
    annotations,
    page,
    linkService,
    annotationStorage,
    annotationCanvasMap,
    renderForms: true,
    enableScripting: false,
    hasJSActions: false,
  });
  if (signal?.aborted) throw createPdfRenderAbortError();
  makePdfLayerControlsReadOnly(surface);
  return { xfa: false, annotations: annotations.length };
};

export const renderPdfPage = ({
  pdf,
  pageNumber,
  canvas,
  scale = 1,
  rotation = 0,
  devicePixelRatio,
  layerContainer,
  signal,
}) => {
  if (!pdf || !canvas) {
    return Promise.reject(new Error('PDF preview render context is incomplete.'));
  }

  const previousJob = activeCanvasRenders.get(canvas);
  previousJob?.cancel();

  let cancelled = Boolean(signal?.aborted);
  let renderTask = null;
  const job = {
    promise: null,
    cancel: () => {
      cancelled = true;
      renderTask?.cancel?.();
    },
  };
  const handleAbort = () => job.cancel();
  signal?.addEventListener?.('abort', handleAbort, { once: true });

  job.promise = (async () => {
    if (previousJob) {
      try {
        await previousJob.promise;
      } catch {
        // Cancellation/failure of an obsolete render must not block the latest one.
      }
    }
    if (cancelled) throw createPdfRenderAbortError();

    const safePage = Math.max(1, Math.round(Number(pageNumber || 1)));
    const page = await pdf.getPage(safePage);
    if (cancelled) throw createPdfRenderAbortError();

    const displayScale = clampPdfDisplayScale(scale);
    const outputScale = resolvePdfOutputScale(
      devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
    );
    const viewport = page.getViewport({
      scale: displayScale,
      rotation: normalizePdfRotation(rotation),
    });
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context is unavailable.');
    }

    const cssWidth = Math.floor(viewport.width);
    const cssHeight = Math.floor(viewport.height);
    canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
    canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);

    const transform = outputScale !== 1
      ? [outputScale, 0, 0, outputScale, 0, 0]
      : null;
    const annotationCanvasMap = layerContainer ? new Map() : undefined;
    const renderParameters = {
      canvasContext: context,
      viewport,
      transform,
    };
    if (annotationCanvasMap) renderParameters.annotationCanvasMap = annotationCanvasMap;
    renderTask = page.render(renderParameters);
    if (cancelled) renderTask.cancel?.();
    await renderTask.promise;
    if (cancelled) throw createPdfRenderAbortError();

    let layers = { xfa: false, annotations: 0 };
    if (layerContainer) {
      const { pdfjs, viewerCss } = await getPdfjsRuntime();
      layers = await renderPdfPageLayers({
        pdfjs,
        pdf,
        page,
        viewport,
        displayScale,
        layerContainer,
        viewerCss,
        annotationCanvasMap,
        signal,
      });
    }
    return {
      width: cssWidth,
      height: cssHeight,
      outputScale,
      displayScale,
      layers,
    };
  })();

  activeCanvasRenders.set(canvas, job);
  const cleanup = () => {
    signal?.removeEventListener?.('abort', handleAbort);
    if (activeCanvasRenders.get(canvas) === job) {
      activeCanvasRenders.delete(canvas);
    }
  };
  job.promise.then(cleanup, cleanup);
  return job.promise;
};
