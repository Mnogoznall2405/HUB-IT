import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { setTokens } from '../../auth/tokenStore';
import { getChatMediaRequestHeaders } from '../../files/chatMediaRequest';
import { ChatVideoPlayer } from './ChatVideoPlayer';

jest.mock('../../files/chatMediaRequest', () => ({
  getChatMediaRequestHeaders: jest.fn(),
}));

const mockedHeaders = getChatMediaRequestHeaders as jest.MockedFunction<typeof getChatMediaRequestHeaders>;

describe('ChatVideoPlayer', () => {
  beforeEach(() => {
    mockedHeaders.mockReset();
    mockedHeaders.mockResolvedValue({ Authorization: 'Bearer test' });
  });

  it('opens the protected inline URL directly before using the blob fallback', async () => {
    const view = await render(
      <ChatVideoPlayer attachment={{
        id: 'video-1',
        kind: 'video',
        mime_type: 'video/mp4',
        original_url: '/api/v1/chat/messages/m1/attachments/a1/file?inline=1',
      }} />,
    );

    const play = await waitFor(() => view.getByLabelText('Воспроизвести видео'));
    await fireEvent.press(play);

    const direct = view.getByTestId('chat-video-webview');
    expect(direct.props.source).toMatchObject({
      uri: expect.stringContaining('/api/v1/chat/messages/m1/attachments/a1/file?inline=1'),
      headers: { Authorization: 'Bearer test' },
    });

    await act(async () => {
      fireEvent(direct, 'onError', { nativeEvent: {} });
    });
    await waitFor(() => expect(view.getByTestId('chat-video-webview').props.source).toHaveProperty('html'));
    expect(mockedHeaders).toHaveBeenLastCalledWith({
      forceRefresh: true,
      preserveSessionOnRefreshFailure: true,
    });
  });

  it('reloads a started protected video after the access token changes', async () => {
    mockedHeaders
      .mockResolvedValueOnce({ Authorization: 'Bearer old' })
      .mockResolvedValueOnce({ Authorization: 'Bearer new' });
    const view = await render(
      <ChatVideoPlayer attachment={{
        id: 'video-2',
        kind: 'video',
        mime_type: 'video/mp4',
        original_url: '/api/v1/chat/messages/m2/attachments/a2/file?inline=1',
      }} />,
    );

    const play = await waitFor(() => view.getByRole('button'));
    await act(async () => {
      fireEvent.press(play);
    });
    await waitFor(() => {
      expect(view.getByTestId('chat-video-webview').props.source.headers.Authorization).toBe('Bearer old');
    });

    await act(async () => {
      await setTokens('new-access', 'new-refresh');
    });

    await waitFor(() => {
      expect(view.getByTestId('chat-video-webview').props.source.headers.Authorization).toBe('Bearer new');
    });
  });
});
