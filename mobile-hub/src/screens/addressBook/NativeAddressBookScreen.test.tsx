import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { NativeAddressBookScreen } from './NativeAddressBookScreen';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { openAddressBookChat } from '../../addressBook/openAddressBookChat';
import * as addressBookApi from '../../api/addressBookApi';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../preferences/preferenceNormalizers';

let mockAuth: {
  user: { id: number; username: string; role: string; permissions: string[] };
  hasPermission: (permission: string) => boolean;
};

let mockPreferences: {
  preferences: UserPreferences;
  loading: boolean;
  refreshPreferences: jest.Mock;
  savePreferences: jest.Mock;
};

jest.mock('../../auth/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../../preferences/PreferencesContext', () => ({
  usePreferences: () => mockPreferences,
}));

jest.mock('../../navigation/moduleRegistry', () => ({
  openPortalPath: jest.fn(),
}));

jest.mock('../../addressBook/openAddressBookChat', () => ({
  openAddressBookChat: jest.fn(),
  isAddressBookChatNotFound: jest.fn(() => false),
  getAddressBookChatErrorMessage: jest.fn(() => 'chat error'),
}));

jest.mock('../../api/addressBookApi', () => ({
  searchAddressBook: jest.fn(),
  getAddressBookStatus: jest.fn(),
  syncAddressBook: jest.fn(),
}));

const sampleItem = {
  full_name: 'Ivanov Ivan Ivanovich',
  department: 'Monitoring department',
  department_location: 'Tyumen',
  position: 'Lead specialist',
  age: 36,
  hire_date: '2021-05-17',
  work_phones: [{ kind: 'Рабочий телефон', value: '83452384202', normalized: '73452384202' }],
  personal_phones: [{ kind: 'Мобильный телефон', value: '89312250556', normalized: '79312250556' }],
  work_emails: [{ kind: 'Корпоративный E-mail', value: 'ivanov@zsgp.ru', normalized: 'ivanov@zsgp.ru' }],
  personal_emails: [],
};

const rowId = 'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0';

function setViewerAuth(extraPermissions: string[] = []) {
  const permissions = ['address_book.read', ...extraPermissions];
  mockAuth = {
    user: { id: 2, username: 'user', role: 'viewer', permissions },
    hasPermission: (permission) => permissions.includes(permission),
  };
}

function setAdminAuth() {
  mockAuth = {
    user: { id: 1, username: 'admin', role: 'admin', permissions: ['address_book.read', 'chat.read', 'chat.write'] },
    hasPermission: () => true,
  };
}

describe('NativeAddressBookScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPreferences = {
      preferences: { ...DEFAULT_PREFERENCES },
      loading: false,
      refreshPreferences: jest.fn(),
      savePreferences: jest.fn(),
    };
    (addressBookApi.searchAddressBook as jest.Mock).mockResolvedValue({
      items: [sampleItem],
      total: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
    });
    (addressBookApi.getAddressBookStatus as jest.Mock).mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
    });
    (addressBookApi.syncAddressBook as jest.Mock).mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T11:00:00+00:00',
      last_error: '',
    });
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  it('renders search results and hides sync for a regular user', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy();
    });
    expect(view.getByText('Lead specialist · Monitoring department')).toBeTruthy();
    expect(view.getByText('89312250556')).toBeTruthy();
    expect(view.queryByTestId('address-book-sync')).toBeNull();
    expect(addressBookApi.searchAddressBook).toHaveBeenCalledWith({ q: '', limit: 50 });
  });

  it('shows the 1C sync action for an admin', async () => {
    setAdminAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByTestId('address-book-sync')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-sync'));
    });
    await waitFor(() => {
      expect(addressBookApi.syncAddressBook).toHaveBeenCalled();
    });
  });

  it('opens the contact card from a list row', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByTestId(rowId)).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId(rowId));
    });
    expect(view.getByTestId('address-book-entry-detail')).toBeTruthy();
    expect(view.getByTestId('address-book-person-meta')).toBeTruthy();
    expect(view.getByTestId('address-book-hire-date').props.children).toEqual([
      'Дата приёма: ',
      '17.05.2021',
    ]);
    expect(view.getByText('Рабочие')).toBeTruthy();
    expect(view.getByText('Личные')).toBeTruthy();
    expect(view.getByText('83452384202')).toBeTruthy();
  });

  it('does not render personal phones when the API omitted them', async () => {
    setViewerAuth();
    (addressBookApi.searchAddressBook as jest.Mock).mockResolvedValue({
      items: [{ ...sampleItem, personal_phones: [], age: null, hire_date: null }],
      total: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
    });
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByTestId(rowId)).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId(rowId));
    });
    expect(view.queryByText('Личные')).toBeNull();
    expect(view.queryByText('36 лет')).toBeNull();
    expect(view.queryByTestId('address-book-hire-date')).toBeNull();
  });

  it('opens HUB mail compose from the list quick action', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByLabelText('Написать в HUB ivanov@zsgp.ru')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('Написать в HUB ivanov@zsgp.ru'));
    });
    expect(openPortalPath).toHaveBeenCalledWith('/mail?folder=inbox&compose_to=ivanov%40zsgp.ru');
  });

  it('copies a MAX number and shows the helper alert', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByTestId(rowId)).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId(rowId));
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('Открыть MAX 89312250556'));
    });
    await waitFor(() => {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('+79312250556');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Как найти контакт в MAX',
        expect.stringContaining('+79312250556'),
      );
    });
  });

  it('shows chat action only with chat permissions', async () => {
    setViewerAuth(['chat.read', 'chat.write']);
    const view = await render(<NativeAddressBookScreen />);
    const chatId = 'address-book-chat-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0';

    await waitFor(() => {
      expect(view.getByTestId(chatId)).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId(chatId));
    });
    await waitFor(() => {
      expect(openAddressBookChat).toHaveBeenCalledWith(sampleItem);
    });
  });

  it('hides the screen without address_book.read', async () => {
    mockAuth = {
      user: { id: 3, username: 'guest', role: 'viewer', permissions: [] },
      hasPermission: () => false,
    };
    const view = await render(<NativeAddressBookScreen />);
    expect(view.getByText('Нет доступа')).toBeTruthy();
    expect(addressBookApi.searchAddressBook).not.toHaveBeenCalled();
  });
});
