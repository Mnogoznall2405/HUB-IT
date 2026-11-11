import { render, waitFor } from '@testing-library/react-native';
import { Component, type ReactNode } from 'react';
import { gzipSync, strToU8 } from 'fflate';
import { downloadTrustedChatMedia } from '../../files/nativeAttachmentDownloads';
import { stickerFromChatAttachment } from '../../chat/chatStickers';
import { ChatStickerImage } from './ChatStickerImage';

const mockVideoPlayer = {
  loop: false,
  muted: false,
  keepScreenOnWhilePlaying: true,
  status: 'readyToPlay',
  play: jest.fn(),
  pause: jest.fn(),
};
const mockUseVideoPlayer = jest.fn((source, setup) => {
  setup?.(mockVideoPlayer);
  return mockVideoPlayer;
});

jest.mock('expo', () => ({
  useEvent: () => ({ status: 'readyToPlay' }),
}));

jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useVideoPlayer: (
      source: unknown,
      setup?: (player: typeof mockVideoPlayer) => void,
    ) => mockUseVideoPlayer(source, setup),
    VideoView: (props: Record<string, unknown>) => React.createElement(View, { ...props, testID: 'chat-sticker-video' }),
  };
});

jest.mock('lottie-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => React.createElement(View, { ...props, testID: 'chat-sticker-tgs' }),
  };
});

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  downloadTrustedChatMedia: jest.fn(),
}));

const mockedDownload = downloadTrustedChatMedia as jest.MockedFunction<typeof downloadTrustedChatMedia>;

