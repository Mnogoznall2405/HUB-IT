import { render, waitFor } from '@testing-library/react-native';
import { downloadTrustedChatMedia } from '../../files/nativeAttachmentDownloads';
import { ChatStickerImage } from './ChatStickerImage';

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  downloadTrustedChatMedia: jest.fn(),
}));

const mockedDownload = downloadTrustedChatMedia as jest.MockedFunction<typeof downloadTrustedChatMedia>;

describe('ChatStickerImage', () => {
  beforeEach(() => {
    mockedDownload.mockReset();
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
});
