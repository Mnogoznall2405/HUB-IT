import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddressBook from './AddressBook';
import { addressBookAPI } from '../api/addressBook';

vi.mock('../api/addressBook', () => ({
  addressBookAPI: {
    search: vi.fn(),
    getFilters: vi.fn(),
    getStatus: vi.fn(),
    sync: vi.fn(),
  },
}));

let authUser = { role: 'viewer' };
const notifySuccessMock = vi.fn();
const notifyWarningMock = vi.fn();
const notifyApiErrorMock = vi.fn();
const navigateMock = vi.fn();
const hasPermissionMock = vi.fn(() => false);
const windowOpenMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authUser,
    hasPermission: hasPermissionMock,
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: notifySuccessMock,
    notifyWarning: notifyWarningMock,
    notifyApiError: notifyApiErrorMock,
  }),
}));

vi.mock('../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

vi.mock('../lib/addressBookChat', () => ({
  openAddressBookChat: vi.fn(),
}));

import { openAddressBookChat } from '../lib/addressBookChat';

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children, showDatabaseSelector }) => (
    <div data-testid="main-layout" data-show-database-selector={String(showDatabaseSelector)}>
      {children}
    </div>
  ),
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

const searchPlaceholder = 'ФИО, должность, подразделение, город, телефон или e-mail';

const samplePayload = {
  items: [
    {
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
    },
  ],
  total: 1,
  limit: 50,
  updated_at: '2026-05-21T10:00:00+00:00',
  last_error: '',
};

const setMatchMedia = (matches = false) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: typeof matches === 'function' ? matches(query) : matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const isMobileQuery = (query) => {
  const normalized = String(query).replace(/\s/g, '');
  return normalized.includes('max-width:599.95px') || normalized.includes('max-width:600px');
};
const isWideQuery = (query) => String(query).replace(/\s/g, '').includes('min-width:1200px');
const isTabletQuery = (query) => {
  const normalized = String(query).replace(/\s/g, '');
  return normalized.includes('min-width:600px') && !normalized.includes('min-width:1200px');
};

