import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getAuthenticatedRequestHeaders } from '../../files/authenticatedRequestHeaders';
import { AuthenticatedRemoteImage } from './AuthenticatedRemoteImage';
import { Image } from 'expo-image';
import { getSessionUserId, subscribeAccessTokenChanges } from '../../auth/tokenStore';
import { nativeImageCacheKey } from '../../files/nativeImageCache';

jest.mock('../../auth/tokenStore', () => ({
  getSessionUserId: jest.fn(async () => 7),
  getSessionGeneration: jest.fn(() => 0),
  subscribeAccessTokenChanges: jest.fn(() => () => undefined),
}));
jest.mock('../../api/config', () => ({ API_V1_BASE: 'https://hub.test/api/v1' }));

jest.mock('../../files/authenticatedRequestHeaders', () => ({
  getAuthenticatedRequestHeaders: jest.fn(),
}));

const mockedHeaders = getAuthenticatedRequestHeaders as jest.Mock;

beforeEach(() => {
  mockedHeaders.mockReset();
  (getSessionUserId as jest.Mock).mockResolvedValue(7);
  (Image.getCachePathAsync as jest.Mock).mockReset().mockResolvedValue(null);
  mockedHeaders.mockResolvedValue({
    Authorization: 'Bearer mobile-token',
    'X-Auth-Client': 'mobile',
  });
});

it('refreshes authorization once and retries a protected image after a load error', async () => {
  mockedHeaders
    .mockResolvedValueOnce({ Authorization: 'Bearer expired', 'X-Auth-Client': 'mobile' })
    .mockResolvedValueOnce({ Authorization: 'Bearer refreshed', 'X-Auth-Client': 'mobile' });
  const view = await render(
    <AuthenticatedRemoteImage
      uri="https://hub.test/api/v1/company-structure/nodes/node-1/photo"
      accessibilityLabel="Protected photo"
    />,
  );

  const image = await view.findByLabelText('Protected photo');
  await act(async () => {
    fireEvent(image, 'error', { nativeEvent: { error: 'HTTP 401' } });
    await Promise.resolve();
  });

  await waitFor(() => expect(
    view.getByLabelText('Protected photo').props.source.headers.Authorization,
  ).toBe('Bearer refreshed'));
  expect(mockedHeaders).toHaveBeenNthCalledWith(2, {
    forceRefresh: true,
    preserveSessionOnRefreshFailure: true,
  });
  expect(view.getByLabelText('Protected photo').props.cachePolicy).toBe('disk');
});

it('loads a protected image with mobile authorization headers', async () => {
  const view = await render(
    <AuthenticatedRemoteImage
      uri="https://hub.test/api/v1/company-structure/nodes/node-1/photo"
      accessibilityLabel="Фото руководителя"
    />,
  );

  const image = await waitFor(() => view.getByLabelText('Фото руководителя'));
  expect(image.props.source).toEqual({
    uri: 'https://hub.test/api/v1/company-structure/nodes/node-1/photo',
    cacheKey: nativeImageCacheKey(7, 'https://hub.test/api/v1/company-structure/nodes/node-1/photo'),
    headers: {
      Authorization: 'Bearer mobile-token',
      'X-Auth-Client': 'mobile',
    },
  });
});

it('opens a cached preview after remount without requesting credentials or network', async () => {
  const uri = 'https://hub.test/api/v1/company-structure/nodes/node-1/photo?v=2';
  (Image.getCachePathAsync as jest.Mock).mockResolvedValue('/private/image-cache/photo');
  mockedHeaders.mockRejectedValue(new Error('offline'));
  const view = await render(<AuthenticatedRemoteImage uri={uri} accessibilityLabel="Cached" />);
  expect((await view.findByLabelText('Cached')).props.source.uri).toBe('file:///private/image-cache/photo');
  expect(Image.getCachePathAsync).toHaveBeenCalledWith(nativeImageCacheKey(7, uri));
  expect(mockedHeaders).not.toHaveBeenCalled();
  await view.unmount();
  const reopened = await render(<AuthenticatedRemoteImage uri={uri} accessibilityLabel="Reopened" />);
  expect((await reopened.findByLabelText('Reopened')).props.source.uri).toBe('file:///private/image-cache/photo');
  expect(mockedHeaders).not.toHaveBeenCalled();
});

it('uses different disk keys for different users and image versions', async () => {
  const uri = 'https://hub.test/api/v1/company-structure/nodes/node-1/photo?v=1';
  const view = await render(<AuthenticatedRemoteImage uri={uri} accessibilityLabel="Photo" />);
  const firstKey = (await view.findByLabelText('Photo')).props.source.cacheKey;
  expect(view.getByLabelText('Photo').props.cachePolicy).toBe('memory-disk');
  await view.unmount();
  (getSessionUserId as jest.Mock).mockResolvedValue(8);
  const next = await render(<AuthenticatedRemoteImage uri={uri} accessibilityLabel="Other" />);
  expect((await next.findByLabelText('Other')).props.source.cacheKey).not.toBe(firstKey);
  await next.rerender(<AuthenticatedRemoteImage uri={uri.replace('v=1', 'v=2')} accessibilityLabel="Other" />);
  expect((await next.findByLabelText('Other')).props.source.cacheKey).toBe(nativeImageCacheKey(8, uri.replace('v=1', 'v=2')));
});

it('does not send credentials or read image cache for an external origin', async () => {
  await render(<AuthenticatedRemoteImage uri="https://outside.test/photo" accessibilityLabel="External" />);
  await act(async () => { await Promise.resolve(); });
  expect(mockedHeaders).not.toHaveBeenCalled();
  expect(Image.getCachePathAsync).not.toHaveBeenCalled();
});

it('hides the current protected image immediately when credentials are cleared', async () => {
  const view = await render(<AuthenticatedRemoteImage uri="https://hub.test/photo" accessibilityLabel="Private" />);
  await view.findByLabelText('Private');
  const callback = (subscribeAccessTokenChanges as jest.Mock).mock.calls.at(-1)[0];
  await act(async () => { callback(null); });
  expect(view.queryByLabelText('Private')).toBeNull();
});
