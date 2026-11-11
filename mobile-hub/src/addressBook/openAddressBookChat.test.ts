import {
  getAddressBookChatCacheKey,
  openAddressBookChat,
  openCachedAddressBookChat,
  resolveAddressBookChatUser,
} from './openAddressBookChat';
import * as chatApi from '../api/chatApi';
import { openPortalPath } from '../navigation/moduleRegistry';

jest.mock('../api/chatApi', () => ({
  resolveChatUser: jest.fn(),
  createDirectConversation: jest.fn(),
}));

jest.mock('../navigation/moduleRegistry', () => ({
  openPortalPath: jest.fn(),
}));

const resolveChatUser = chatApi.resolveChatUser as jest.Mock;
const createDirectConversation = chatApi.createDirectConversation as jest.Mock;

const entry = {
  full_name: 'Ivanov Ivan',
  work_emails: [{ value: 'ivanov@zsgp.ru' }],
  personal_emails: [{ value: 'ivanov@gmail.com' }],
};

describe('openAddressBookChat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('resolves the first matching email and opens the native chat', async () => {
    resolveChatUser.mockResolvedValueOnce({ id: 42, username: 'ivanov' });
    createDirectConversation.mockResolvedValueOnce({ id: 'c-42' });

    await expect(openAddressBookChat(entry)).resolves.toEqual({
      conversationId: 'c-42',
      peerUserId: 42,
    });

    expect(resolveChatUser).toHaveBeenCalledWith({ email: 'ivanov@zsgp.ru', full_name: 'Ivanov Ivan' });
    expect(createDirectConversation).toHaveBeenCalledWith(42);
    expect(openPortalPath).toHaveBeenCalledWith('/chat?conversation=c-42');
  });

  it('skips 404 emails and falls back to full name', async () => {
    resolveChatUser
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({ id: 7, username: 'ivanov' });

    await expect(resolveAddressBookChatUser(entry)).resolves.toEqual({ id: 7, username: 'ivanov' });
    expect(resolveChatUser).toHaveBeenNthCalledWith(3, { full_name: 'Ivanov Ivan' });
  });

  it('opens a previously resolved chat without a network lookup', () => {
    openCachedAddressBookChat({ conversationId: 'cached-42', peerUserId: 42 });

    expect(openPortalPath).toHaveBeenCalledWith('/chat?conversation=cached-42');
    expect(resolveChatUser).not.toHaveBeenCalled();
    expect(createDirectConversation).not.toHaveBeenCalled();
    expect(getAddressBookChatCacheKey(entry)).toBe('email:ivanov@zsgp.ru');
  });
});