describe('AddressBook page', () => {
  it('keeps the latest search when the old response arrives last', async () => {
    const pending = [];
    addressBookAPI.search.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    render(<AddressBook />);
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), { target: { value: 'New contact' } });
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => { pending[1]({ ...samplePayload, items: [{ ...samplePayload.items[0], full_name: 'New contact' }] }); });
    await act(async () => { pending[0](samplePayload); });
    expect(await screen.findByTestId('address-book-entry-list')).toHaveTextContent('New contact');
    expect(screen.queryByText('Ivanov Ivan Ivanovich')).not.toBeInTheDocument();
  });

  beforeEach(() => {
    setMatchMedia(isWideQuery);
    authUser = { role: 'viewer' };
    hasPermissionMock.mockReset();
    hasPermissionMock.mockReturnValue(false);
    addressBookAPI.search.mockReset();
    addressBookAPI.getFilters.mockReset();
    addressBookAPI.getStatus.mockReset();
    addressBookAPI.sync.mockReset();
    window.localStorage.clear();
    addressBookAPI.search.mockResolvedValue(samplePayload);
    addressBookAPI.getFilters.mockResolvedValue({
      departments: [{ name: 'Monitoring department', count: 1 }],
      cities: [{ name: 'Tyumen', count: 1 }],
    });
    addressBookAPI.getStatus.mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
      sync_in_progress: false,
    });
    addressBookAPI.sync.mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T11:00:00+00:00',
      last_error: '',
      sync_in_progress: false,
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
    notifySuccessMock.mockClear();
    notifyWarningMock.mockClear();
    notifyApiErrorMock.mockClear();
    openAddressBookChat.mockReset();
    navigateMock.mockClear();
    windowOpenMock.mockClear();
    window.open = windowOpenMock;
    delete window.location;
    window.location = { href: '' };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders compact list with detail panel on desktop', async () => {
    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-entry-list')).toBeInTheDocument();
    expect(screen.getByTestId('address-book-entry-detail')).toBeInTheDocument();
    expect(screen.getByTestId('address-book-person-meta')).toHaveTextContent('Lead specialist · 36 лет');
    const hireDate = screen.getByTestId('address-book-hire-date');
    expect(hireDate).toHaveTextContent('Дата приёма');
    expect(hireDate).toHaveTextContent('17.05.2021');
    expect(screen.getAllByText('Ivanov Ivan Ivanovich').length).toBeGreaterThan(0);
    expect(screen.getByText('Рабочий телефон')).toBeInTheDocument();
    expect(screen.getAllByText('83452384202').length).toBeGreaterThan(0);
    expect(screen.getByText('Мобильный телефон')).toBeInTheDocument();
    expect(screen.getAllByText('89312250556').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ivanov@zsgp.ru').length).toBeGreaterThan(0);
  });

  it('renders contact details before HR metadata', async () => {
    render(<AddressBook />);

    const contactsHeader = await screen.findByText('Контакты');
    const workHeader = screen.getByText('Работа');
    const personalHeader = screen.getByText('Личное');

    // C3: Контакты → Работа → Личное.
    expect(
      contactsHeader.compareDocumentPosition(workHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      workHeader.compareDocumentPosition(personalHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('hides database selector in main layout', async () => {
    render(<AddressBook />);

    await screen.findByText('Ivanov Ivan Ivanovich');
    expect(screen.getByTestId('main-layout')).toHaveAttribute('data-show-database-selector', 'false');
  });

  it('does not render desktop phone rows as tel links or call actions', async () => {
    render(<AddressBook />);

    const workPhone = await screen.findByText('83452384202');
    const personalPhone = screen.getAllByText('89312250556')[0];

    expect(workPhone.closest('a')).toBeNull();
    expect(personalPhone.closest('a')).toBeNull();
    expect(screen.queryByLabelText('Позвонить 83452384202')).not.toBeInTheDocument();
  });

  it('shows an empty state instead of asking the user to select a missing result', async () => {
    addressBookAPI.search.mockResolvedValue({ ...samplePayload, items: [], total: 0 });
    render(<AddressBook />);

    await screen.findByTestId('address-book-entry-list-empty');
    expect(await screen.findByTestId('address-book-detail-empty-state'))
      .toHaveTextContent('Список пуст. Попробуйте обновить адресную книгу.');
    expect(within(screen.getByTestId('address-book-entry-detail-scroll'))
      .queryByTestId('address-book-entry-detail-empty')).not.toBeInTheDocument();
  });

  it('renders mobile compact list with tel quick action', async () => {
    setMatchMedia(isMobileQuery);

    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-mobile-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('address-book-entry-list')).toBeInTheDocument();
    expect(screen.queryByTestId('address-book-entry-detail')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Позвонить 83452384202')).toHaveAttribute('href', 'tel:+73452384202');
  });

  it('opens bottom sheet when tapping a row on mobile', async () => {
    setMatchMedia(isMobileQuery);

    render(<AddressBook />);

    const row = await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    );
    fireEvent.click(row);

    const sheet = await screen.findByTestId('address-book-entry-sheet');
    expect(sheet).toBeInTheDocument();
    expect(sheet.querySelector('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'address-book-sheet-title');
    expect(sheet.querySelector('#address-book-sheet-title')).toHaveTextContent('Ivanov Ivan Ivanovich');
    expect(screen.getAllByText('Ivanov Ivan Ivanovich').length).toBeGreaterThan(1);
  });

  it('uses a right-side drawer instead of a permanent detail panel at tablet widths', async () => {
    setMatchMedia(isTabletQuery);
    render(<AddressBook />);
    await screen.findByText('Ivanov Ivan Ivanovich');

    expect(screen.queryByTestId('address-book-entry-detail-scroll')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-book-entry-drawer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    const drawer = await screen.findByTestId('address-book-entry-drawer');
    expect(drawer.querySelector('[role="dialog"]')).toHaveAttribute('aria-labelledby', 'address-book-drawer-title');
    expect(drawer.querySelector('#address-book-drawer-title')).toHaveTextContent('Ivanov Ivan Ivanovich');
  });

  it('shows copied phone as a bottom-left notification', async () => {
    render(<AddressBook />);

    await screen.findByText('83452384202');
    fireEvent.click(screen.getByLabelText('Скопировать 83452384202'));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('83452384202');
      expect(notifySuccessMock).toHaveBeenCalledWith('Номер скопирован', expect.objectContaining({
        source: 'address-book-copy',
        dedupeMode: 'none',
      }));
    });
    expect(screen.queryByText('Номер скопирован')).not.toBeInTheDocument();
  });

  it('opens telegram deeplink for personal phone from detail panel', async () => {
    render(<AddressBook />);

    await screen.findByText('89312250556');
    fireEvent.click(screen.getAllByLabelText('Открыть Telegram 89312250556')[0]);

    expect(window.location.href).toBe('tg://resolve?phone=79312250556');
  });

  it('copies phone and shows MAX popover instructions', async () => {
    render(<AddressBook />);

    await screen.findByText('89312250556');
    fireEvent.click(screen.getAllByLabelText('Открыть MAX 89312250556')[0]);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('+79312250556');
      expect(screen.getByText('Как найти контакт в MAX')).toBeInTheDocument();
      expect(screen.getByText(/Вставьте скопированный номер: \+79312250556/)).toBeInTheDocument();
    });
  });

  it('does not open window for MAX action', async () => {
    render(<AddressBook />);

    await screen.findByText('89312250556');
    fireEvent.click(screen.getAllByLabelText('Открыть MAX 89312250556')[0]);

    expect(windowOpenMock).not.toHaveBeenCalled();
  });

  it('shows warning when MAX copy fails', async () => {
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error('clipboard denied'));

    render(<AddressBook />);

    await screen.findByText('89312250556');
    fireEvent.click(screen.getAllByLabelText('Открыть MAX 89312250556')[0]);

    await waitFor(() => {
      expect(notifyWarningMock).toHaveBeenCalledWith('Не удалось скопировать номер', expect.objectContaining({
        source: 'address-book-max',
      }));
    });
  });

  it('opens HUB mail compose from row quick action', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'mail.access');
    render(<AddressBook />);

    await screen.findByText('ivanov@zsgp.ru');
    fireEvent.click(screen.getAllByLabelText('Новое письмо в HUB ivanov@zsgp.ru')[0]);

    expect(navigateMock).toHaveBeenCalledWith('/mail?folder=inbox&compose_to=ivanov%40zsgp.ru');
  });

  it('hides HUB compose when the user has no mail access but keeps mailto', async () => {
    render(<AddressBook />);

    await screen.findByText('ivanov@zsgp.ru');
    expect(screen.queryByLabelText('Новое письмо в HUB ivanov@zsgp.ru')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Внешняя почта ivanov@zsgp.ru')).toHaveAttribute(
      'href',
      'mailto:ivanov@zsgp.ru',
    );
  });

  it('keeps external mailto action for employee email in detail panel', async () => {
    render(<AddressBook />);

    await screen.findByText('ivanov@zsgp.ru');
    expect(screen.getByLabelText('Внешняя почта ivanov@zsgp.ru')).toHaveAttribute('href', 'mailto:ivanov@zsgp.ru');
  });

  it('highlights matches in names and phones', async () => {
    const { container } = render(<AddressBook />);

    await screen.findByText('83452384202');
    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
      target: { value: '8345' },
    });

    expect(container.querySelector('mark')?.textContent).toBe('8345');
  });

  it('sends debounced search query to backend', async () => {
    render(<AddressBook />);

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledWith({ q: '', limit: 50, offset: 0, dismissed: false });
    });

    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
      target: { value: 'ivanov' },
    });

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledWith({ q: 'ivanov', limit: 50, offset: 0, dismissed: false });
    });
  });

  it('clears search from the input button', async () => {
    render(<AddressBook />);

    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
      target: { value: 'ivanov' },
    });

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledWith({ q: 'ivanov', limit: 50, offset: 0, dismissed: false });
    });

    fireEvent.click(screen.getByLabelText('Очистить поиск'));

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({ q: '', limit: 50, offset: 0, dismissed: false });
    });
  });

  it('shows manual sync action for admin users on desktop', async () => {
    authUser = { role: 'admin' };
    render(<AddressBook />);

    const button = await screen.findByRole('button', { name: /Обновить/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(addressBookAPI.sync).toHaveBeenCalledTimes(1);
    });
  });

  it('shows sync icon for admin users on mobile', async () => {
    authUser = { role: 'admin' };
    setMatchMedia(isMobileQuery);

    render(<AddressBook />);

    const button = await screen.findByTestId('address-book-sync-button');
    fireEvent.click(button);

    await waitFor(() => {
      expect(addressBookAPI.sync).toHaveBeenCalledTimes(1);
    });
  });

  it('shows updated date for non-admin users', async () => {
    authUser = { role: 'viewer' };
    render(<AddressBook />);

    await screen.findByText(/Обновлено:/);
    expect(screen.queryByRole('button', { name: /Обновить/i })).not.toBeInTheDocument();
  });

  it('uses search placeholder with e-mail', async () => {
    render(<AddressBook />);

    expect(await screen.findByPlaceholderText(searchPlaceholder)).toBeInTheDocument();
  });

  it('hides dismissed tab without the dismissed permission', async () => {
    hasPermissionMock.mockReturnValue(false);
    render(<AddressBook />);

    await screen.findByText('Ivanov Ivan Ivanovich');
    expect(screen.queryByTestId('address-book-tabs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address-book-tab-dismissed')).not.toBeInTheDocument();
  });

  it('loads dismissed employees after switching to the dismissed tab', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'address_book.dismissed.read');
    addressBookAPI.search.mockResolvedValue({ ...samplePayload, items: [], total: 0 });
    render(<AddressBook />);

    const dismissedTab = await screen.findByTestId('address-book-tab-dismissed');
    fireEvent.click(dismissedTab);

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({ q: '', limit: 50, offset: 0, dismissed: true });
    });
  });

  it('marks dismissed employees and limits their contact actions', async () => {
    setMatchMedia(isMobileQuery);
    hasPermissionMock.mockImplementation((permission) => (
      ['address_book.dismissed.read', 'chat.read', 'chat.write'].includes(permission)
    ));
    const dismissedEmployee = {
      ...samplePayload.items[0],
      dismissal_date: '2024-01-31',
    };
    addressBookAPI.search.mockResolvedValue({
      ...samplePayload,
      items: [dismissedEmployee],
      total: 1,
    });
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId('address-book-tab-dismissed'));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({ q: '', limit: 50, offset: 0, dismissed: true });
    });

    const row = await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    );
    expect(row).toHaveTextContent('Уволен 31.01.2024');
    fireEvent.click(row);

    const sheet = await screen.findByTestId('address-book-entry-sheet');
    expect(within(sheet).getByTestId('address-book-dismissed-chip')).toHaveTextContent('Уволен 31.01.2024');
    expect(
      within(sheet).getAllByLabelText('Позвонить 83452384202')
        .some((element) => element.getAttribute('href') === 'tel:+73452384202'),
    ).toBe(true);
    expect(within(sheet).getAllByLabelText('Открыть Telegram 83452384202').length).toBeGreaterThan(0);
    expect(within(sheet).getByLabelText('Скопировать 83452384202')).toBeInTheDocument();
    expect(within(sheet).queryByLabelText('Открыть MAX 83452384202')).not.toBeInTheDocument();
    expect(within(sheet).queryByLabelText('Новое письмо в HUB ivanov@zsgp.ru')).not.toBeInTheDocument();
    expect(within(sheet).getByLabelText('Внешняя почта ivanov@zsgp.ru'))
      .toHaveAttribute('href', 'mailto:ivanov@zsgp.ru');
    expect(within(sheet).queryByTestId('address-book-chat-detail')).not.toBeInTheDocument();
  });

  it('shows raw sync error details to admin users', async () => {
    authUser = { role: 'admin' };
    addressBookAPI.getStatus.mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: 'COM error: сервер 1С недоступен',
      last_sync_failed: true,
      sync_in_progress: false,
    });
    render(<AddressBook />);

    const syncStatus = await screen.findByTestId('address-book-sync-status');
    expect(syncStatus).toHaveTextContent('Ошибка синхронизации');
    expect(syncStatus).toHaveAttribute(
      'aria-label',
      'Ошибка синхронизации: COM error: сервер 1С недоступен',
    );
  });

  it('warns admin without details when the raw error text is empty', async () => {
    authUser = { role: 'admin' };
    addressBookAPI.getStatus.mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
      last_sync_failed: true,
      sync_in_progress: false,
    });
    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-sync-status')).toHaveTextContent('Ошибка синхронизации');
  });

  it('never shows raw sync error text to non-admin users', async () => {
    authUser = { role: 'viewer' };
    addressBookAPI.getStatus.mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: 'COM error: сервер 1С недоступен',
      last_sync_failed: true,
      sync_in_progress: false,
    });
    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-sync-status'))
      .toHaveTextContent('Данные могут быть неактуальны');
    expect(screen.queryByText(/COM error/)).not.toBeInTheDocument();
  });

  it('shows no sync-failure notices when the last sync succeeded', async () => {
    authUser = { role: 'viewer' };
    addressBookAPI.getStatus.mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
      last_sync_failed: false,
      sync_in_progress: false,
    });
    render(<AddressBook />);

    await screen.findByText('Ivanov Ivan Ivanovich');
    expect(screen.queryByText(/Последняя синхронизация завершилась ошибкой/)).not.toBeInTheDocument();
    expect(screen.queryByText(/информация может быть неактуальной/)).not.toBeInTheDocument();
  });

  it('keeps the sync failure flag when the search response updates status', async () => {
    authUser = { role: 'viewer' };
    let resolveSearch;
    addressBookAPI.search.mockImplementation(
      () => new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    addressBookAPI.getStatus.mockResolvedValue({
      count: 1,
      updated_at: '2026-05-21T10:00:00+00:00',
      last_error: '',
      last_sync_failed: true,
      sync_in_progress: false,
    });
    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-sync-status'))
      .toHaveTextContent('Данные могут быть неактуальны');

    await act(async () => {
      resolveSearch({ ...samplePayload, last_error: '' });
    });

    expect(screen.getByTestId('address-book-sync-status'))
      .toHaveTextContent('Данные могут быть неактуальны');
  });

  it('keeps the first load when the query returns to its original value', async () => {
    let resolveSearch;
    addressBookAPI.search.mockImplementation(
      () => new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    render(<AddressBook />);

    await waitFor(() => expect(addressBookAPI.search).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText(searchPlaceholder);
    fireEvent.change(input, { target: { value: 'а' } });
    fireEvent.change(input, { target: { value: '' } });

    await act(async () => {
      resolveSearch(samplePayload);
    });

    expect(await screen.findByTestId('address-book-entry-list')).toHaveTextContent('Ivanov Ivan Ivanovich');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(addressBookAPI.search).toHaveBeenCalledTimes(1);
  });

  it('applies the in-flight response when the query returns to the same debounced value', async () => {
    const pending = [];
    addressBookAPI.search.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    render(<AddressBook />);

    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => { pending[0](samplePayload); });
    expect(await screen.findByTestId('address-book-entry-list')).toHaveTextContent('Ivanov Ivan Ivanovich');

    const input = screen.getByPlaceholderText(searchPlaceholder);
    fireEvent.change(input, { target: { value: 'петров' } });
    await waitFor(() => expect(pending).toHaveLength(2));

    fireEvent.change(input, { target: { value: 'петрова' } });
    fireEvent.change(input, { target: { value: 'петров' } });

    await act(async () => {
      pending[1]({ ...samplePayload, items: [{ ...samplePayload.items[0], full_name: 'Петров Пётр' }], total: 1 });
    });

    await waitFor(() => {
      expect(screen.getByTestId('address-book-entry-list')).toHaveTextContent('Петров Пётр');
    });
    expect(screen.queryByText('Ivanov Ivan Ivanovich')).not.toBeInTheDocument();
    expect(addressBookAPI.search).toHaveBeenCalledTimes(2);
  });

  it('shows a retry panel instead of the empty state when the search fails', async () => {
    addressBookAPI.search.mockRejectedValueOnce(new Error('search down'));
    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-entry-list-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByText(/Сотрудники не найдены/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Не удалось загрузить адресную книгу.')).toHaveLength(1);
  });

  it('offers to clear the search when a query has no results', async () => {
    addressBookAPI.search
      .mockResolvedValueOnce(samplePayload)
      .mockResolvedValue({ ...samplePayload, items: [], total: 0 });
    render(<AddressBook />);

    await screen.findByTestId('address-book-entry-list');
    const input = screen.getByPlaceholderText(searchPlaceholder);
    fireEvent.change(input, { target: { value: 'nobody' } });

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledWith(expect.objectContaining({ q: 'nobody' }));
    });
    const emptyState = await screen.findByTestId('address-book-entry-list-empty');
    expect(within(emptyState).getByText('По запросу «nobody» ничего не найдено.')).toBeInTheDocument();

    fireEvent.click(within(emptyState).getByRole('button', { name: 'Сбросить поиск' }));
    await waitFor(() => expect(input).toHaveValue(''));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledTimes(3);
      expect(addressBookAPI.search).toHaveBeenLastCalledWith(expect.objectContaining({ q: '' }));
    });
    expect(await screen.findByText('В адресной книге пока нет сотрудников.')).toBeInTheDocument();
  });

  it('loads the next page on demand and appends it to the list', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => ({
      ...samplePayload.items[0],
      full_name: `Employee ${index}`,
      employee_code: String(index + 1),
    }));
    const secondPage = Array.from({ length: 10 }, (_, index) => ({
      ...samplePayload.items[0],
      full_name: `Employee ${50 + index}`,
      employee_code: String(100 + index),
    }));
    addressBookAPI.search.mockResolvedValueOnce({
      ...samplePayload,
      items: firstPage,
      total: 60,
      has_more: true,
    });
    addressBookAPI.search.mockResolvedValue({
      ...samplePayload,
      items: secondPage,
      total: 60,
      offset: 50,
      has_more: false,
    });
    render(<AddressBook />);

    const list = await screen.findByTestId('address-book-entry-list');
    expect(list).toHaveTextContent('Employee 49');
    expect(list).not.toHaveTextContent('Employee 50');
    expect(screen.getByText('Найдено 60, показано 50')).toBeInTheDocument();

    const selectedBeforeLoadMore = screen.getByTestId('address-book-entry-detail');
    expect(selectedBeforeLoadMore).toHaveTextContent('Employee 0');

    fireEvent.click(screen.getByTestId('address-book-load-more'));

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({
        q: '',
        limit: 50,
        offset: 50,
        dismissed: false,
      });
    });
    await waitFor(() => expect(list).toHaveTextContent('Employee 59'));
    expect(list).toHaveTextContent('Employee 0');
    expect(screen.getByText('Найдено 60')).toBeInTheDocument();
    expect(screen.queryByTestId('address-book-load-more')).not.toBeInTheDocument();
    expect(screen.getByTestId('address-book-entry-detail')).toHaveTextContent('Employee 0');
  });

  it('hides the load-more action when everything fits into the first page', async () => {
    render(<AddressBook />);

    await screen.findByTestId('address-book-entry-list');
    expect(screen.queryByTestId('address-book-load-more')).not.toBeInTheDocument();
  });

  it('offers admins a sync action when the address book is empty', async () => {
    authUser = { role: 'admin' };
    addressBookAPI.search.mockResolvedValue({ ...samplePayload, items: [], total: 0 });
    render(<AddressBook />);

    const emptyState = await screen.findByTestId('address-book-entry-list-empty');
    expect(within(emptyState).getByText('В адресной книге пока нет сотрудников.')).toBeInTheDocument();
    fireEvent.click(within(emptyState).getByRole('button', { name: 'Обновить из 1С' }));

    await waitFor(() => expect(addressBookAPI.sync).toHaveBeenCalledTimes(1));
  });

  it('does not offer the empty-book sync action to non-admins', async () => {
    addressBookAPI.search.mockResolvedValue({ ...samplePayload, items: [], total: 0 });
    render(<AddressBook />);

    const emptyState = await screen.findByTestId('address-book-entry-list-empty');
    expect(within(emptyState).getByText('В адресной книге пока нет сотрудников.')).toBeInTheDocument();
    expect(within(emptyState).queryByRole('button', { name: 'Обновить из 1С' })).not.toBeInTheDocument();
  });

  it('loads data after retrying a failed search', async () => {
    addressBookAPI.search.mockRejectedValueOnce(new Error('search down'));
    render(<AddressBook />);

    const retry = await screen.findByRole('button', { name: 'Повторить' });
    addressBookAPI.search.mockResolvedValueOnce(samplePayload);
    fireEvent.click(retry);

    expect(await screen.findByTestId('address-book-entry-list')).toHaveTextContent('Ivanov Ivan Ivanovich');
    expect(screen.queryByTestId('address-book-entry-list-error')).not.toBeInTheDocument();
  });

  it('keeps the alert for search errors that leave old results on screen', async () => {
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    addressBookAPI.search.mockRejectedValueOnce(new Error('search down'));
    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), { target: { value: 'ivanov' } });

    expect(await screen.findByText('Не удалось загрузить адресную книгу.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(screen.queryByTestId('address-book-entry-list-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('address-book-entry-list')).toHaveTextContent('Ivanov Ivan Ivanovich');
  });

  it('shows a retry action when the sync fails', async () => {
    authUser = { role: 'admin' };
    addressBookAPI.sync.mockRejectedValueOnce(new Error('sync down'));
    render(<AddressBook />);

    fireEvent.click(await screen.findByRole('button', { name: /Обновить/i }));

    expect(await screen.findByText('Не удалось обновить адресную книгу из 1С.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('keeps the selected employee after a sync refresh that reorders the list', async () => {
    authUser = { role: 'admin' };
    const alpha = { full_name: 'Alpha One', department: 'Dept A', position: 'Engineer', work_phones: [], work_emails: [] };
    const bravo = { full_name: 'Bravo Two', department: 'Dept B', position: 'Manager', work_phones: [], work_emails: [] };
    const charlie = { full_name: 'Charlie Three', department: 'Dept C', position: 'Lead', work_phones: [], work_emails: [] };
    addressBookAPI.search.mockResolvedValueOnce({ ...samplePayload, items: [alpha, bravo, charlie], total: 3 });
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId('address-book-entry-row-Bravo Two|Dept B|Manager|1'));
    expect(screen.getByTestId('address-book-entry-detail')).toHaveTextContent('Bravo Two');

    addressBookAPI.search.mockResolvedValueOnce({ ...samplePayload, items: [charlie, alpha, bravo], total: 3 });
    fireEvent.click(screen.getByRole('button', { name: /Обновить/i }));

    await waitFor(() => {
      expect(screen.getByTestId('address-book-entry-row-Bravo Two|Dept B|Manager|2')).toBeInTheDocument();
    });
    expect(screen.getByTestId('address-book-entry-detail')).toHaveTextContent('Bravo Two');
  });

  it('keeps the auto-selected first employee after sync reorders the list', async () => {
    authUser = { role: 'admin' };
    const alpha = { full_name: 'Alpha One', department: 'Dept A', position: 'Engineer', work_phones: [], work_emails: [] };
    const bravo = { full_name: 'Bravo Two', department: 'Dept B', position: 'Manager', work_phones: [], work_emails: [] };
    const charlie = { full_name: 'Charlie Three', department: 'Dept C', position: 'Lead', work_phones: [], work_emails: [] };
    addressBookAPI.search
      .mockResolvedValueOnce({ ...samplePayload, items: [alpha, bravo, charlie], total: 3 })
      .mockResolvedValueOnce({ ...samplePayload, items: [charlie, alpha, bravo], total: 3 });
    render(<AddressBook />);

    await waitFor(() => {
      expect(screen.getByTestId('address-book-entry-detail')).toHaveTextContent('Alpha One');
    });
    fireEvent.click(screen.getByRole('button', { name: /Обновить/i }));

    await waitFor(() => {
      expect(screen.getByTestId('address-book-entry-detail')).toHaveTextContent('Alpha One');
    });
    expect(screen.getByTestId('address-book-entry-row-Alpha One|Dept A|Engineer|1')).toHaveAttribute('aria-current', 'true');
  });

  it('keeps the mobile sheet open with the original contact when a search response arrives', async () => {
    setMatchMedia(isMobileQuery);
    const alpha = { full_name: 'Alpha One', department: 'Dept A', position: 'Engineer', work_phones: [], work_emails: [] };
    const bravo = { full_name: 'Bravo Two', department: 'Dept B', position: 'Manager', work_phones: [], work_emails: [] };
    addressBookAPI.search.mockResolvedValue({ ...samplePayload, items: [alpha, bravo], total: 2 });
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId('address-book-entry-row-Alpha One|Dept A|Engineer|0'));
    expect(await screen.findByTestId('address-book-entry-sheet')).toHaveTextContent('Alpha One');

    addressBookAPI.search.mockResolvedValueOnce({ ...samplePayload, items: [bravo], total: 1 });
    fireEvent.change(screen.getByTestId('address-book-search-input'), { target: { value: 'bravo' } });

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({ q: 'bravo', limit: 50, offset: 0, dismissed: false });
    });

    expect(screen.getByTestId('address-book-entry-sheet')).toHaveTextContent('Alpha One');
    expect(screen.getByTestId('address-book-entry-list')).toHaveTextContent('Bravo Two');
  });

  it('hides HUB compose actions in the mobile sheet without mail.access', async () => {
    setMatchMedia(isMobileQuery);
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    const sheet = await screen.findByTestId('address-book-entry-sheet');

    expect(within(sheet).queryByLabelText(/Новое письмо в HUB/)).not.toBeInTheDocument();
    expect(within(sheet).getByLabelText('Внешняя почта ivanov@zsgp.ru'))
      .toHaveAttribute('href', 'mailto:ivanov@zsgp.ru');
  });

  it('shows HUB compose actions in the mobile sheet with mail.access', async () => {
    setMatchMedia(isMobileQuery);
    hasPermissionMock.mockImplementation((permission) => permission === 'mail.access');
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    const sheet = await screen.findByTestId('address-book-entry-sheet');

    expect(within(sheet).getAllByLabelText('Новое письмо в HUB ivanov@zsgp.ru').length)
      .toBeGreaterThan(0);
  });

  it('hides HUB compose actions in the tablet drawer without mail.access', async () => {
    setMatchMedia(isTabletQuery);
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    const drawer = await screen.findByTestId('address-book-entry-drawer');

    expect(within(drawer).queryByLabelText(/Новое письмо в HUB/)).not.toBeInTheDocument();
    expect(within(drawer).getByLabelText('Внешняя почта ivanov@zsgp.ru'))
      .toHaveAttribute('href', 'mailto:ivanov@zsgp.ru');
  });

  it('shows HUB compose actions in the tablet drawer with mail.access', async () => {
    setMatchMedia(isTabletQuery);
    hasPermissionMock.mockImplementation((permission) => permission === 'mail.access');
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    const drawer = await screen.findByTestId('address-book-entry-drawer');

    expect(within(drawer).getAllByLabelText('Новое письмо в HUB ivanov@zsgp.ru').length)
      .toBeGreaterThan(0);
  });

  it('shows the chat quick action in mobile rows when chat is allowed', async () => {
    setMatchMedia(isMobileQuery);
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    render(<AddressBook />);

    const chatButton = await screen.findByTestId(
      'address-book-chat-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    );
    fireEvent.click(chatButton);

    await waitFor(() => {
      expect(openAddressBookChat).toHaveBeenCalledWith(expect.objectContaining({
        entry: expect.objectContaining({ full_name: 'Ivanov Ivan Ivanovich' }),
      }));
    });
  });

  it('keeps chat out of desktop rows while the detail panel offers it', async () => {
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    render(<AddressBook />);

    await screen.findByTestId('address-book-entry-list');
    expect(screen.queryByTestId(
      'address-book-chat-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    )).not.toBeInTheDocument();
    expect(await screen.findByTestId('address-book-chat-detail')).toBeInTheDocument();
  });

  it('hides the chat quick action in mobile rows without chat permissions', async () => {
    setMatchMedia(isMobileQuery);
    render(<AddressBook />);

    await screen.findByTestId('address-book-entry-list');
    expect(screen.queryByTestId(
      'address-book-chat-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    )).not.toBeInTheDocument();
  });

  it('hides the chat quick action in dismissed rows on mobile', async () => {
    setMatchMedia(isMobileQuery);
    hasPermissionMock.mockImplementation((permission) => (
      ['address_book.dismissed.read', 'chat.read', 'chat.write'].includes(permission)
    ));
    addressBookAPI.search.mockResolvedValue({
      ...samplePayload,
      items: [{ ...samplePayload.items[0], dismissal_date: '2024-01-31' }],
      total: 1,
    });
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId('address-book-tab-dismissed'));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({
        q: '',
        limit: 50,
        offset: 0,
        dismissed: true,
      });
    });
    await screen.findByTestId('address-book-entry-list');

    expect(screen.queryByTestId(
      'address-book-chat-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    )).not.toBeInTheDocument();
  });

  it('marks the row chat button busy while the chat is opening', async () => {
    setMatchMedia(isMobileQuery);
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    let resolveChat;
    openAddressBookChat.mockImplementation(() => new Promise((resolve) => { resolveChat = resolve; }));
    render(<AddressBook />);

    const chatButton = await screen.findByTestId(
      'address-book-chat-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    );
    fireEvent.click(chatButton);

    await waitFor(() => expect(chatButton).toBeDisabled());
    await act(async () => { resolveChat(); });
    await waitFor(() => expect(chatButton).not.toBeDisabled());
  });

  it('warns with the server detail when the chat resolves to 404', async () => {
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    openAddressBookChat.mockRejectedValue({
      response: { status: 404, data: { detail: 'Сотрудник найден дважды в чате' } },
    });
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId('address-book-chat-detail'));
    await waitFor(() => {
      expect(notifyWarningMock).toHaveBeenCalledWith('Сотрудник найден дважды в чате', expect.anything());
    });
    expect(notifyApiErrorMock).not.toHaveBeenCalled();
  });

  it('warns with the default text when the chat 404 has no detail', async () => {
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    openAddressBookChat.mockRejectedValue({ response: { status: 404, data: {} } });
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId('address-book-chat-detail'));
    await waitFor(() => {
      expect(notifyWarningMock).toHaveBeenCalledWith(
        'Сотрудник не найден в HUB-чате. Возможно, у него нет учётной записи.',
        expect.anything(),
      );
    });
  });

  it('routes non-404 chat errors through notifyApiError', async () => {
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    const failure = { response: { status: 500, data: { detail: 'boom' } } };
    openAddressBookChat.mockRejectedValue(failure);
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId('address-book-chat-detail'));
    await waitFor(() => {
      expect(notifyApiErrorMock).toHaveBeenCalledWith(failure, 'Не удалось открыть корпоративный чат.', expect.anything());
    });
  });

  it('loads filter options lazily and sends department/city to search', async () => {
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');
    expect(addressBookAPI.getFilters).not.toHaveBeenCalled();

    const departmentInput = screen.getByTestId('address-book-filter-department');
    fireEvent.mouseDown(departmentInput);
    await waitFor(() => expect(addressBookAPI.getFilters).toHaveBeenCalledWith({ dismissed: false }));

    fireEvent.click(await screen.findByRole('option', { name: /Monitoring department/ }));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith(expect.objectContaining({
        department: 'Monitoring department',
      }));
    });

    const chips = screen.getByTestId('address-book-active-filters');
    expect(chips).toHaveTextContent('Подразделение: Monitoring department');

    const cityInput = screen.getByTestId('address-book-filter-city');
    fireEvent.mouseDown(cityInput.parentElement.querySelector('.MuiSelect-select'));
    fireEvent.click(await screen.findByRole('option', { name: 'Tyumen' }));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith(expect.objectContaining({
        department: 'Monitoring department',
        city: 'Tyumen',
      }));
    });
    expect(chips).toHaveTextContent('Город: Tyumen');
  });

  it('resets filters when switching to the dismissed tab', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'address_book.dismissed.read');
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.mouseDown(screen.getByTestId('address-book-filter-department'));
    fireEvent.click(await screen.findByRole('option', { name: /Monitoring department/ }));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith(expect.objectContaining({
        department: 'Monitoring department',
      }));
    });

    fireEvent.click(screen.getByTestId('address-book-tab-dismissed'));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({
        q: '',
        limit: 50,
        offset: 0,
        dismissed: true,
      });
    });
    expect(screen.queryByTestId('address-book-active-filters')).not.toBeInTheDocument();
  });

  it('opens the mobile filters dialog from the toolbar button', async () => {
    setMatchMedia(isMobileQuery);
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.click(screen.getByTestId('address-book-filters-button'));
    const dialog = await screen.findByTestId('address-book-filters-dialog');
    expect(within(dialog).getByTestId('address-book-filter-department')).toBeInTheDocument();
    expect(within(dialog).getByTestId('address-book-filter-city')).toBeInTheDocument();
    await waitFor(() => expect(addressBookAPI.getFilters).toHaveBeenCalled());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Готово' }));
    await waitFor(() => {
      expect(screen.queryByTestId('address-book-filters-dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps working when the filter directory fails', async () => {
    addressBookAPI.getFilters.mockRejectedValue(new Error('filters down'));
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.mouseDown(screen.getByTestId('address-book-filter-department'));
    await waitFor(() => expect(addressBookAPI.getFilters).toHaveBeenCalled());
    expect(screen.getByTestId('address-book-entry-list')).toBeInTheDocument();
  });

  it('focuses the search input on slash and ignores it while typing', async () => {
    render(<AddressBook />);
    const searchInput = await screen.findByTestId('address-book-search-input');
    expect(searchInput).not.toHaveFocus();

    fireEvent.keyDown(document.body, { key: '/' });
    expect(searchInput).toHaveFocus();

    const departmentInput = screen.getByTestId('address-book-filter-department');
    departmentInput.focus();
    fireEvent.keyDown(departmentInput, { key: '/' });
    expect(searchInput).not.toHaveFocus();
    expect(departmentInput).toHaveFocus();
  });

  it('clears the query on Escape and blurs when already empty', async () => {
    render(<AddressBook />);
    const searchInput = await screen.findByTestId('address-book-search-input');

    fireEvent.change(searchInput, { target: { value: 'ivanov' } });
    fireEvent.keyDown(searchInput, { key: 'Escape' });
    await waitFor(() => expect(searchInput).toHaveValue(''));

    searchInput.focus();
    fireEvent.keyDown(searchInput, { key: 'Escape' });
    expect(searchInput).not.toHaveFocus();
  });

  it('shows a skeleton while the first page loads', async () => {
    let resolveSearch;
    addressBookAPI.search.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve; }));
    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-entry-list-skeleton')).toBeInTheDocument();
    await act(async () => { resolveSearch(samplePayload); });
    await screen.findByTestId('address-book-entry-list');
  });

  it('renders the desktop copy-number action and downloads a vCard', async () => {
    const createObjectURL = vi.fn(() => 'blob:vcf');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    // jsdom cannot navigate to blob: URLs — silence the anchor click.
    const clickStub = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<AddressBook />);

    const detail = await screen.findByTestId('address-book-entry-detail');
    expect(within(detail).getByTestId('address-book-copy-number')).toBeInTheDocument();

    fireEvent.click(within(detail).getByTestId('address-book-save-contact'));
    await waitFor(() => {
      expect(createObjectURL).toHaveBeenCalled();
      expect(notifySuccessMock).toHaveBeenCalledWith(
        'Контакт сохранён в файл .vcf',
        expect.anything(),
      );
    });
    expect(revokeObjectURL).toHaveBeenCalled();
    clickStub.mockRestore();
  });

  it('hides the vCard action for dismissed employees', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'address_book.dismissed.read');
    addressBookAPI.search.mockImplementation((_args) => Promise.resolve({
      ...samplePayload,
      items: [{ ...samplePayload.items[0], dismissal_date: '2024-01-31' }],
    }));
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.click(screen.getByTestId('address-book-tab-dismissed'));
    await screen.findByTestId('address-book-dismissed-chip');
    const detail = screen.getByTestId('address-book-entry-detail');
    expect(within(detail).queryByTestId('address-book-save-contact')).not.toBeInTheDocument();
  });

  it('renders a sticky footer with primary actions inside the mobile sheet', async () => {
    setMatchMedia(isMobileQuery);
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    const footer = await screen.findByTestId('address-book-sheet-footer');
    expect(within(footer).getByLabelText(/Позвонить 83452384202/)).toBeInTheDocument();
    expect(within(footer).getByTestId('address-book-sheet-footer-chat')).toBeInTheDocument();
  });

  it('adds a selected employee to recents and shows the modes row', async () => {
    const codedItem = { ...samplePayload.items[0], employee_code: 'E100' };
    addressBookAPI.search.mockResolvedValue({ ...samplePayload, items: [codedItem] });
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.click(screen.getByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    await waitFor(() => {
      expect(window.localStorage.getItem('hubit.addressBook.recent.anon')).toBe('["E100"]');
    });
    const modes = await screen.findByTestId('address-book-list-modes');
    expect(modes).toHaveTextContent('Недавние (1)');
    expect(screen.getByTestId('address-book-mode-all')).toBeInTheDocument();
  });

  it('shows seeded counts, toggles the detail star and clears recents', async () => {
    const codedItem = { ...samplePayload.items[0], employee_code: 'E1' };
    window.localStorage.setItem('hubit.addressBook.favorites.anon', '["E1"]');
    window.localStorage.setItem('hubit.addressBook.recent.anon', '["E1"]');
    addressBookAPI.search.mockResolvedValue({ ...samplePayload, items: [codedItem] });
    render(<AddressBook />);

    const modes = await screen.findByTestId('address-book-list-modes');
    expect(modes).toHaveTextContent('Избранные (1)');
    expect(modes).toHaveTextContent('Недавние (1)');
    // "Очистить недавние" is only visible inside the recent mode.
    expect(screen.queryByTestId('address-book-clear-recent')).not.toBeInTheDocument();

    const star = await screen.findByTestId('address-book-favorite-toggle');
    expect(star).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(star);
    await waitFor(() => {
      expect(window.localStorage.getItem('hubit.addressBook.favorites.anon')).toBe('[]');
    });
    // The favorites counter updates immediately; its segment hides at N=0.
    await waitFor(() => {
      expect(screen.queryByTestId('address-book-mode-favorites')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('address-book-mode-recent')).toHaveTextContent('Недавние (1)');

    fireEvent.click(screen.getByTestId('address-book-mode-recent'));
    fireEvent.click(await screen.findByTestId('address-book-clear-recent'));
    await waitFor(() => {
      expect(window.localStorage.getItem('hubit.addressBook.recent.anon')).toBe('[]');
    });
    // After clearing, the mode falls back to "Все" and the row disappears.
    await waitFor(() => {
      expect(screen.queryByTestId('address-book-list-modes')).not.toBeInTheDocument();
    });
  });

  it('hides the modes row when nothing is saved', async () => {
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');
    expect(screen.queryByTestId('address-book-list-modes')).not.toBeInTheDocument();
  });

  it('favorites mode searches with employee_codes and keeps active filters', async () => {
    window.localStorage.setItem('hubit.addressBook.favorites.anon', '["E1","E2"]');
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    const citySelect = screen.getByTestId('address-book-filter-city')
      .parentElement.querySelector('.MuiSelect-select');
    fireEvent.mouseDown(citySelect);
    fireEvent.click(await screen.findByRole('option', { name: 'Tyumen' }));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith(expect.objectContaining({
        city: 'Tyumen',
      }));
    });

    addressBookAPI.search.mockClear();
    fireEvent.click(screen.getByTestId('address-book-mode-favorites'));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledWith(expect.objectContaining({
        city: 'Tyumen',
        employeeCodes: ['E1', 'E2'],
      }));
    });
  });

  it('orders "Недавние" by recency and does not refetch on card open', async () => {
    const alpha = { ...samplePayload.items[0], employee_code: 'EA', full_name: 'Alpha One' };
    const bravo = { ...samplePayload.items[0], employee_code: 'EB', full_name: 'Bravo Two' };
    window.localStorage.setItem('hubit.addressBook.recent.anon', '["EB","EA"]');
    // The backend answers alphabetically; the client must reorder by recency.
    addressBookAPI.search.mockImplementation((args) => Promise.resolve(
      args.employeeCodes
        ? { ...samplePayload, items: [alpha, bravo], total: 2 }
        : samplePayload,
    ));
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.click(screen.getByTestId('address-book-mode-recent'));
    await waitFor(() => {
      const rows = document.querySelectorAll('[data-testid^="address-book-entry-row"]');
      expect(rows.length).toBe(2);
      expect(rows[0]).toHaveTextContent('Bravo Two');
      expect(rows[1]).toHaveTextContent('Alpha One');
    });

    const callsBefore = addressBookAPI.search.mock.calls.length;
    fireEvent.click(document.querySelectorAll('[data-testid^="address-book-entry-row"]')[0]);
    await waitFor(() => {
      expect(window.localStorage.getItem('hubit.addressBook.recent.anon')).toBe('["EB","EA"]');
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });
    // pushRecentEmployee must not trigger a new request or reshuffle the list.
    expect(addressBookAPI.search.mock.calls.length).toBe(callsBefore);
    const rowsAfter = document.querySelectorAll('[data-testid^="address-book-entry-row"]');
    expect(rowsAfter[0]).toHaveTextContent('Bravo Two');
  });

  it('keeps an unstarred row until the favorites mode is re-entered', async () => {
    const alpha = { ...samplePayload.items[0], employee_code: 'E1', full_name: 'Alpha One' };
    const bravo = { ...samplePayload.items[0], employee_code: 'E2', full_name: 'Bravo Two' };
    window.localStorage.setItem('hubit.addressBook.favorites.anon', '["E1","E2"]');
    addressBookAPI.search.mockImplementation((args) => Promise.resolve(
      args.employeeCodes
        ? { ...samplePayload, items: [alpha, bravo], total: 2 }
        : samplePayload,
    ));
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.click(screen.getByTestId('address-book-mode-favorites'));
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="address-book-entry-row"]').length).toBe(2);
    });

    const star = await screen.findByTestId('address-book-favorite-toggle');
    fireEvent.click(star);
    await waitFor(() => {
      expect(screen.getByTestId('address-book-mode-favorites')).toHaveTextContent('Избранные (1)');
    });
    // The row stays until the mode is re-entered — no silent refetch.
    expect(document.querySelectorAll('[data-testid^="address-book-entry-row"]').length).toBe(2);
  });

  it('toggles aria-pressed and is operable with the keyboard', async () => {
    window.localStorage.setItem('hubit.addressBook.favorites.anon', '["E1"]');
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    const group = screen.getByRole('group', { name: 'Показать' });
    const all = within(group).getByTestId('address-book-mode-all');
    const favorites = within(group).getByTestId('address-book-mode-favorites');
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(favorites).toHaveAttribute('aria-pressed', 'false');

    favorites.focus();
    expect(document.activeElement).toBe(favorites);
    fireEvent.click(favorites);
    await waitFor(() => expect(favorites).toHaveAttribute('aria-pressed', 'true'));
    expect(all).toHaveAttribute('aria-pressed', 'false');
  });

  it('resets the mode and hides the row on the dismissed tab', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'address_book.dismissed.read');
    window.localStorage.setItem('hubit.addressBook.recent.anon', '["E1"]');
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    const recent = screen.getByTestId('address-book-mode-recent');
    fireEvent.click(recent);
    await waitFor(() => expect(recent).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(screen.getByTestId('address-book-tab-dismissed'));
    await waitFor(() => {
      expect(screen.queryByTestId('address-book-list-modes')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('address-book-tab-active'));
    const modes = await screen.findByTestId('address-book-list-modes');
    expect(within(modes).getByTestId('address-book-mode-all')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a mode-specific empty state with a hint for an empty mode', async () => {
    window.localStorage.setItem('hubit.addressBook.favorites.anon', '["GONE"]');
    addressBookAPI.search.mockImplementation((args) => Promise.resolve(
      args.employeeCodes
        ? { ...samplePayload, items: [], total: 0 }
        : samplePayload,
    ));
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.click(screen.getByTestId('address-book-mode-favorites'));
    const emptyState = await screen.findByTestId('address-book-entry-list-empty');
    expect(emptyState).toHaveTextContent('В избранном пока никого нет');
    expect(emptyState).toHaveTextContent('Нажмите ★');
  });

  it('R1: loads filter options when the city select is opened first', async () => {
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');
    expect(addressBookAPI.getFilters).not.toHaveBeenCalled();

    const citySelect = screen.getByTestId('address-book-filter-city')
      .parentElement.querySelector('.MuiSelect-select');
    fireEvent.mouseDown(citySelect);
    await waitFor(() => {
      expect(addressBookAPI.getFilters).toHaveBeenCalledWith({ dismissed: false });
    });

    const tyumen = await screen.findByRole('option', { name: 'Tyumen' });
    fireEvent.click(tyumen);
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith(expect.objectContaining({
        city: 'Tyumen',
      }));
    });
  });

  it('R1: loads filter options on city select focus and retries after errors', async () => {
    addressBookAPI.getFilters.mockRejectedValueOnce(new Error('filters down'));
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    const citySelect = screen.getByTestId('address-book-filter-city')
      .parentElement.querySelector('.MuiSelect-select');
    fireEvent.focus(citySelect);
    await waitFor(() => expect(addressBookAPI.getFilters).toHaveBeenCalledTimes(1));

    // First attempt failed → nothing cached → next open retries.
    fireEvent.mouseDown(citySelect);
    await waitFor(() => expect(addressBookAPI.getFilters).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('option', { name: 'Tyumen' })).toBeInTheDocument();
  });

  it('R1: mobile filter dialog applies the city filter to search', async () => {
    setMatchMedia(isMobileQuery);
    render(<AddressBook />);
    await screen.findByTestId('address-book-entry-list');

    fireEvent.click(screen.getByTestId('address-book-filters-button'));
    const dialog = await screen.findByTestId('address-book-filters-dialog');
    const citySelect = within(dialog).getByTestId('address-book-filter-city')
      .parentElement.querySelector('.MuiSelect-select');
    fireEvent.mouseDown(citySelect);
    fireEvent.click(await screen.findByRole('option', { name: 'Tyumen' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Готово' }));
    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith(expect.objectContaining({
        city: 'Tyumen',
      }));
    });
  });

  it('R5: the mobile sheet keeps exactly one call/chat action in the footer', async () => {
    setMatchMedia(isMobileQuery);
    hasPermissionMock.mockImplementation((permission) => ['chat.read', 'chat.write'].includes(permission));
    render(<AddressBook />);

    fireEvent.click(await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    ));
    const sheet = await screen.findByTestId('address-book-entry-sheet');

    const footer = within(sheet).getByTestId('address-book-sheet-footer');
    expect(within(footer).getAllByLabelText(/^Позвонить/)).toHaveLength(1);
    expect(within(footer).getAllByLabelText(/^Написать в чат/)).toHaveLength(1);

    // The header action block keeps secondary actions only.
    const headerActions = within(sheet).getByTestId('address-book-detail-actions');
    expect(within(headerActions).queryByLabelText(/^Позвонить/)).not.toBeInTheDocument();
    expect(within(headerActions).queryByLabelText(/^Написать в чат/)).not.toBeInTheDocument();
    expect(within(headerActions).getByLabelText(/^Открыть Telegram/)).toBeInTheDocument();
    expect(within(headerActions).getByTestId('address-book-save-contact')).toBeInTheDocument();
  });
});
