import { getAuthenticatedAccessToken, withMobileAuthHeaders } from '../api/client';
import { getClientDeviceId } from '../auth/tokenStore';

export async function getAuthenticatedRequestHeaders(
  options: {
    forceRefresh?: boolean;
    preserveSessionOnRefreshFailure?: boolean;
  } = {},
): Promise<Record<string, string>> {
  const accessToken = await getAuthenticatedAccessToken(options);
  const clientDeviceId = await getClientDeviceId();
  return {
    Authorization: `Bearer ${accessToken}`,
    ...withMobileAuthHeaders(clientDeviceId),
  };
}
