import { act, fireEvent, render } from '@testing-library/react-native';
import { getChatMediaRequestHeaders } from '../../files/chatMediaRequest';
import { ChatVideoPlayer } from './ChatVideoPlayer';

jest.mock('../../files/chatMediaRequest', () => ({
  getChatMediaRequestHeaders: jest.fn(),
}));

const mockedHeaders = getChatMediaRequestHeaders as jest.MockedFunction<typeof getChatMediaRequestHeaders>;

const attachment = {
  id: 'video-aud',
  kind: 'video',
  mime_type: 'video/mp4',
  original_url: '/api/v1/chat/messages/m1/attachments/a1/file?inline=1',
} as const;

const flushTimers = (ms = 0) => act(async () => { await jest.advanceTimersByTimeAsync(ms); });

afterEach(() => {
  jest.useRealTimers();
});

describe('AUD-6 video timeouts', () => {
  it('turns a hung header load into a retryable error instead of «Подготавливаем…»', async () => {
    jest.useFakeTimers();
    mockedHeaders.mockImplementation(() => new Promise(() => {}));
    const view = await render(<ChatVideoPlayer attachment={attachment} />);

    await flushTimers(9000);

    expect(view.getByLabelText('Повторить подготовку видео')).toBeTruthy();
    expect(view.queryByLabelText('Воспроизвести видео')).toBeNull();

    // «Повторить» reloads the headers and restores the play button.
    mockedHeaders.mockResolvedValue({ Authorization: 'Bearer test' });
    await act(async () => {
      await fireEvent.press(view.getByLabelText('Повторить подготовку видео'));
    });
    await flushTimers();
    await flushTimers();

    expect(view.getByLabelText('Воспроизвести видео')).toBeTruthy();
  });

  it('surfaces a retryable error when the blob fallback stalls inside the WebView', async () => {
    jest.useFakeTimers();
    mockedHeaders.mockResolvedValue({ Authorization: 'Bearer test' });
    const view = await render(<ChatVideoPlayer attachment={attachment} />);
    await flushTimers();
    await flushTimers();

    await act(async () => {
      await fireEvent.press(view.getByLabelText('Воспроизвести видео'));
    });

    // Direct playback fails → the header refresh returns the same headers →
    // the player falls back to the in-page blob fetch.
    await act(async () => {
      await fireEvent(view.getByTestId('chat-video-webview'), 'onError', { nativeEvent: {} });
    });
    await flushTimers();

    const fallback = view.getByTestId('chat-video-webview');
    expect(fallback.props.source).toHaveProperty('html');

    // The page reports 'ready', play is injected — but fetch()/blob() never
    // resolves, so no 'playing'/'error' message arrives.
    await act(async () => {
      await fireEvent(fallback, 'onMessage', { nativeEvent: { data: '{"type":"ready"}' } });
    });
    expect(view.getByText('Загружаем видео…')).toBeTruthy();

    await flushTimers(17000);

    expect(view.queryByText('Загружаем видео…')).toBeNull();
    expect(view.getByLabelText('Повторить воспроизведение видео')).toBeTruthy();
  });
});