describe('ChatStickerImage', () => {
  beforeEach(() => {
    mockedDownload.mockReset();
    mockUseVideoPlayer.mockClear();
    mockVideoPlayer.play.mockClear();
    mockVideoPlayer.pause.mockClear();
  });

  it('loads a protected sticker through the authenticated media cache', async () => {
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/sticker.img' } as never);
    const view = await render(
      <ChatStickerImage
        sticker={{ id: 'sticker-1', emoji: '🙂', file_url: '/api/v1/chat/stickers/sticker-1/file' }}
        label="Sticker test"
      />,
    );

    await waitFor(() => {
      expect(view.getByLabelText('Sticker test').props.source.uri).toBe('file:///cache/sticker.img');
    });
    expect(mockedDownload).toHaveBeenCalledTimes(1);
  });

  it('autoplays a protected WebM sticker from the authenticated local cache', async () => {
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/sticker.webm' } as never);
    const view = await render(
      <ChatStickerImage
        sticker={{
          id: 'sticker-video',
          mime_type: 'video/webm',
          file_url: '/api/v1/chat/stickers/sticker-video/file',
          preview_url: '/api/v1/chat/stickers/sticker-video/preview',
        }}
        autoPlay
      />,
    );

    await waitFor(() => expect(view.getByTestId('chat-sticker-video')).toBeTruthy());
    expect(mockUseVideoPlayer).toHaveBeenCalledWith(
      { uri: 'file:///cache/sticker.webm', contentType: 'progressive' },
      expect.any(Function),
    );
    expect(mockVideoPlayer.play).toHaveBeenCalled();
  });

  it('decodes and autoplays a protected Telegram TGS sticker', async () => {
    const animation = {
      v: '5.7.4', fr: 30, ip: 0, op: 30, w: 512, h: 512, assets: [], layers: [],
    };
    mockedDownload.mockResolvedValue({
      uri: 'file:///cache/sticker.tgs',
      bytes: jest.fn().mockResolvedValue(gzipSync(strToU8(JSON.stringify(animation)))),
    } as never);
    const view = await render(
      <ChatStickerImage
        sticker={{
          id: 'sticker-tgs',
          mime_type: 'application/x-tgsticker',
          file_url: '/api/v1/chat/stickers/sticker-tgs/file',
          preview_url: '/api/v1/chat/stickers/sticker-tgs/preview',
        }}
        autoPlay
      />,
    );

    await waitFor(() => expect(view.getByTestId('chat-sticker-tgs')).toBeTruthy());
    expect(view.getByTestId('chat-sticker-tgs').props.source).toMatchObject(animation);
  });

  it('autoplays a legacy TGS message attachment even when its MIME type is generic', async () => {
    const animation = {
      v: '5.7.4', fr: 30, ip: 0, op: 30, w: 512, h: 512, assets: [], layers: [],
    };
    mockedDownload.mockResolvedValue({
      uri: 'file:///cache/legacy-sticker.tgs',
      bytes: jest.fn().mockResolvedValue(gzipSync(strToU8(JSON.stringify(animation)))),
    } as never);
    const sticker = stickerFromChatAttachment({
      id: 'legacy-tgs',
      media_kind: 'sticker',
      file_name: 'sticker-office.tgs',
      mime_type: 'application/octet-stream',
      original_url: '/api/v1/chat/messages/m1/attachments/a1/file?inline=1',
    });

    const view = await render(<ChatStickerImage sticker={sticker} autoPlay />);

    await waitFor(() => expect(view.getByTestId('chat-sticker-tgs')).toBeTruthy());
  });

  it('autoplays a legacy WebM message attachment even when its MIME type is generic', async () => {
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/legacy-sticker.webm' } as never);
    const sticker = stickerFromChatAttachment({
      id: 'legacy-webm',
      media_kind: 'sticker',
      file_name: 'sticker-office.webm',
      mime_type: 'application/octet-stream',
      original_url: '/api/v1/chat/messages/m1/attachments/a2/file?inline=1',
    });

    const view = await render(<ChatStickerImage sticker={sticker} autoPlay />);

    await waitFor(() => expect(view.getByTestId('chat-sticker-video')).toBeTruthy());
  });

  it('shows the static preview instead of crashing the screen when the video player throws', async () => {
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/broken.webm' } as never);
    // React retries a failed render once, so the failure must be persistent.
    mockUseVideoPlayer.mockImplementation(() => { throw new Error('ExoPlayer limit reached'); });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await render(
      <ChatStickerImage
        sticker={{ id: 'sticker-broken', emoji: '🙂', mime_type: 'video/webm', file_url: '/f', preview_url: '/p' }}
        label="Сломанный стикер"
        autoPlay
      />,
    );
    await waitFor(() => expect(mockUseVideoPlayer).toHaveBeenCalled());
    expect(view.queryByTestId('chat-sticker-video')).toBeNull();
    expect(view.getAllByLabelText('Сломанный стикер').length).toBeGreaterThan(0);
    consoleError.mockRestore();
    mockUseVideoPlayer.mockImplementation((source, setup) => {
      setup?.(mockVideoPlayer);
      return mockVideoPlayer;
    });
  });

  it('does not fail the screen when the released player throws while the sticker unmounts', async () => {
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/sticker.webm' } as never);
    const onScreenError = jest.fn();
    class ScreenBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false };
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch(error: unknown) { onScreenError(error); }
      render() { return this.state.failed ? null : this.props.children; }
    }
    const sticker = {
      id: 'sticker-6',
      mime_type: 'video/webm',
      file_url: '/api/v1/chat/stickers/sticker-6/file',
      preview_url: '/api/v1/chat/stickers/sticker-6/preview',
    };
    const view = await render(<ScreenBoundary><ChatStickerImage sticker={sticker} autoPlay /></ScreenBoundary>);
    await waitFor(() => expect(view.getByTestId('chat-sticker-video')).toBeTruthy());
    // The real useVideoPlayer releases the player before our cleanup runs.
    mockVideoPlayer.pause.mockImplementation(() => { throw new Error('released'); });
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await view.rerender(<ScreenBoundary>{null}</ScreenBoundary>);
      expect(onScreenError).not.toHaveBeenCalled();
    } finally {
      mockVideoPlayer.pause.mockReset();
      jest.restoreAllMocks();
    }
  });

  it('keeps at most four live video players and draws the rest as static previews', async () => {
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/s.webm' } as never);
    const stickers = Array.from({ length: 7 }, (_, index) => ({
      id: `s-${index}`, emoji: '🙂', mime_type: 'video/webm', file_url: `/f${index}`, preview_url: `/p${index}`,
    }));
    const view = await render(
      <>{stickers.map((sticker) => <ChatStickerImage key={sticker.id} sticker={sticker} autoPlay />)}</>,
    );
    await waitFor(() => expect(view.getAllByTestId('chat-sticker-video')).toHaveLength(4));
    view.unmount();
    const again = await render(<ChatStickerImage sticker={stickers[0]} autoPlay />);
    await waitFor(() => expect(again.getByTestId('chat-sticker-video')).toBeTruthy());
  });
});
