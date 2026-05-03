export const readBlobAsText = (blob) => new Promise((resolve, reject) => {
  if (!blob || typeof FileReader === 'undefined') {
    resolve('');
    return;
  }
  try {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob payload.'));
    reader.readAsText(blob);
  } catch (error) {
    reject(error);
  }
});

export const getMailErrorDetail = (requestError, fallbackMessage = '') => {
  const detail = requestError?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail?.message === 'string' && detail.message.trim()) return detail.message;
  if (typeof requestError?.message === 'string' && requestError.message.trim()) {
    return requestError.message.trim();
  }
  return String(fallbackMessage || '').trim();
};

export const getMailErrorDetailAsync = async (requestError, fallbackMessage = '') => {
  const responseData = requestError?.response?.data;
  const blobTag = Object.prototype.toString.call(responseData);
  const isBlobLike = Boolean(
    responseData
    && typeof responseData === 'object'
    && (
      typeof responseData.text === 'function'
      || typeof responseData.arrayBuffer === 'function'
      || blobTag === '[object Blob]'
    )
  );
  if (isBlobLike) {
    try {
      let rawText = '';
      if (typeof responseData.text === 'function') {
        rawText = await responseData.text();
      } else if (typeof responseData.arrayBuffer === 'function' && typeof TextDecoder !== 'undefined') {
        rawText = new TextDecoder().decode(await responseData.arrayBuffer());
      } else if (blobTag === '[object Blob]') {
        rawText = await readBlobAsText(responseData);
      } else if (typeof Response !== 'undefined') {
        rawText = await new Response(responseData).text();
      }
      const text = String(rawText || '').trim();
      if (text && text !== '[object Blob]') {
        const contentType = String(
          requestError?.response?.headers?.['content-type']
          || responseData.type
          || ''
        ).toLowerCase();
        if (contentType.includes('json') || text.startsWith('{') || text.startsWith('[')) {
          try {
            const parsed = JSON.parse(text);
            const detail = parsed?.detail;
            if (typeof detail === 'string' && detail.trim()) return detail.trim();
            if (detail && typeof detail?.message === 'string' && detail.message.trim()) {
              return detail.message.trim();
            }
            if (typeof parsed?.message === 'string' && parsed.message.trim()) {
              return parsed.message.trim();
            }
          } catch {
            // Fall through to plain-text handling below.
          }
        }
        if (!/^<!doctype html/i.test(text) && !/^<html/i.test(text)) {
          return text;
        }
      }
    } catch {
      // Fall through to the normal mail error detail extraction.
    }
  }
  return getMailErrorDetail(requestError, fallbackMessage);
};

export const isMissingMailDetailError = (requestError, detailText = '') => {
  const statusCode = Number(requestError?.response?.status || 0);
  if (statusCode === 404) return true;
  if (statusCode !== 400) return false;
  const normalizedDetail = String(detailText || '').trim().toLowerCase();
  return normalizedDetail.includes('message not found')
    || normalizedDetail.includes('invalid message id')
    || normalizedDetail.includes('message id is required');
};

export const getMailErrorCode = (requestError) => String(
  requestError?.response?.headers?.['x-mail-error-code']
  || requestError?.response?.headers?.['X-Mail-Error-Code']
  || ''
).trim();

export const isTransientMailRequestError = (requestError) => {
  const statusCode = Number(requestError?.response?.status || 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;
  const errorCode = String(requestError?.code || '').trim().toUpperCase();
  if (['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(errorCode)) {
    return true;
  }
  const detailText = String(
    requestError?.message
    || requestError?.response?.data?.detail
    || ''
  ).trim().toLowerCase();
  return Boolean(!statusCode && (
    detailText.includes('network error')
    || detailText.includes('failed to fetch')
    || detailText.includes('load failed')
    || detailText.includes('timeout')
  ));
};
