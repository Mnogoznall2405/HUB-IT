import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { getAuthenticatedRequestHeaders } from '../../files/authenticatedRequestHeaders';
import { AuthenticatedRemoteImage } from './AuthenticatedRemoteImage';

jest.mock('../../files/authenticatedRequestHeaders', () => ({
  getAuthenticatedRequestHeaders: jest.fn(),
}));

const mockedHeaders = getAuthenticatedRequestHeaders as jest.Mock;

beforeEach(() => {
  mockedHeaders.mockReset();
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
    headers: {
      Authorization: 'Bearer mobile-token',
      'X-Auth-Client': 'mobile',
    },
  });
});
