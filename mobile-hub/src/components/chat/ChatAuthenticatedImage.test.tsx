import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { downloadTrustedChatMedia } from '../../files/nativeAttachmentDownloads';
import { ChatAuthenticatedImage } from './ChatAuthenticatedImage';

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  downloadTrustedChatMedia: jest.fn(),
}));

const mockedDownload = downloadTrustedChatMedia as jest.MockedFunction<typeof downloadTrustedChatMedia>;

describe('ChatAuthenticatedImage', () => {
  beforeEach(() => {
    mockedDownload.mockReset();
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/chat-photo.img' } as never);
  });

  it('never gives the next image a previous URI and ignores its late native load callback', async () => {
    const onLoad = jest.fn();
    const view = await render(<ChatAuthenticatedImage uri="https://hub.test/first.jpg" accessibilityLabel="First" onLoad={onLoad} />);
    const first = await view.findByLabelText('First');
    const oldLoad = first.props.onLoad;
    let resolveSecond!: (value: Awaited<ReturnType<typeof downloadTrustedChatMedia>>) => void;
    mockedDownload.mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    await view.rerender(<ChatAuthenticatedImage uri="https://hub.test/second.jpg" accessibilityLabel="Second" onLoad={onLoad} />);
    expect(view.queryByLabelText('First')).toBeNull();
    expect(view.queryByLabelText('Second')).toBeNull();
    await act(async () => { oldLoad({ nativeEvent: { source: { width: 100, height: 100 } } }); });
    expect(onLoad).not.toHaveBeenCalled();
    await act(async () => { resolveSecond({ uri: 'file:///cache/second.img' } as never); });
    expect(view.getByLabelText('Second').props.source.uri).toBe('file:///cache/second.img');
  });

  it('ignores an old download finishing after a newer photo and permits retry after a network failure', async () => {
    let finishFirst!: (value: Awaited<ReturnType<typeof downloadTrustedChatMedia>>) => void;
    mockedDownload.mockReturnValueOnce(new Promise((resolve) => { finishFirst = resolve; })).mockRejectedValueOnce(new Error('offline'));
    const view = await render(<ChatAuthenticatedImage uri="https://hub.test/first.jpg" accessibilityLabel="Photo" />);
    await view.rerender(<ChatAuthenticatedImage uri="https://hub.test/second.jpg" accessibilityLabel="Photo" />);
    await waitFor(() => expect(view.getByLabelText('Повторить загрузку фото')).toBeTruthy());
    await act(async () => { finishFirst({ uri: 'file:///cache/first.img' } as never); });
    expect(view.queryByLabelText('Photo')).toBeNull();
    mockedDownload.mockResolvedValueOnce({ uri: 'file:///cache/second.img' } as never);
    await fireEvent.press(view.getByLabelText('Повторить загрузку фото'), { stopPropagation: jest.fn() });
    await waitFor(() => expect(view.getByLabelText('Photo').props.source.uri).toBe('file:///cache/second.img'));
  });

  it('renders protected chat media from an authenticated local cache file', async () => {
    const view = await render(
      <ChatAuthenticatedImage uri="https://hub.test/photo.jpg" accessibilityLabel="Cached photo" />,
    );

    await waitFor(() => expect(view.getByLabelText('Cached photo').props.source).toEqual({
      uri: 'file:///cache/chat-photo.img',
    }));
    expect(mockedDownload).toHaveBeenCalledWith(
      'https://hub.test/photo.jpg',
      expect.stringMatching(/^chat-media-[a-f0-9]+\.img$/),
      { forceDownload: false },
    );
  });

  it('renders a local optimistic image without downloading it', async () => {
    const view = await render(
      <ChatAuthenticatedImage uri="file:///picker/photo.jpg" accessibilityLabel="Local photo" />,
    );

    await waitFor(() => expect(view.getByLabelText('Local photo').props.source).toEqual({
      uri: 'file:///picker/photo.jpg',
    }));
    expect(mockedDownload).not.toHaveBeenCalled();
  });

  it('deletes and downloads the cached media once after a local decode error', async () => {
    mockedDownload
      .mockResolvedValueOnce({ uri: 'file:///cache/old.img' } as never)
      .mockResolvedValueOnce({ uri: 'file:///cache/new.img' } as never);
    const view = await render(
      <ChatAuthenticatedImage uri="https://hub.test/photo.jpg" accessibilityLabel="Photo" />,
    );

    const image = await view.findByLabelText('Photo');
    await act(async () => {
      fireEvent(image, 'error', { nativeEvent: { error: 'Decode failed' } });
      await Promise.resolve();
    });

    await waitFor(() => expect(view.getByLabelText('Photo').props.source.uri).toBe('file:///cache/new.img'));
    expect(mockedDownload).toHaveBeenCalledTimes(2);
    expect(mockedDownload.mock.calls[1]?.[2]).toEqual({ forceDownload: true });
  });

  it('does not repeat downloads when the replaced local image still cannot decode', async () => {
    mockedDownload
      .mockResolvedValueOnce({ uri: 'file:///cache/old.img' } as never)
      .mockResolvedValueOnce({ uri: 'file:///cache/new.img' } as never);
    const view = await render(
      <ChatAuthenticatedImage uri="https://hub.test/photo.jpg" accessibilityLabel="Photo" />,
    );

    await act(async () => {
      fireEvent(await view.findByLabelText('Photo'), 'error', { nativeEvent: { error: 'Decode failed' } });
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByLabelText('Photo').props.source.uri).toBe('file:///cache/new.img'));

    await act(async () => {
      fireEvent(view.getByLabelText('Photo'), 'error', { nativeEvent: { error: 'Decode failed again' } });
    });

    await waitFor(() => expect(view.queryByLabelText('Photo')).toBeNull());
    expect(mockedDownload).toHaveBeenCalledTimes(2);
  });

});
