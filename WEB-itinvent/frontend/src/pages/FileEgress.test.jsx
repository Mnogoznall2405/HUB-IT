import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileEgress from './FileEgress';
import { fsEgressAPI } from '../api/fsEgress';

vi.mock('../api/fsEgress', () => {
  const api = {
    listEvents: vi.fn(),
    listDlpHosts: vi.fn(),
    getDlpSummary: vi.fn(),
    getDlpAttention: vi.fn(),
    getDlpActivity: vi.fn(),
    listTelegramChats: vi.fn(),
    getTelegramReport: vi.fn(),
    getTelegramMedia: vi.fn(),
    listBrowserHosts: vi.fn(),
    listBrowserDays: vi.fn(),
    listBrowserVisits: vi.fn(),
    getBrowserMedia: vi.fn(),
    listMaxChats: vi.fn(),
    getMaxMedia: vi.fn(),
  };
  return { fsEgressAPI: api, default: api };
});

function LocationProbe() {
  const [params] = useSearchParams();
  return <output data-testid="location-probe">{params.toString()}</output>;
}

function renderPage(initialEntries = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <FileEgress />
      <LocationProbe />
    </MemoryRouter>,
  );
}

vi.mock('../components/layout/MainLayout', () => ({ default: ({ children }) => children }));
vi.mock('../components/layout/PageShell', () => ({ default: ({ children }) => children }));
vi.mock('../components/layout/PageTopBar', () => ({
  default: ({ title, tabs, actions, children }) => (
    <div data-testid="page-top-bar">
      <h1>{title}</h1>
      {tabs}
      {children}
      {actions}
    </div>
  ),
}));

const HOSTS = [
  {
    computer_name: 'PC-01',
    windows_user: 'ivanov',
    user_login: 'ivanov',
    user_full_name: 'Иванов И.И.',
    branch_no: 1,
    branch_name: 'Тюмень',
    file_events: 24,
    deleted_events: 14,
    service_files: 4,
    usb_events: 2,
    telegram_events: 6,
    max_events: 1,
    visits: 120,
    last_ts: 1700000000,
  },
  {
    computer_name: 'PC-02',
    windows_user: 'petrov',
    user_login: 'petrov',
    user_full_name: 'Петров П.П.',
    branch_no: 1,
    branch_name: 'Тюмень',
    file_events: 4,
    deleted_events: 3,
    service_files: 0,
    usb_events: 1,
    telegram_events: 0,
    max_events: 0,
    visits: 9,
    last_ts: 1699990000,
  },
  {
    computer_name: 'PC-77',
    windows_user: 'sidorov',
    user_login: '',
    user_full_name: '',
    branch_no: null,
    branch_name: null,
    file_events: 1,
    deleted_events: 1,
    service_files: 0,
    usb_events: 0,
    telegram_events: 0,
    max_events: 0,
    visits: 0,
    last_ts: 1699980000,
  },
];

