import { getAuthenticatedRequestHeaders } from './authenticatedRequestHeaders';

export async function getChatMediaRequestHeaders(
  options: {
    forceRefresh?: boolean;
    preserveSessionOnRefreshFailure?: boolean;
  } = {},
): Promise<Record<string, string>> {
  return getAuthenticatedRequestHeaders(options);
}
