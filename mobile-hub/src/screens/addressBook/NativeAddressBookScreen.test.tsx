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

const codedItem = (code: string, name: string) => ({
  ...sampleItem,
  full_name: name,
  employee_code: code,
});

const mockDirectory = (items: Array<Record<string, unknown>>) => {
  (addressBookApi.getCompleteAddressBook as jest.Mock).mockResolvedValue({
    items,
    total: items.length,
    updated_at: '2026-05-21T10:00:00+00:00',
    last_error: '',
    has_more: false,
  });
};

const mockSavedCodes = ({ favorites = [], recents = [] }: {
  favorites?: string[];
  recents?: string[];
}) => {
  (snapshotCache.readNativeEntitySnapshot as jest.Mock).mockImplementation(
    async (scope: string, _userId: number, key: string) => {
      if (scope !== 'address-book-favorites') return null;
      const data = key === 'favorites' ? favorites : key === 'recent' ? recents : null;
      return data ? { savedAt: Date.now(), data } : null;
    },
  );
};

const listData = (view: Awaited<ReturnType<typeof render>>) => (
  view.getByTestId('address-book-entry-list').props.data as Array<{ employee_code?: string; full_name?: string }>
);

const entryRowId = (name: string, index = 0) => (
  `address-book-entry-row-${name}|Monitoring department|Lead specialist|${index}`
);

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
    // The snapshot write is deferred until interactions + input quiet settle.
    await waitFor(() => {
      expect(addressBookSnapshot.writeNativeAddressBookSnapshot).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ items: [sampleItem], total: 1 }),
      );
    }, { timeout: 3000 });
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
    // N3: count and update time share a single meta line.
    expect(view.getByText(/Найдено 5000 · Обновлено/)).toBeTruthy();
    expect(addressBookApi.getCompleteAddressBook).not.toHaveBeenCalled();
    expect(addressBookApi.getAddressBookStatus).not.toHaveBeenCalled();
    view.unmount();
  });

  it('keeps the live directory visible when refreshing the offline copy fails', async () => {
    setViewerAuth();
    (addressBookSnapshot.writeNativeAddressBookSnapshot as jest.Mock).mockResolvedValue(false);

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    await waitFor(
      () => expect(view.getByText('Адресная книга загружена, но offline-копию обновить не удалось.')).toBeTruthy(),
      { timeout: 3000 },
    );
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

  it('keeps the admin sync action icon-only on the compact meta row', async () => {
    setAdminAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByTestId('address-book-sync')).toBeTruthy();
    });
    const syncButton = view.getByTestId('address-book-sync');
    expect(syncButton.props.accessibilityLabel).toBe('Обновить из 1С');
    // Compact variant: icon-only button on the meta row keeps a 44pt target.
    expect(view.queryByText('Синхронизировать с 1С')).toBeNull();
    expect(syncButton.props.style).toMatchObject({ width: 44, height: 44 });
    // Meta line carries both counters.
    expect(view.getByText(/Найдено \d+ · Обновлено/)).toBeTruthy();
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

  it('opens HUB mail compose through the contact actions', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => {
      expect(view.getByLabelText('Все действия: Ivanov Ivan Ivanovich')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('Все действия: Ivanov Ivan Ivanovich'));
    });
    await act(async () => {
      fireEvent.press(view.getAllByLabelText('Написать в HUB ivanov@zsgp.ru')[0]);
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
    await waitFor(() => expect(view.getByLabelText('Все действия: Ivanov Ivan Ivanovich')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Все действия: Ivanov Ivan Ivanovich'));
    const chatId = 'address-book-chat-detail';

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
    await waitFor(() => expect(view.getByLabelText('Все действия: Ivanov Ivan Ivanovich')).toBeTruthy());
    await fireEvent.press(view.getByLabelText('Все действия: Ivanov Ivan Ivanovich'));
    const chatId = 'address-book-chat-detail';

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

  it('hides the modes row when no codes are saved', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    expect(view.queryByTestId('address-book-list-modes')).toBeNull();
  });

  it('hides the modes row while the local snapshot is not loaded', async () => {
    setViewerAuth();
    mockSavedCodes({ favorites: ['E1'] });
    // Remote results render, but the complete directory never resolves.
    (addressBookApi.getCompleteAddressBook as jest.Mock).mockReturnValue(new Promise(() => undefined));

    const view = await render(<NativeAddressBookScreen />);

    await act(async () => {
      fireEvent.changeText(view.getByTestId('address-book-search-input'), 'Ivanov');
    });
    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    expect(view.queryByTestId('address-book-list-modes')).toBeNull();
  });

  it('filters favorites to snapshot codes, counts live entries and sorts by name', async () => {
    setViewerAuth();
    mockDirectory([
      codedItem('E1', 'Zeta Zetovich'),
      codedItem('E2', 'Alpha Alpovich'),
      codedItem('E3', 'Beta Betovich'),
    ]);
    mockSavedCodes({ favorites: ['E1', 'E2', 'E-STALE'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('★ Избранные (2)')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-favorites'));
    });
    const data = listData(view);
    expect(data.map((item) => item.employee_code)).toEqual(['E2', 'E1']);
    expect(view.queryByText('Beta Betovich')).toBeNull();
  });

  it('shows recents in stored last-opened order', async () => {
    setViewerAuth();
    mockDirectory([
      codedItem('E1', 'Alpha Alpovich'),
      codedItem('E2', 'Beta Betovich'),
      codedItem('E3', 'Gamma Gamovich'),
    ]);
    mockSavedCodes({ recents: ['E2', 'E1'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Недавние (2)')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-recent'));
    });
    expect(listData(view).map((item) => item.employee_code)).toEqual(['E2', 'E1']);
  });

  it('keeps the visible recents order stable when a card opens', async () => {
    setViewerAuth();
    mockDirectory([
      codedItem('E1', 'Alpha Alpovich'),
      codedItem('E2', 'Beta Betovich'),
    ]);
    mockSavedCodes({ recents: ['E2', 'E1'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Недавние (2)')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-recent'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId(entryRowId('Alpha Alpovich', 1)));
    });

    // The opened card was pushed to recents, but the visible mode session
    // keeps the order frozen at mode entry.
    await waitFor(() => {
      expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
        'address-book-favorites',
        2,
        'recent',
        ['E1', 'E2'],
      );
    });
    expect(listData(view).map((item) => item.employee_code)).toEqual(['E2', 'E1']);
  });

  it('filters inside the active mode by the search query', async () => {
    setViewerAuth();
    mockDirectory([
      codedItem('E1', 'Alpha Alpovich'),
      codedItem('E2', 'Beta Betovich'),
    ]);
    mockSavedCodes({ favorites: ['E1', 'E2'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('★ Избранные (2)')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-favorites'));
    });
    await act(async () => {
      fireEvent.changeText(view.getByTestId('address-book-search-input'), 'Alpha');
    });
    await waitFor(() => {
      expect(listData(view).map((item) => item.employee_code)).toEqual(['E1']);
    });
  });

  it('toggles the star from the detail card and updates the counter', async () => {
    setViewerAuth();
    mockDirectory([codedItem('E1', 'Alpha Alpovich')]);
    mockSavedCodes({});

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Alpha Alpovich')).toBeTruthy());
    expect(view.queryByTestId('address-book-list-modes')).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId(entryRowId('Alpha Alpovich')));
    });
    const toggle = view.getByTestId('address-book-favorite-toggle');
    expect(toggle.props.accessibilityState.selected).toBe(false);

    await act(async () => {
      fireEvent.press(toggle);
    });
    await waitFor(() => {
      expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
        'address-book-favorites',
        2,
        'favorites',
        ['E1'],
      );
    });
    await waitFor(() => {
      expect(view.getByTestId('address-book-favorite-toggle').props.accessibilityState.selected).toBe(true);
    });
    // Closing the card reveals the modes row with the updated counter.
    await act(async () => {
      fireEvent.press(view.getByTestId('account-subpage-back'));
    });
    await waitFor(() => expect(view.getByText('★ Избранные (1)')).toBeTruthy());
  });

  it('clears recents only in recent mode and falls back to all', async () => {
    setViewerAuth();
    mockDirectory([codedItem('E1', 'Alpha Alpovich'), codedItem('E2', 'Beta Betovich')]);
    mockSavedCodes({ favorites: ['E1'], recents: ['E2'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Недавние (1)')).toBeTruthy());
    expect(view.queryByTestId('address-book-clear-recent')).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-recent'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-clear-recent'));
    });

    await waitFor(() => {
      expect(snapshotCache.writeNativeEntitySnapshot).toHaveBeenCalledWith(
        'address-book-favorites',
        2,
        'recent',
        [],
      );
    });
    // Back to "Все": the full directory and the favorites segment are shown,
    // and the recent segment is gone.
    expect(view.queryByTestId('address-book-mode-recent')).toBeNull();
    expect(view.getByTestId('address-book-mode-all').props.accessibilityState.selected).toBe(true);
    expect(listData(view).map((item) => item.employee_code)).toEqual(['E1', 'E2']);
  });

  it('shows modes and saved entries offline from the local snapshot', async () => {
    setViewerAuth();
    mockAuth.offlineMode = true;
    (addressBookSnapshot.readNativeAddressBookSnapshot as jest.Mock).mockResolvedValue({
      savedAt: Date.now(),
      data: {
        items: [codedItem('E1', 'Alpha Alpovich'), codedItem('E2', 'Beta Betovich')],
        total: 2,
        updated_at: '2026-05-21T10:00:00+00:00',
        last_error: '',
      },
    });
    mockSavedCodes({ favorites: ['E2'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('★ Избранные (1)')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-favorites'));
    });
    expect(listData(view).map((item) => item.employee_code)).toEqual(['E2']);
    expect(addressBookApi.getCompleteAddressBook).not.toHaveBeenCalled();
  });

  it('shows an empty-mode hint when a query matches nothing saved', async () => {
    setViewerAuth();
    mockDirectory([codedItem('E1', 'Alpha Alpovich')]);
    mockSavedCodes({ favorites: ['E1'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('★ Избранные (1)')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-favorites'));
    });
    await act(async () => {
      fireEvent.changeText(view.getByTestId('address-book-search-input'), 'zzzz');
    });
    await waitFor(() => {
      expect(view.getByText('Среди избранных по текущему запросу никого не найдено.')).toBeTruthy();
    });
  });

  it('keeps interactive targets at 44 pt and exposes pressed state', async () => {
    setViewerAuth();
    mockDirectory([codedItem('E1', 'Alpha Alpovich')]);
    mockSavedCodes({ favorites: ['E1'], recents: ['E1'] });

    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByTestId('address-book-mode-favorites')).toBeTruthy());
    expect(view.getByTestId('address-book-mode-all')).toHaveStyle({ minHeight: 44 });
    expect(view.getByTestId('address-book-mode-favorites')).toHaveStyle({ minHeight: 44 });
    expect(view.getByTestId('address-book-mode-recent')).toHaveStyle({ minHeight: 44 });
    expect(view.getByTestId('address-book-mode-all').props.accessibilityState?.selected).toBe(true);
    expect(view.getByTestId('address-book-mode-favorites').props.accessibilityState?.selected).toBe(false);
  });

  it('does not lose a deferred snapshot write when the screen unmounts', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    // The first deferred write has already run (no recent input); re-schedule
    // one inside the input-quiet window so it stays pending until unmount.
    (addressBookSnapshot.writeNativeAddressBookSnapshot as jest.Mock).mockClear();
    await act(async () => {
      fireEvent.changeText(view.getByTestId('address-book-search-input'), 'zzz');
    });
    await waitFor(() => expect(view.getByText('По вашему запросу сотрудники не найдены.')).toBeTruthy());
    await act(async () => {
      // FlatList forwards onRefresh onto the inner RefreshControl element.
      const refreshControl = view.getByTestId('address-book-entry-list').props.refreshControl;
      expect(refreshControl).toBeTruthy();
      refreshControl.props.onRefresh();
      // Let the refresh fetch resolve and schedule the deferred write while
      // the input-quiet window still keeps it pending (< 500 ms since typing).
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(addressBookApi.getCompleteAddressBook).toHaveBeenCalledTimes(2);

    await view.unmount();

    expect(addressBookSnapshot.writeNativeAddressBookSnapshot).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ items: [sampleItem], total: 1 }),
    );
  });

  // N5 «Уволенные»: серверная вкладка по праву address_book.dismissed.read.
  const dismissedItem = (name: string, extras: Record<string, unknown> = {}) => ({
    ...sampleItem,
    full_name: name,
    employee_code: `D-${name}`,
    dismissal_date: '2024-01-31',
    ...extras,
  });

  const dismissedCalls = () => (
    (addressBookApi.searchAddressBook as jest.Mock).mock.calls
      .map(([options]) => options as { dismissed?: boolean })
      .filter((options) => options.dismissed === true)
  );

  const mockDismissedSearch = (
    impl: (options: { q?: string; offset?: number }) => Promise<Record<string, unknown>>,
  ) => {
    (addressBookApi.searchAddressBook as jest.Mock).mockImplementation(
      async (options: { dismissed?: boolean; q?: string; offset?: number }) => (
        options.dismissed
          ? impl(options)
          : { items: [sampleItem], total: 1, updated_at: '2026-05-21T10:00:00+00:00', last_error: '' }
      ),
    );
  };

  const dismissedOk = (items: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => (
    mockDismissedSearch(async () => ({
      items,
      total: items.length,
      has_more: false,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
      ...extra,
    }))
  );

  const openDismissedTab = async (view: Awaited<ReturnType<typeof render>>) => {
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-tab-dismissed'));
    });
  };

  it('hides the dismissed tab without the permission and sends no requests', async () => {
    setViewerAuth();
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    expect(view.queryByTestId('address-book-tab-dismissed')).toBeNull();
    expect(view.queryByTestId('address-book-tab-active')).toBeNull();
    expect(dismissedCalls()).toHaveLength(0);
  });

  it('queries the dismissed tab with dismissed=true and no employee_codes', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    dismissedOk([dismissedItem('Petrov Petr Petrovich')]);
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    await openDismissedTab(view);

    await waitFor(() => expect(dismissedCalls().length).toBeGreaterThan(0));
    const request = dismissedCalls()[0] as Record<string, unknown>;
    expect(request).toEqual(expect.objectContaining({ q: '', limit: 50, offset: 0, dismissed: true }));
    expect('employee_codes' in request).toBe(false);
    expect(view.getByText('Petrov Petr Petrovich')).toBeTruthy();
    expect(view.getByText('Уволен 31.01.2024')).toBeTruthy();
  });

  it('shows the badge without a date as plain «Уволен»', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    dismissedOk([dismissedItem('Sidorov Sidor Sidorovich', { dismissal_date: null })]);
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    await openDismissedTab(view);
    await waitFor(() => expect(view.getByText('Уволен')).toBeTruthy());
  });

  it('keeps allowed actions and hides restricted ones in the dismissed card', async () => {
    setViewerAuth(['address_book.dismissed.read', 'chat.read', 'chat.write']);
    dismissedOk([dismissedItem('Petrov Petr Petrovich')]);
    const view = await render(<NativeAddressBookScreen />);

    await openDismissedTab(view);
    await waitFor(() => expect(view.getByText('Petrov Petr Petrovich')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-entry-row-Petrov Petr Petrovich|Monitoring department|Lead specialist|0'));
    });

    expect(view.getByTestId('address-book-dismissed-chip')).toBeTruthy();
    // Kept: call, copy, Telegram, external mailto.
    expect(view.getAllByLabelText('Позвонить 83452384202').length).toBeGreaterThan(0);
    expect(view.getAllByLabelText('Скопировать 83452384202').length).toBeGreaterThan(0);
    expect(view.getAllByLabelText('Открыть Telegram 83452384202').length).toBeGreaterThan(0);
    expect(view.getAllByLabelText('Открыть внешнюю почту ivanov@zsgp.ru').length).toBeGreaterThan(0);
    // Hidden: MAX, HUB compose, chat, star.
    expect(view.queryByLabelText('Открыть MAX 83452384202')).toBeNull();
    expect(view.queryByLabelText('Написать в HUB ivanov@zsgp.ru')).toBeNull();
    expect(view.queryByTestId('address-book-chat-detail')).toBeNull();
    expect(view.queryByTestId('address-book-favorite-toggle')).toBeNull();
  });

  it('loads the next dismissed page on end reached', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    mockDismissedSearch(async ({ offset = 0 }) => ({
      items: offset === 0 ? [dismissedItem('Petrov Petr Petrovich')] : [dismissedItem('Sidorov Sidor Sidorovich')],
      total: 51_000,
      has_more: offset === 0,
      offset,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
    }));
    const view = await render(<NativeAddressBookScreen />);

    await openDismissedTab(view);
    await waitFor(() => expect(view.getByText('Petrov Petr Petrovich')).toBeTruthy());

    await act(async () => {
      fireEvent(view.getByTestId('address-book-entry-list'), 'onEndReached');
    });
    await waitFor(() => {
      expect(dismissedCalls().some((call) => (call as { offset?: number }).offset === 1)).toBe(true);
    });
    expect(listData(view).map((item) => item.full_name)).toEqual([
      'Petrov Petr Petrovich',
      'Sidorov Sidor Sidorovich',
    ]);
  });

  it('does not send a dismissed request for a one-character query', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    dismissedOk([dismissedItem('Petrov Petr Petrovich')]);
    const view = await render(<NativeAddressBookScreen />);

    await openDismissedTab(view);
    await waitFor(() => expect(dismissedCalls()).toHaveLength(1));

    await act(async () => {
      fireEvent.changeText(view.getByTestId('address-book-search-input'), 'а');
    });
    await waitFor(
      () => expect(view.getByText('Введите минимум 2 символа')).toBeTruthy(),
      { timeout: 2000 },
    );
    // The hint is rendered off the fully debounced remote query — if it is
    // visible, the debounce window has already expired without a request.
    expect(dismissedCalls()).toHaveLength(1);
  });

  it('keeps the newest dismissed page when an older response resolves late', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    const pending: Array<(value: Record<string, unknown>) => void> = [];
    mockDismissedSearch(() => new Promise((resolve) => { pending.push(resolve); }));
    const view = await render(<NativeAddressBookScreen />);

    await openDismissedTab(view);
    await waitFor(() => expect(pending.length).toBe(1));

    await act(async () => {
      fireEvent.changeText(view.getByTestId('address-book-search-input'), 'zz');
    });
    await waitFor(() => expect(pending.length).toBe(2), { timeout: 2000 });

    await act(async () => {
      pending[1]({ items: [dismissedItem('Beta Betovich')], total: 1, has_more: false });
    });
    await waitFor(() => expect(view.getByText('Beta Betovich')).toBeTruthy());

    await act(async () => {
      pending[0]({ items: [dismissedItem('Alpha Alpovich')], total: 1, has_more: false });
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(view.queryByText('Alpha Alpovich')).toBeNull();
    expect(view.getByText('Beta Betovich')).toBeTruthy();
  });

  it('shows the offline notice on the dismissed tab and sends no requests', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    mockAuth.offlineMode = true;
    dismissedOk([]);
    const view = await render(<NativeAddressBookScreen />);

    await openDismissedTab(view);
    await waitFor(() => expect(view.getByTestId('address-book-dismissed-offline')).toBeTruthy());
    expect(view.getByText('Список уволенных доступен при подключении к сети')).toBeTruthy();
    expect(addressBookApi.searchAddressBook).not.toHaveBeenCalled();
  });

  it('shows the dismissed error state and retries', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    let failing = true;
    mockDismissedSearch(async () => {
      if (failing) throw Object.assign(new Error('boom'), { response: { status: 500 } });
      return { items: [dismissedItem('Petrov Petr Petrovich')], total: 1, has_more: false };
    });
    const view = await render(<NativeAddressBookScreen />);

    await openDismissedTab(view);
    await waitFor(() => expect(view.getByText('Не удалось загрузить список уволенных')).toBeTruthy());
    expect(view.getByTestId('address-book-dismissed-retry')).toBeTruthy();

    // The active directory keeps working while the dismissed tab failed.
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-tab-active'));
    });
    expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy();

    await openDismissedTab(view);
    await waitFor(() => expect(view.getByText('Не удалось загрузить список уволенных')).toBeTruthy());
    failing = false;
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-dismissed-retry'));
    });
    await waitFor(() => expect(view.getByText('Petrov Petr Petrovich')).toBeTruthy());
  });

  it('keeps loaded pages and retries a failed append from the same offset', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    let appendFails = true;
    mockDismissedSearch(async ({ offset = 0 }) => {
      if (offset === 0) {
        return { items: [dismissedItem('Petrov Petr Petrovich')], total: 51_000, has_more: true, offset: 0 };
      }
      if (appendFails) throw Object.assign(new Error('boom'), { response: { status: 500 } });
      return { items: [dismissedItem('Sidorov Sidor Sidorovich')], total: 51_000, has_more: false, offset };
    });
    const view = await render(<NativeAddressBookScreen />);

    await openDismissedTab(view);
    await waitFor(() => expect(view.getByText('Petrov Petr Petrovich')).toBeTruthy());

    await act(async () => {
      fireEvent(view.getByTestId('address-book-entry-list'), 'onEndReached');
    });
    // Page 2 failed: the loaded list stays, retry moves to the footer.
    await waitFor(() => expect(view.getByTestId('address-book-dismissed-retry')).toBeTruthy());
    expect(view.getByText('Petrov Petr Petrovich')).toBeTruthy();

    appendFails = false;
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-dismissed-retry'));
    });
    await waitFor(() => expect(view.getByText('Sidorov Sidor Sidorovich')).toBeTruthy());
    const lastCall = dismissedCalls().at(-1) as { offset?: number };
    expect(lastCall.offset).toBe(1);
  });

  it('returns to the active tab with a neutral message on 403', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    mockDismissedSearch(async () => {
      throw Object.assign(new Error('denied'), { response: { status: 403 } });
    });
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    await openDismissedTab(view);

    await waitFor(() => {
      expect(view.getByText('Список уволенных недоступен для вашей учётной записи.')).toBeTruthy();
    });
    expect(view.getByTestId('address-book-tab-active').props.accessibilityState?.selected).toBe(true);
    expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy();
  });

  it('preserves the search text, resets the mode and closes the card on tab switch', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    mockDirectory([codedItem('E1', 'Alpha Alpovich')]);
    mockSavedCodes({ favorites: ['E1'] });
    dismissedOk([dismissedItem('Petrov Petr Petrovich')]);
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('★ Избранные (1)')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-mode-favorites'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId(entryRowId('Alpha Alpovich')));
    });
    expect(view.getByTestId('address-book-entry-detail')).toBeTruthy();
    await act(async () => {
      fireEvent.changeText(view.getByTestId('address-book-search-input'), 'zz');
    });

    await openDismissedTab(view);

    expect(view.queryByTestId('address-book-entry-detail')).toBeNull();
    expect(view.getByTestId('address-book-search-input').props.value).toBe('zz');
    // The dismissed search reuses the preserved query text.
    await waitFor(() => {
      expect(dismissedCalls().some((call) => (call as { q?: string }).q === 'zz')).toBe(true);
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-tab-active'));
    });
    expect(view.getByTestId('address-book-mode-all').props.accessibilityState?.selected).toBe(true);
    expect(view.getByTestId('address-book-search-input').props.value).toBe('zz');
  });

  it('never writes dismissed rows into the local snapshot or recents', async () => {
    setViewerAuth(['address_book.dismissed.read']);
    dismissedOk([dismissedItem('Petrov Petr Petrovich')]);
    const view = await render(<NativeAddressBookScreen />);

    await waitFor(() => expect(view.getByText('Ivanov Ivan Ivanovich')).toBeTruthy());
    await openDismissedTab(view);
    await waitFor(() => expect(view.getByText('Petrov Petr Petrovich')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('address-book-entry-row-Petrov Petr Petrovich|Monitoring department|Lead specialist|0'));
    });
    expect(view.getByTestId('address-book-entry-detail')).toBeTruthy();

    await waitFor(
      () => expect(addressBookSnapshot.writeNativeAddressBookSnapshot).toHaveBeenCalled(),
      { timeout: 3000 },
    );
    const payloads = (addressBookSnapshot.writeNativeAddressBookSnapshot as jest.Mock).mock.calls
      .map(([, payload]) => payload as { items?: Array<{ full_name?: string }> });
    expect(payloads.every((payload) => !payload.items?.some((item) => item.full_name === 'Petrov Petr Petrovich'))).toBe(true);
    const writes = (snapshotCache.writeNativeEntitySnapshot as jest.Mock).mock.calls
      .filter(([scope, , key]) => scope === 'address-book-favorites' && key === 'recent');
    expect(writes).toHaveLength(0);
  });
});
