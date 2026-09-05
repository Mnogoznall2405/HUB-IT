import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { NativeAddressBookScreen } from './NativeAddressBookScreen';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { openAddressBookChat, openCachedAddressBookChat } from '../../addressBook/openAddressBookChat';
import * as addressBookApi from '../../api/addressBookApi';
import * as addressBookSnapshot from '../../cache/nativeAddressBookSnapshot';
import * as snapshotCache from '../../cache/nativeSnapshotCache';
import { DEFAULT_PREFERENCES, type UserPreferences } from '../../preferences/preferenceNormalizers';

let mockAuth: {
  user: { id: number; username: string; role: string; permissions: string[] };
  hasPermission: (permission: string) => boolean;
  offlineMode: boolean;
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
  openCachedAddressBookChat: jest.fn(),
  getAddressBookChatCacheKey: jest.fn(() => 'email:ivanov@zsgp.ru'),
  isAddressBookChatNotFound: jest.fn(() => false),
  getAddressBookChatErrorMessage: jest.fn(() => 'chat error'),
}));

jest.mock('../../api/addressBookApi', () => ({
  searchAddressBook: jest.fn(),
  getCompleteAddressBook: jest.fn(),
  getAddressBookStatus: jest.fn(),
  syncAddressBook: jest.fn(),
}));

jest.mock('../../cache/nativeAddressBookSnapshot', () => ({
  readNativeAddressBookSnapshot: jest.fn(),
  writeNativeAddressBookSnapshot: jest.fn(),
}));

jest.mock('../../cache/nativeSnapshotCache', () => ({
  readNativeEntitySnapshot: jest.fn(),
  writeNativeEntitySnapshot: jest.fn(),
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
    offlineMode: false,
  };
}

function setAdminAuth() {
  mockAuth = {
    user: { id: 1, username: 'admin', role: 'admin', permissions: ['address_book.read', 'chat.read', 'chat.write'] },
    hasPermission: () => true,
    offlineMode: false,
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
    (addressBookApi.getCompleteAddressBook as jest.Mock).mockResolvedValue({
      items: [sampleItem],
      total: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
      has_more: false,
    });
    (addressBookSnapshot.readNativeAddressBookSnapshot as jest.Mock).mockResolvedValue(null);
    (addressBookSnapshot.writeNativeAddressBookSnapshot as jest.Mock).mockResolvedValue(true);
    (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue(null);
    (snapshotCache.writeNativeEntitySnapshot as jest.Mock).mockResolvedValue(undefined);
    (openAddressBookChat as jest.Mock).mockResolvedValue({ conversationId: 'c-42', peerUserId: 42 });
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
    expect(addressBookApi.getCompleteAddressBook).toHaveBeenCalled();
    expect(addressBookSnapshot.writeNativeAddressBookSnapshot).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ items: [sampleItem], total: 1 }),
    );
  });

  it('opens the full saved directory offline without calling the server', async () => {
    setViewerAuth();
    mockAuth.offlineMode = true;
    (addressBookSnapshot.readNativeAddressBookSnapshot as jest.Mock).mockResolvedValue({
      savedAt: Date.now(),
      data: {
        items: [sampleItem],
        total: 1,
        updated_at: '2026-05-21T10:00:00+00:00',
        last_error: '',
      },
    });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    expect(addressBookApi.getCompleteAddressBook).not.toHaveBeenCalled();
    expect(addressBookApi.getAddressBookStatus).not.toHaveBeenCalled();
  });

  it('exposes all 5000 saved employees to the offline virtualized list', async () => {
    setViewerAuth();
    mockAuth.offlineMode = true;
    const offlineItems = Array.from({ length: 5_000 }, (_, index) => ({
      ...sampleItem,
      full_name: `Employee ${String(index).padStart(4, '0')}`,
      employee_code: `E${index}`,
      work_emails: [{
        kind: 'Корпоративный E-mail',
        value: `employee${index}@zsgp.ru`,
        normalized: `employee${index}@zsgp.ru`,
      }],
    }));
    (addressBookSnapshot.readNativeAddressBookSnapshot as jest.Mock).mockResolvedValue({
      savedAt: Date.now(),
      data: {
        items: offlineItems,
        total: offlineItems.length,
        updated_at: '2026-09-04T10:00:00+05:00',
        last_error: '',
        has_more: false,
      },
    });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByTestId('address-book-entry-list').props.data).toHaveLength(5_000);
    });
    const savedItems = view.getByTestId('address-book-entry-list').props.data;
    expect(savedItems.at(-1)?.employee_code).toBe('E4999');
    expect(view.getByText('Найдено 5000')).toBeTruthy();
    expect(addressBookApi.getCompleteAddressBook).not.toHaveBeenCalled();
    expect(addressBookApi.getAddressBookStatus).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the live directory visible when refreshing the offline copy fails', async () => {
    setViewerAuth();
    (addressBookSnapshot.writeNativeAddressBookSnapshot as jest.Mock).mockResolvedValue(false);

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    expect(view.getByText('Адресная книга загружена, но offline-копию обновить не удалось.')).toBeTruthy();
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
    (addressBookApi.getCompleteAddressBook as jest.Mock).mockResolvedValue({
      items: [{ ...sampleItem, personal_phones: [], age: null, hire_date: null }],
      total: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
      has_more: false,
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
    expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
      'address-book-chat-links',
      2,
      'email:ivanov@zsgp.ru',
      { conversationId: 'c-42', peerUserId: 42 },
    );
  });

  it('opens a known contact chat offline from the local link cache', async () => {
    setViewerAuth(['chat.read', 'chat.write']);
    mockAuth.offlineMode = true;
    (addressBookSnapshot.readNativeAddressBookSnapshot as jest.Mock).mockResolvedValue({
      savedAt: Date.now(),
      data: { items: [sampleItem], total: 1, updated_at: '', last_error: '' },
    });
    (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockResolvedValue({
      savedAt: Date.now(),
      data: { conversationId: 'cached-42', peerUserId: 42 },
    });
    const view = await render(<NativeAddressBookScreen />);
    const chatId = 'address-book-chat-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0';

    await waitFor(() => expect(view.getByTestId(chatId)).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId(chatId));
    });

    await waitFor(() => expect(openCachedAddressBookChat).toHaveBeenCalledWith({
      conversationId: 'cached-42',
      peerUserId: 42,
    }));
    expect(openAddressBookChat).not.toHaveBeenCalled();
  });

  it('hides the screen without address_book.read', async () => {
    mockAuth = {
      user: { id: 3, username: 'guest', role: 'viewer', permissions: [] },
      hasPermission: () => false,
      offlineMode: false,
    };
    const view = await render(<NativeAddressBookScreen />);
    expect(view.getByText('Нет доступа')).toBeTruthy();
    expect(addressBookApi.searchAddressBook).not.toHaveBeenCalled();
  });
});
