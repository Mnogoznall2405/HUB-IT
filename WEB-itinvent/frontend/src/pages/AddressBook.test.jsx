import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AddressBook from './AddressBook';
import { addressBookAPI } from '../api/client';

vi.mock('../api/client', () => ({
  addressBookAPI: {
    search: vi.fn(),
    getStatus: vi.fn(),
    sync: vi.fn(),
  },
}));

let authUser = { role: 'viewer' };
const notifySuccessMock = vi.fn();
const notifyWarningMock = vi.fn();

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authUser,
  }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: notifySuccessMock,
    notifyWarning: notifyWarningMock,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

const searchPlaceholder = 'ФИО, должность, подразделение, город или телефон';

const samplePayload = {
  items: [
    {
      full_name: 'Ivanov Ivan Ivanovich',
      department: 'Monitoring department',
      department_location: 'Tyumen',
      position: 'Lead specialist',
      work_phones: [{ kind: 'Рабочий телефон', value: '83452384202', normalized: '73452384202' }],
      personal_phones: [{ kind: 'Мобильный телефон', value: '89312250556', normalized: '79312250556' }],
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders search results with work and personal phone actions', async () => {
    render(<AddressBook />);

    expect(await screen.findByText('Ivanov Ivan Ivanovich')).toBeInTheDocument();
    expect(screen.getByText('Monitoring department')).toBeInTheDocument();
    expect(screen.getByText('Lead specialist')).toBeInTheDocument();
    expect(screen.getByText('Рабочий телефон')).toBeInTheDocument();
    expect(screen.getByText('83452384202')).toBeInTheDocument();
    expect(screen.getByText('Мобильный телефон')).toBeInTheDocument();
    expect(screen.getByText('89312250556')).toBeInTheDocument();
  });

  it('does not render desktop phone rows as tel links or call actions', async () => {
    render(<AddressBook />);

    const workPhone = await screen.findByText('83452384202');
    const personalPhone = screen.getByText('89312250556');

    expect(workPhone.closest('a')).toBeNull();
    expect(personalPhone.closest('a')).toBeNull();
    expect(screen.queryByLabelText('Позвонить 83452384202')).not.toBeInTheDocument();
  });

  it('renders mobile phone call actions with tel links', async () => {
    setMatchMedia((query) => String(query).includes('max-width'));

    render(<AddressBook />);

    await screen.findByText('83452384202');
    expect(screen.getByLabelText('Позвонить 83452384202')).toHaveAttribute('href', 'tel:+73452384202');
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

  it('shows manual sync action for admin users', async () => {
    authUser = { role: 'admin' };
    render(<AddressBook />);

    const button = await screen.findByRole('button', { name: /Обновить/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(addressBookAPI.sync).toHaveBeenCalledTimes(1);
    });
  });
});
