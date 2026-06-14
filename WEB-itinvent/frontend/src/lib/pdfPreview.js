import * as pdfjs from 'pdfjs-dist';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs';

const MAX_PDF_OUTPUT_SCALE = 3;

let workerReady = false;

export const clampPdfDisplayScale = (value) => {
  const normalized = Number(value || 1);
  if (!Number.isFinite(normalized)) return 1;
  return Math.min(2.5, Math.max(0.25, normalized));
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
  globalThis.pdfjsWorker = { WorkerMessageHandler };
  // workerSrc is still read before fake-worker fallback; keep a harmless placeholder.
  pdfjs.GlobalWorkerOptions.workerSrc ||= 'data:text/javascript,export{}';
  workerReady = true;
};

export const loadPdfDocumentFromUrl = async (objectUrl) => {
  if (!objectUrl) {
    throw new Error('PDF preview URL is missing.');
  }
  await ensurePdfWorker();
  const response = await fetch(objectUrl);
  if (!response.ok) {
    throw new Error(`Failed to load PDF preview (${response.status}).`);
  }
  const data = await response.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data });
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

export const renderPdfPage = async ({
  pdf,
  pageNumber,
  canvas,
  scale = 1,
  devicePixelRatio,
}) => {
  if (!pdf || !canvas) {
    throw new Error('PDF preview render context is incomplete.');
  }
  const safePage = Math.max(1, Math.round(Number(pageNumber || 1)));
  const page = await pdf.getPage(safePage);
  const displayScale = clampPdfDisplayScale(scale);
  const outputScale = resolvePdfOutputScale(
    devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1),
  );
  const viewport = page.getViewport({ scale: displayScale });
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
  const renderTask = page.render({
    canvasContext: context,
    viewport,
    transform,
  });
  await renderTask.promise;
  return {
    width: cssWidth,
    height: cssHeight,
    outputScale,
    displayScale,
  };
};
