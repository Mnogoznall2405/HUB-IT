import { render, waitFor } from '@testing-library/react-native';
import { downloadTrustedChatMedia } from '../../files/nativeAttachmentDownloads';
import { PresenceAvatar } from './PresenceAvatar';

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  downloadTrustedChatMedia: jest.fn(),
}));

const mockedDownload = downloadTrustedChatMedia as jest.MockedFunction<typeof downloadTrustedChatMedia>;

describe('PresenceAvatar', () => {
  beforeEach(() => {
    mockedDownload.mockReset();
  });

  it('authorizes protected group avatar requests', async () => {
    mockedDownload.mockResolvedValue({ uri: 'file:///cache/group-avatar.img' } as never);
    const view = await render(
      <PresenceAvatar
        label="Platform team"
        avatarUrl="/api/v1/chat/group-avatars/team.jpg"
      />,
    );

    await waitFor(() => expect(mockedDownload).toHaveBeenCalledTimes(1));
    expect(view.toJSON()).toBeTruthy();
  });
});
