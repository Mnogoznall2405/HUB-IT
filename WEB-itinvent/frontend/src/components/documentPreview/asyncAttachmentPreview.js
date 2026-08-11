export const ATTACHMENT_PREVIEW_TIMEOUT_MS = 45_000;
const ATTACHMENT_PREVIEW_MIN_DELAY_MS = 250;
const ATTACHMENT_PREVIEW_MAX_DELAY_MS = 3_000;

const createPreviewAbortError = () => {
  const error = new Error('Preview request was cancelled.');
  error.name = 'AbortError';
  return error;
};

const throwIfPreviewAborted = (signal) => {
  if (signal?.aborted) throw createPreviewAbortError();
};

const waitForPreviewDelay = (delayMs, signal) => new Promise((resolve, reject) => {
  throwIfPreviewAborted(signal);
  let timerId = null;
  const handleAbort = () => {
    if (timerId !== null) globalThis.clearTimeout(timerId);
    signal?.removeEventListener('abort', handleAbort);
    reject(createPreviewAbortError());
  };
  timerId = globalThis.setTimeout(() => {
    signal?.removeEventListener('abort', handleAbort);
    resolve();
  }, delayMs);
  signal?.addEventListener('abort', handleAbort, { once: true });
});

const createPreviewTimeoutError = () => new Error(
  'Предпросмотр готовится дольше обычного. Закройте окно и повторите позже.',
);

const createPreviewFailedError = (payload = {}) => {
  const detail = String(payload?.error || '').trim();
  return new Error(detail
    ? `Не удалось подготовить предпросмотр документа: ${detail}`
    : 'Не удалось подготовить предпросмотр документа.');
};

export const getAttachmentPreviewPollDelay = ({
  attempt = 0,
  retryAfterMs = 0,
  random = Math.random,
} = {}) => {
  const exponentialDelay = ATTACHMENT_PREVIEW_MIN_DELAY_MS * (1.6 ** Math.max(0, Number(attempt) || 0));
  const requestedDelay = Math.max(Number(retryAfterMs) || 0, exponentialDelay);
  const boundedDelay = Math.min(ATTACHMENT_PREVIEW_MAX_DELAY_MS, Math.max(
    ATTACHMENT_PREVIEW_MIN_DELAY_MS,
    requestedDelay,
  ));
  const jitterFactor = 0.9 + (Math.min(1, Math.max(0, Number(random?.()) || 0)) * 0.2);
  return Math.round(Math.min(
    ATTACHMENT_PREVIEW_MAX_DELAY_MS,
    Math.max(ATTACHMENT_PREVIEW_MIN_DELAY_MS, boundedDelay * jitterFactor),
  ));
};

const normalizePreviewStatus = (payload = {}) => {
  const explicitStatus = String(payload?.preview_status || payload?.status || '').trim().toLowerCase();
  if (explicitStatus) return explicitStatus;
  return payload?.preview_kind || payload?.pdf_filename ? 'ready' : 'queued';
};

export const waitForAttachmentPreview = async ({
  previewAPI,
  parentId,
  attachmentId,
  signal,
  timeoutMs = ATTACHMENT_PREVIEW_TIMEOUT_MS,
  now = Date.now,
  random = Math.random,
  sleep = waitForPreviewDelay,
} = {}) => {
  const startedAt = now();
  const timeoutController = new AbortController();
  let timedOut = false;
  const handleParentAbort = () => timeoutController.abort();
  if (signal?.aborted) {
    timeoutController.abort();
  } else {
    signal?.addEventListener('abort', handleParentAbort, { once: true });
  }
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, Math.max(0, Number(timeoutMs) || 0));
  let attempt = 0;
  try {
    while (true) {
      throwIfPreviewAborted(timeoutController.signal);
      let metadata;
      try {
        metadata = await previewAPI.getAttachmentPreview(
          parentId,
          attachmentId,
          { signal: timeoutController.signal },
        );
      } catch (error) {
        const failurePayload = error?.response?.data;
        const failureStatus = normalizePreviewStatus(failurePayload);
        if (failureStatus === 'failed' || failureStatus === 'error') {
          throw createPreviewFailedError(failurePayload);
        }
        throw error;
      }
      throwIfPreviewAborted(timeoutController.signal);
      const status = normalizePreviewStatus(metadata);
      if (status === 'ready') return metadata;
      if (status === 'failed' || status === 'error') throw createPreviewFailedError(metadata);

      const elapsedMs = Math.max(0, now() - startedAt);
      const remainingMs = Math.max(0, Number(timeoutMs) - elapsedMs);
      if (remainingMs <= 0) throw createPreviewTimeoutError();
      const delayMs = Math.min(remainingMs, getAttachmentPreviewPollDelay({
        attempt,
        retryAfterMs: metadata?.retry_after_ms,
        random,
      }));
      await sleep(delayMs, timeoutController.signal);
      attempt += 1;
    }
  } catch (error) {
    if (timedOut && !signal?.aborted) throw createPreviewTimeoutError();
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', handleParentAbort);
  }
};
