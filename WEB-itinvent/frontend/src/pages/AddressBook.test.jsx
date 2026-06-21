import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddressBook from './AddressBook';
import { addressBookAPI } from '../api/addressBook';

vi.mock('../api/addressBook', () => ({
  addressBookAPI: {
    search: vi.fn(),
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

describe('AddressBook page', () => {
  beforeEach(() => {
    setMatchMedia(false);
    authUser = { role: 'viewer' };
    addressBookAPI.search.mockReset();
    addressBookAPI.getStatus.mockReset();
    addressBookAPI.sync.mockReset();
    addressBookAPI.search.mockResolvedValue(samplePayload);
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
    expect(screen.getAllByText('Ivanov Ivan Ivanovich').length).toBeGreaterThan(0);
    expect(screen.getByText('Рабочий телефон')).toBeInTheDocument();
    expect(screen.getAllByText('83452384202').length).toBeGreaterThan(0);
    expect(screen.getByText('Мобильный телефон')).toBeInTheDocument();
    expect(screen.getAllByText('89312250556').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ivanov@zsgp.ru').length).toBeGreaterThan(0);
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

  it('renders mobile compact list with tel quick action', async () => {
    setMatchMedia(isMobileQuery);

    render(<AddressBook />);

    expect(await screen.findByTestId('address-book-mobile-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('address-book-entry-list')).toBeInTheDocument();
    expect(screen.queryByTestId('address-book-entry-detail')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Позвонить 89312250556')).toHaveAttribute('href', 'tel:+79312250556');
  });

  it('opens bottom sheet when tapping a row on mobile', async () => {
    setMatchMedia(isMobileQuery);

    render(<AddressBook />);

    const row = await screen.findByTestId(
      'address-book-entry-row-Ivanov Ivan Ivanovich|Monitoring department|Lead specialist|0',
    );
    fireEvent.click(row);

    expect(await screen.findByTestId('address-book-entry-sheet')).toBeInTheDocument();
    expect(screen.getAllByText('Ivanov Ivan Ivanovich').length).toBeGreaterThan(1);
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
    render(<AddressBook />);

    await screen.findByText('ivanov@zsgp.ru');
    fireEvent.click(screen.getAllByLabelText('Написать в HUB ivanov@zsgp.ru')[0]);

    expect(navigateMock).toHaveBeenCalledWith('/mail?folder=inbox&compose_to=ivanov%40zsgp.ru');
  });

  it('keeps external mailto action for employee email in detail panel', async () => {
    render(<AddressBook />);

    await screen.findByText('ivanov@zsgp.ru');
    expect(screen.getByLabelText('Открыть внешнюю почту ivanov@zsgp.ru')).toHaveAttribute('href', 'mailto:ivanov@zsgp.ru');
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
      expect(addressBookAPI.search).toHaveBeenCalledWith({ q: '', limit: 50 });
    });

    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
      target: { value: 'ivanov' },
    });

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledWith({ q: 'ivanov', limit: 50 });
    });
  });

  it('clears search from the input button', async () => {
    render(<AddressBook />);

    fireEvent.change(screen.getByPlaceholderText(searchPlaceholder), {
      target: { value: 'ivanov' },
    });

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenCalledWith({ q: 'ivanov', limit: 50 });
    });

    fireEvent.click(screen.getByLabelText('Очистить поиск'));

    await waitFor(() => {
      expect(addressBookAPI.search).toHaveBeenLastCalledWith({ q: '', limit: 50 });
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
});