const SUMMARY = {
  hosts_total: 3,
  hosts_active_today: 2,
  visits_today: 40,
  file_events_today: 7,
  categories_today: { work: 25, shopping: 10, other: 5 },
  category_meta: {
    work: { label: 'Работа', color: 'success' },
    shopping: { label: 'Покупки', color: 'warning' },
    other: { label: 'Прочее', color: 'default' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  fsEgressAPI.listDlpHosts.mockResolvedValue({ data: { hosts: HOSTS } });
  fsEgressAPI.getDlpSummary.mockResolvedValue({ data: { summary: SUMMARY } });
  fsEgressAPI.getDlpAttention.mockResolvedValue({ data: { hosts: [] } });
  fsEgressAPI.getDlpActivity.mockResolvedValue({
    data: { buckets: [], summary: {}, apps_top: [] },
  });
  fsEgressAPI.listTelegramChats.mockResolvedValue({ data: { chats: [] } });
  fsEgressAPI.listMaxChats.mockResolvedValue({ data: { chats: [] } });
  fsEgressAPI.listEvents.mockResolvedValue({ data: { items: [], noise_hidden: 0 } });
  fsEgressAPI.listBrowserDays.mockResolvedValue({ data: { days: [] } });
  fsEgressAPI.listBrowserVisits.mockResolvedValue({ data: { items: [], total: 0 } });
});

describe('FileEgress DLP page', () => {
  it('loads server host stats and groups hosts by branch', async () => {
    renderPage();

    await waitFor(() => expect(fsEgressAPI.listDlpHosts).toHaveBeenCalledTimes(1));
    expect(fsEgressAPI.getDlpSummary).toHaveBeenCalledTimes(1);
    // The page no longer pulls a global event page to count hosts client-side.
    expect(fsEgressAPI.listEvents).not.toHaveBeenCalled();
    expect(fsEgressAPI.listBrowserHosts).not.toHaveBeenCalled();

    expect(await screen.findByText('Тюмень')).toBeInTheDocument();
    expect(screen.getByText('Без филиала')).toBeInTheDocument();
    expect(screen.getByText('PC-01')).toBeInTheDocument();
    expect(screen.getByText('PC-02')).toBeInTheDocument();
    expect(screen.getByText('PC-77')).toBeInTheDocument();
    // Deleted-file counter from server stats (14 deleted − 4 service names).
    expect(screen.getByText('10')).toBeInTheDocument();
    // Summary cards.
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('opens a host, fetches grouped file events and per-host chats', async () => {
    fsEgressAPI.listEvents.mockResolvedValue({
      data: {
        items: [
          {
            id: 'g1',
            merged: true,
            count: 3,
            first_ts: 1700000000,
            last_ts: 1700001000,
            ts: 1700001000,
            channel: 'usb',
            file_name: 'report.docx',
            dest_path: 'E:\\docs',
            windows_user: 'ivanov',
            size: 2048,
            service: false,
            details: {},
          },
        ],
        noise_hidden: 5,
        total: 1,
      },
    });
    renderPage();

    const openButtons = await screen.findAllByRole('button', { name: 'Открыть' });
    fireEvent.click(openButtons[0]);

    await waitFor(() =>
      expect(fsEgressAPI.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          computerName: 'PC-01',
          channel: '',
          group: 1,
          includeNoise: 0,
        }),
      ),
    );
    expect(fsEgressAPI.listTelegramChats).toHaveBeenCalledWith(
      expect.objectContaining({ computerName: 'PC-01' }),
    );
    expect(fsEgressAPI.listMaxChats).toHaveBeenCalledWith(
      expect.objectContaining({ computerName: 'PC-01' }),
    );

    expect(await screen.findByText('report.docx')).toBeInTheDocument();
    expect(screen.getByText('×3')).toBeInTheDocument();
    expect(screen.getByText('Скрыто служебных: 5')).toBeInTheDocument();
    expect(screen.getByText(/Иванов И\.И\./)).toBeInTheDocument();
  });

  it('requests merged browser visits and renders display category', async () => {
    fsEgressAPI.listBrowserDays.mockResolvedValue({
      data: {
        days: [
          {
            day: '2026-01-10',
            visits: 4,
            work: 0,
            entertainment: 0,
            other: 4,
            work_dwell: 0,
            entertainment_dwell: 0,
            other_dwell: 120,
          },
        ],
      },
    });
    fsEgressAPI.listBrowserVisits.mockResolvedValue({
      data: {
        items: [
          {
            id: 'v1',
            merged: true,
            count: 4,
            browser: 'chrome',
            profile: 'focus',
            url: 'https://ya.ru/search',
            domain: 'ya.ru',
            title: 'Яндекс',
            visited_at: '2026-01-10T10:00:30Z',
            first_visited_at: '2026-01-10T10:00:00Z',
            dwell_sec: 120,
            dwell_total: 180,
            category: 'other',
            category_display: 'search',
            category_meta: { label: 'Поиск', color: 'secondary' },
            screenshot_file: '',
          },
        ],
        total: 1,
      },
    });
    renderPage();

    const openButtons = await screen.findAllByRole('button', { name: 'Открыть' });
    fireEvent.click(openButtons[0]);
    fireEvent.click(await screen.findByRole('tab', { name: /Браузер/ }));

    await waitFor(() =>
      expect(fsEgressAPI.listBrowserVisits).toHaveBeenCalledWith(
        expect.objectContaining({ computerName: 'PC-01', merge: 1 }),
      ),
    );
    expect(await screen.findByText('ya.ru')).toBeInTheDocument();
    expect(screen.getByText('×4')).toBeInTheDocument();
    expect(screen.getByText('Поиск')).toBeInTheDocument();
    expect(screen.getByText('Фокус')).toBeInTheDocument();
  });

  it('renders the attention rating and clicking a row opens the host via URL', async () => {
    fsEgressAPI.getDlpAttention.mockResolvedValue({
      data: {
        hosts: [
          {
            computer_name: 'PC-01',
            user_full_name: 'Иванов И.И.',
            branch_name: 'Тюмень',
            active_sec: 14400,
            passive_sec: 600,
            away_sec: 1800,
            locked_sec: 0,
            work_sec: 10000,
            entertainment_sec: 3600,
            browser_idle_sec: 300,
            usb_files: 3,
            usb_bytes: 4096,
            messenger_files: 2,
            first_ts: 1700000000,
            last_ts: 1700030000,
          },
          {
            computer_name: 'PC-02',
            user_full_name: 'Петров П.П.',
            branch_name: 'Тюмень',
            active_sec: 7200,
            passive_sec: 0,
            away_sec: 0,
            locked_sec: 0,
            work_sec: 0,
            entertainment_sec: 60,
            browser_idle_sec: 0,
            usb_files: 1,
            usb_bytes: 0,
            messenger_files: 0,
          },
        ],
      },
    });
    renderPage();

    await waitFor(() => expect(fsEgressAPI.getDlpAttention).toHaveBeenCalled());
    expect(await screen.findByText('Обратить внимание')).toBeInTheDocument();
    // Rating rows: sorted by metric — PC-01 leads "Развлечения". The host
    // table shows the same name without a button, so pick the clickable one.
    const nameCells = await screen.findAllByText('Иванов И.И.');
    const ratingRow = nameCells.find((el) => el.closest('button'));
    expect(ratingRow).toBeTruthy();
    fireEvent.click(ratingRow.closest('button'));

    await waitFor(() =>
      expect(screen.getByTestId('location-probe').textContent).toContain('host=PC-01'),
    );
    expect(fsEgressAPI.listEvents).toHaveBeenCalledWith(
      expect.objectContaining({ computerName: 'PC-01' }),
    );
  });

  it('keeps host and tab in the URL state across navigation', async () => {
    renderPage(['/?host=PC-01&tab=browser']);
    // Host card opens straight from the URL — no list click needed.
    await waitFor(() =>
      expect(fsEgressAPI.listBrowserDays).toHaveBeenCalledWith('PC-01', 'focus'),
    );
    fireEvent.click(await screen.findByRole('button', { name: /К списку хостов/ }));
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').textContent).not.toContain('host='),
    );
  });

  it('shows the activity empty state when the host has no buckets', async () => {
    renderPage(['/?host=PC-01']);
    await waitFor(() =>
      expect(fsEgressAPI.getDlpActivity).toHaveBeenCalledWith('PC-01', expect.any(String)),
    );
    expect(
      await screen.findByText('Нет данных об активности — нужен агент 1.4.19'),
    ).toBeInTheDocument();
  });

  it('renders the day timeline and top apps from activity data', async () => {
    const dayKey = new Date();
    const day = `${dayKey.getFullYear()}-${String(dayKey.getMonth() + 1).padStart(2, '0')}-${String(dayKey.getDate()).padStart(2, '0')}`;
    fsEgressAPI.getDlpActivity.mockResolvedValue({
      data: {
        buckets: [
          {
            bucket_start: `${day}T09:05:00`,
            active_sec: 190,
            passive_sec: 60,
            away_sec: 0,
            locked_sec: 0,
            app: '1cv8.exe',
          },
        ],
        summary: {
          first_ts: Math.floor(Date.now() / 1000) - 3600,
          last_ts: Math.floor(Date.now() / 1000) - 600,
          active_sec: 190,
          passive_sec: 60,
          away_sec: 0,
          locked_sec: 0,
          activity_pct: 76.0,
        },
        apps_top: [{ app: '1cv8.exe', sec: 190 }],
      },
    });
    renderPage(['/?host=PC-01']);
    await waitFor(() => expect(fsEgressAPI.getDlpActivity).toHaveBeenCalledWith('PC-01', day));
    expect(await screen.findByTestId('dlp-day-timeline')).toBeInTheDocument();
    expect(screen.getByText(/1cv8 · /)).toBeInTheDocument();
    expect(screen.getByText('Активность', { exact: false })).toBeInTheDocument();
  });
});
