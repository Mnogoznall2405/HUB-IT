export const CHAT_THREAD_BOOTSTRAP_LIMIT = 40;

export function threadFitsSingleBootstrapPage(messageCount, limit = CHAT_THREAD_BOOTSTRAP_LIMIT) {
  const normalizedCount = Number(messageCount || 0);
  return normalizedCount > 0 && normalizedCount < limit;
}

export function shouldShowOlderHistoryControl({
  messagesHasMore = false,
  messageCount = 0,
  olderHistoryUnavailable = false,
  bootstrapLimit = CHAT_THREAD_BOOTSTRAP_LIMIT,
} = {}) {
  if (!messagesHasMore || olderHistoryUnavailable) return false;
  if (threadFitsSingleBootstrapPage(messageCount, bootstrapLimit)) return false;
  return true;
}

export function resolveThreadHasOlderFlag({
  payloadHasOlder = false,
  incomingCount = 0,
  preservedOlderCount = 0,
  olderHistoryExhausted = false,
  currentHasMore = false,
  extendedHistory = false,
  bootstrapLimit = CHAT_THREAD_BOOTSTRAP_LIMIT,
} = {}) {
  if (olderHistoryExhausted) return false;
  if (threadFitsSingleBootstrapPage(incomingCount, bootstrapLimit) && preservedOlderCount === 0) {
    return false;
  }
  if (extendedHistory) {
    return Boolean(payloadHasOlder || currentHasMore);
  }
  return Boolean(payloadHasOlder);
}
