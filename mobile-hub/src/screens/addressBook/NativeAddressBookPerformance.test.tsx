import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as addressBookApi from '../../api/addressBookApi';
import { NativeAddressBookScreen } from './NativeAddressBookScreen';

const mockRowRender = jest.fn();
const mockAuthValue = {
  user: {
    id: 1,
    username: 'admin',
    role: 'admin',
    permissions: ['address_book.read'],
  },
  hasPermission: () => true,
  offlineMode: false,
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuthValue,
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => ({ preferences: { theme_mode: 'dark' } }),
}));

jest.mock('../../api/addressBookApi', () => ({
  getCompleteAddressBook: jest.fn(),
  getAddressBookStatus: jest.fn(),
  syncAddressBook: jest.fn(),
}));

jest.mock('../../cache/nativeAddressBookSnapshot', () => ({
  readNativeAddressBookSnapshot: jest.fn(async () => null),
  writeNativeAddressBookSnapshot: jest.fn(async () => true),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeEntitySnapshot: jest.fn(async () => null),
  writeNativeEntitySnapshot: jest.fn(async () => undefined),
}));

jest.mock('../../navigation/moduleRegistry', () => ({
  openPortalPath: jest.fn(),
}));

jest.mock('../../addressBook/openAddressBookChat', () => ({
  openAddressBookChat: jest.fn(),
  openCachedAddressBookChat: jest.fn(),
  getAddressBookChatCacheKey: jest.fn(() => ''),
  isAddressBookChatNotFound: jest.fn(() => false),
  getAddressBookChatErrorMessage: jest.fn(() => 'chat error'),
}));

jest.mock('../../addressBook/AddressBookEntryRow', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    AddressBookEntryRow: React.memo(({ item }: { item: { full_name?: string } }) => {
      mockRowRender(item.full_name);
      return React.createElement(Text, null, item.full_name);
    }),
  };
});

const items = Array.from({ length: 30 }, (_, index) => ({
  full_name: `Employee ${String(index).padStart(2, '0')}`,
  employee_code: `E${index}`,
  department: 'IT',
  position: 'Specialist',
  work_phones: [],
  personal_phones: [],
  work_emails: [],
  personal_emails: [],
}));

const mockedApi = addressBookApi as jest.Mocked<typeof addressBookApi>;

it('does not rerender address-book rows for an immediate keystroke or sync spinner', async () => {
  mockedApi.getCompleteAddressBook.mockResolvedValue({
    items,
    total: items.length,
    has_more: false,
  });
  mockedApi.getAddressBookStatus.mockResolvedValue({ count: items.length });
  mockedApi.syncAddressBook.mockReturnValue(new Promise(() => undefined));

  const view = await render(<NativeAddressBookScreen />);

  await waitFor(() => expect(view.getByText('Employee 00')).toBeTruthy());
  mockRowRender.mockClear();

  await fireEvent.changeText(view.getByTestId('address-book-search-input'), 'e');
  const immediateTypingRenders = mockRowRender.mock.calls.length;
  mockRowRender.mockClear();

  await fireEvent.press(view.getByTestId('address-book-sync'));
  const syncSpinnerRenders = mockRowRender.mock.calls.length;
  expect(mockedApi.syncAddressBook).toHaveBeenCalledTimes(1);
  expect({ immediateTypingRenders, syncSpinnerRenders }).toEqual({
    immediateTypingRenders: 0,
    syncSpinnerRenders: 0,
  });
});
