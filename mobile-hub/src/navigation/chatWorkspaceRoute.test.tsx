import { render } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import ShellChatRoute from '../../app/(shell)/chat/index';
import { NativeChatInboxScreen } from '../screens/chat/NativeChatInboxScreen';

jest.mock('../screens/chat/NativeChatInboxScreen', () => ({
  NativeChatInboxScreen: jest.fn(() => null),
}));

const mockedParams = useLocalSearchParams as jest.Mock;
const mockedInbox = NativeChatInboxScreen as jest.Mock;

describe('/(shell)/chat workspace route param', () => {
  it.each([
    ['ai', 'ai'],
    ['chats', 'chats'],
    [['ai'], 'ai'],
    ['bogus', undefined],
    [undefined, undefined],
  ])('passes workspace=%j as requestedWorkspace=%j to the inbox', async (param, expected) => {
    mockedParams.mockReturnValue(param === undefined ? {} : { workspace: param });
    await render(<ShellChatRoute />);
    expect(mockedInbox).toHaveBeenCalled();
    expect(mockedInbox.mock.calls[0][0]).toEqual({ requestedWorkspace: expected });
  });
});
