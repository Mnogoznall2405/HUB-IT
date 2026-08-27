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
