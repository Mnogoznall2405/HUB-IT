import * as pdfjs from 'pdfjs-dist';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.min.mjs';

let workerReady = false;

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

export const renderPdfPage = async ({ pdf, pageNumber, canvas, scale = 1 }) => {
  if (!pdf || !canvas) {
    throw new Error('PDF preview render context is incomplete.');
  }
  const safePage = Math.max(1, Math.round(Number(pageNumber || 1)));
  const page = await pdf.getPage(safePage);
  const viewport = page.getViewport({ scale: Math.max(0.25, Number(scale || 1)) });
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable.');
  }
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  const renderTask = page.render({ canvasContext: context, viewport });
  await renderTask.promise;
  return {
    width: viewport.width,
    height: viewport.height,
  };
};
