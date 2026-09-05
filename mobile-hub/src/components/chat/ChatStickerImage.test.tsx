import { render, waitFor } from '@testing-library/react-native';
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
});
