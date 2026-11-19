import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  localStorage.removeItem('dlp_host_groups_expanded');
  sessionStorage.clear();
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
  it('loads server host stats and keeps branch groups collapsed until clicked', async () => {
    renderPage();

    await waitFor(() => expect(fsEgressAPI.listDlpHosts).toHaveBeenCalledTimes(1));
    expect(fsEgressAPI.getDlpSummary).toHaveBeenCalledTimes(1);
    // The page no longer pulls a global event page to count hosts client-side.
    expect(fsEgressAPI.listEvents).not.toHaveBeenCalled();
    expect(fsEgressAPI.listBrowserHosts).not.toHaveBeenCalled();

    // Branch headers are visible, host rows are not rendered while collapsed.
    const tyumenHeader = await screen.findByRole('button', { name: /Тюмень/ });
    expect(tyumenHeader).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: /Без филиала/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('PC-01')).not.toBeInTheDocument();
    expect(screen.queryByText('PC-77')).not.toBeInTheDocument();

    fireEvent.click(tyumenHeader);
    expect(tyumenHeader).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText('PC-01')).toBeInTheDocument();
    expect(screen.getByText('PC-02')).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole('button', { name: /Тюмень/ }));
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
            categories: {
              search: { visits: 2, dwell: 90 },
              work: { visits: 1, dwell: 30 },
              other: { visits: 1, dwell: 0 },
            },
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

    fireEvent.click(await screen.findByRole('button', { name: /Тюмень/ }));
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
    // 'Поиск' appears both as the field caption and the row's category chip.
    expect(screen.getAllByText('Поиск').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Фокус')).toBeInTheDocument();
    // Filter captions stay visible (no floating labels to shrink away); the
    // same words also appear as table column headers, hence >= 2.
    expect(screen.getAllByText('Источник').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('День')).toBeInTheDocument();
    expect(screen.getAllByText('Категория').length).toBeGreaterThanOrEqual(2);
    // Day summary renders every category from the rollup, not just the three
    // classic buckets: Поиск 90s/75%, Работа 30s/25%, Прочее 0s/0%.
    expect(screen.getByText('Поиск 1м 30с (75%) · 2 виз.')).toBeInTheDocument();
    expect(screen.getByText('Работа 30с (25%) · 1 виз.')).toBeInTheDocument();
    expect(screen.getByText('Прочее 0с (0%) · 1 виз.')).toBeInTheDocument();
  });

  it('sorts the URL table by focus time and groups rows by domain', async () => {
    fsEgressAPI.listBrowserDays.mockResolvedValue({
      data: { days: [{ day: '2026-01-10', visits: 2, categories: {} }] },
    });
    fsEgressAPI.listBrowserVisits.mockResolvedValue({
      data: {
        items: [
          {
            id: 'v1',
            merged: true,
            count: 2,
            browser: 'chrome',
            profile: 'focus',
            url: 'https://vk.com/feed',
            domain: 'vk.com',
            title: 'VK',
            visited_at: '2026-01-10T12:00:00Z',
            dwell_sec: 60,
            dwell_total: 60,
            category: 'entertainment',
            category_display: 'entertainment',
            category_meta: { label: 'Развлечения', color: 'warning' },
            screenshot_file: '',
          },
          {
            id: 'v2',
            merged: true,
            count: 5,
            browser: 'edge',
            profile: 'focus',
            url: 'https://ya.ru/',
            domain: 'ya.ru',
            title: 'Яндекс',
            visited_at: '2026-01-10T11:00:00Z',
            dwell_sec: 180,
            dwell_total: 180,
            category: 'other',
            category_display: 'search',
            category_meta: { label: 'Поиск', color: 'secondary' },
            screenshot_file: '',
          },
        ],
        total: 2,
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Тюмень/ }));
    const openButtons = await screen.findAllByRole('button', { name: 'Открыть' });
    fireEvent.click(openButtons[0]);
    fireEvent.click(await screen.findByRole('tab', { name: /Браузер/ }));
    await screen.findByText('vk.com');

    // Default order is by visit time: vk.com (12:00) first. Sorting by focus
    // dwell lifts ya.ru (3м) to the top.
    fireEvent.click(screen.getByRole('button', { name: 'В фокусе' }));
    await waitFor(() => {
      const firstRow = document.querySelector('tbody tr');
      expect(within(firstRow).getByText('ya.ru')).toBeInTheDocument();
    });

    // Domains view: one row per domain ordered by dwell, with visit totals.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Вид' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Домены' }));
    await waitFor(() => {
      const body = [...document.querySelectorAll('tbody tr')];
      expect(within(body[0]).getByText('ya.ru')).toBeInTheDocument();
      expect(within(body[0]).getByText('3м')).toBeInTheDocument();
      expect(within(body[1]).getByText('vk.com')).toBeInTheDocument();
      expect(within(body[1]).getByText('1м')).toBeInTheDocument();
    });
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
    // No ?day in the URL: the server resolves the host's branch-local day.
    await waitFor(() => expect(fsEgressAPI.getDlpActivity).toHaveBeenCalledWith('PC-01', ''));
    expect(await screen.findByTestId('dlp-day-timeline')).toBeInTheDocument();
    expect(screen.getByText(/1С:Предприятие · /)).toBeInTheDocument();
    expect(screen.getByText('Доля активности', { exact: false })).toBeInTheDocument();
  });

  it('shows host activity in branch-local time with honest labels', async () => {
    // 19:00Z == 07:00 of the next day at UTC+12 (Vilyuchinsk).
    const branchDay = '2026-11-12';
    const epoch = Date.parse('2026-11-11T19:00:00Z') / 1000;
    fsEgressAPI.getDlpActivity.mockResolvedValue({
      data: {
        buckets: [
          {
            bucket_start: '2026-11-11T19:00:00Z',
            active_sec: 240,
            passive_sec: 0,
            away_sec: 0,
            locked_sec: 0,
            zone: 'off',
            offshift_sec: 0,
            app: 'chrome.exe',
          },
        ],
        summary: {
          first_ts: epoch,
          last_ts: epoch + 300,
          active_sec: 240,
          passive_sec: 0,
          away_sec: 0,
          locked_sec: 0,
          activity_pct: 100,
          active_offshift_sec: 240,
        },
        apps_top: [{ app: 'chrome.exe', sec: 240 }],
        local_time: {
          day: branchDay,
          branch_name: 'Вилючинск',
          utc_offset_minutes: 720,
          work_start_min: 540,
          work_end_min: 1080,
          lunch_start_min: 780,
          lunch_end_min: 825,
          workdays_mask: 63,
        },
      },
    });
    renderPage(['/?host=PC-01']);

    await waitFor(() => expect(fsEgressAPI.getDlpActivity).toHaveBeenCalledWith('PC-01', ''));
    // The server resolved the branch day — the URL gained no ?day.
    expect(screen.getByTestId('location-probe').textContent).not.toContain('day=');
    // Local clock caption + shift summary from local_time metadata.
    expect(
      await screen.findByText(/Местное время: Вилючинск · UTC\+12:00 · сейчас/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Смена 09:00–18:00 · обед 13:00–13:45/)).toBeInTheDocument();
    // First/last input shown at branch-local 07:00, honest measurement labels.
    expect(screen.getByText(/Первый\/последний бакет ввода 07:00–07:05/)).toBeInTheDocument();
    // The label appears both in the summary row and the timeline legend.
    expect(
      screen.getAllByText('Ввод/короткая пауза', { exact: false }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Доля активности', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Ввод вне смены/)).toBeInTheDocument();
    // The resolved branch day populates the date input.
    expect(screen.getByLabelText('День по местному времени филиала')).toHaveValue(branchDay);
    // The bucket lands on the local 07:00 run of the state rail and is listed
    // verbatim in the interval dialog.
    const timeline = screen.getByTestId('dlp-day-timeline');
    expect(timeline.querySelector('[title="07:00–07:05 · Ввод вне смены"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Интервалы по времени' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('07:00–07:05 · Ввод вне смены · Google Chrome (chrome)'),
    ).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
  });

  it('honours an explicit ?day for host activity', async () => {
    renderPage(['/?host=PC-01&day=2026-11-10']);
    await waitFor(() =>
      expect(fsEgressAPI.getDlpActivity).toHaveBeenCalledWith('PC-01', '2026-11-10'),
    );
    expect(screen.getByLabelText('День по местному времени филиала')).toHaveValue('2026-11-10');
  });

  it('shows local clock captions next to the empty activity state', async () => {
    fsEgressAPI.getDlpActivity.mockResolvedValue({
      data: {
        buckets: [],
        summary: {},
        apps_top: [],
        local_time: {
          day: '2026-11-12',
          branch_name: 'Вилючинск',
          utc_offset_minutes: 720,
          work_start_min: 540,
          work_end_min: 1080,
          lunch_start_min: 780,
          lunch_end_min: 825,
          workdays_mask: 63,
        },
      },
    });
    renderPage(['/?host=PC-01']);

    expect(
      await screen.findByText(/Местное время: Вилючинск · UTC\+12:00 · сейчас \d{2}:\d{2}/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Смена 09:00–18:00/)).toBeInTheDocument();
    expect(
      screen.getByText('Нет данных об активности — нужен агент 1.4.19'),
    ).toBeInTheDocument();
  });

  it('groups buckets into labelled rails and a readable interval list', async () => {
    // 17:00+05:00 == 00:00 of the next day at UTC+12 (Vilyuchinsk): the day
    // rolls over at branch midnight, so these buckets open the local day.
    fsEgressAPI.getDlpActivity.mockResolvedValue({
      data: {
        buckets: [
          { bucket_start: '2026-11-11T17:00:00+05:00', active_sec: 180, zone: 'off', app: 'chrome.exe' },
          { bucket_start: '2026-11-11T17:05:00+05:00', away_sec: 300, app: null },
          { bucket_start: '2026-11-11T17:15:00+05:00', active_sec: 200, app: '1cv8.exe' },
        ],
        summary: { active_sec: 380, away_sec: 300 },
        apps_top: [{ app: 'chrome.exe', sec: 180 }, { app: '1cv8.exe', sec: 200 }],
        local_time: {
          day: '2026-11-12',
          branch_name: 'Вилючинск',
          utc_offset_minutes: 720,
          work_start_min: 540,
          work_end_min: 1080,
          lunch_start_min: 780,
          lunch_end_min: 825,
          workdays_mask: 63,
        },
      },
    });
    renderPage(['/?host=PC-01']);
    await waitFor(() => expect(fsEgressAPI.getDlpActivity).toHaveBeenCalledWith('PC-01', ''));

    // Two distinct labelled rails with accessible names.
    expect(
      await screen.findByRole('img', { name: /Состояние ПК за местный день/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Приложение в фокусе за местный день/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Состояние ПК')).toBeInTheDocument();
    expect(screen.getByText('Приложение в фокусе')).toBeInTheDocument();

    // On the app rail an unobserved gap must not merge with an observed
    // no-app stretch: the runs carry distinct titles.
    const appRail = screen.getByRole('img', { name: /Приложение в фокусе за местный день/ });
    expect(
      appRail.querySelector('[title="00:05–00:10 · приложение не фиксировалось"]'),
    ).not.toBeNull();
    expect(appRail.querySelector('[title="00:10–00:15 · Нет данных"]')).not.toBeNull();

    // The interval dialog is authoritative: local-midnight mapping, off-shift
    // input keeps its app, unknown is not conflated with "away".
    fireEvent.click(screen.getByRole('button', { name: 'Интервалы по времени' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('00:00–00:05 · Ввод вне смены · Google Chrome (chrome)'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('00:05–00:10 · отошёл · приложение не фиксировалось'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('00:10–00:15 · Нет данных')).toBeInTheDocument();
    expect(
      within(dialog).getByText('00:15–00:20 · ввод/короткая пауза · 1С:Предприятие (1cv8)'),
    ).toBeInTheDocument();

    // Close the modal first — a click "behind" it would be a false positive.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    // The focus-tabs button switches the host card to the browser panel,
    // which keeps its default "focus" source filter.
    fireEvent.click(screen.getByRole('button', { name: 'Вкладки в фокусе' }));
    await waitFor(() =>
      expect(fsEgressAPI.listBrowserDays).toHaveBeenCalledWith('PC-01', 'focus'),
    );
    expect(screen.getByTestId('location-probe').textContent).toContain('tab=browser');
  });

  it('does not claim an unscheduled branch timezone as local', async () => {
    fsEgressAPI.getDlpActivity.mockResolvedValue({
      data: {
        buckets: [],
        summary: {},
        apps_top: [],
        local_time: {
          day: '2026-11-12',
          branch_name: 'Москва',
          utc_offset_minutes: 300,
          work_start_min: null,
          work_end_min: null,
          lunch_start_min: null,
          lunch_end_min: null,
          workdays_mask: null,
        },
      },
    });
    renderPage(['/?host=PC-01']);

    // Unscheduled host falls back to Tyumen time — the branch name must not
    // be presented as if it were the clock's timezone.
    expect(await screen.findByText(/Время Тюмени: UTC\+05:00 · сейчас \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.queryByText(/Местное время: Москва/)).not.toBeInTheDocument();
    expect(screen.getByText(/График филиала Москва не задан/)).toBeInTheDocument();
  });

  it('sorts host rows by entertainment time via the column header', async () => {
    fsEgressAPI.getDlpAttention.mockResolvedValue({
      data: {
        hosts: [
          { computer_name: 'PC-01', active_sec: 100, entertainment_sec: 60 },
          { computer_name: 'PC-02', active_sec: 100, entertainment_sec: 3600 },
        ],
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Тюмень/ }));

    const hostColumn = await screen.findByRole('columnheader', { name: /Хост/ });
    const table = hostColumn.closest('table');
    const hostOrder = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((row) => row.cells[0].textContent);

    // Default sort: последнее событие desc — PC-01 is the newer host.
    expect(hostOrder()[0]).toContain('PC-01');

    const sortButton = within(table).getByRole('button', { name: /Развлечения/ });
    fireEvent.click(sortButton);
    expect(hostOrder()[0]).toContain('PC-02'); // 1ч развлечений > 1м
    fireEvent.click(sortButton);
    expect(hostOrder()[0]).toContain('PC-01');
  });

  it('opens the host browser filtered to entertainment from the column value', async () => {
    fsEgressAPI.getDlpAttention.mockResolvedValue({
      data: {
        hosts: [{ computer_name: 'PC-01', active_sec: 100, entertainment_sec: 3600 }],
      },
    });
    fsEgressAPI.listBrowserDays.mockResolvedValue({
      data: { days: [{ day: '2026-01-10', visits: 2, categories: {} }] },
    });
    fsEgressAPI.listBrowserVisits.mockResolvedValue({
      data: {
        items: [
          {
            id: 'v1',
            merged: true,
            count: 2,
            browser: 'chrome',
            profile: 'focus',
            url: 'https://vk.com/feed',
            domain: 'vk.com',
            title: 'VK',
            visited_at: '2026-01-10T12:00:00Z',
            dwell_sec: 60,
            dwell_total: 60,
            category: 'entertainment',
            category_display: 'entertainment',
            category_meta: { label: 'Развлечения', color: 'warning' },
            screenshot_file: '',
          },
          {
            id: 'v2',
            merged: true,
            count: 5,
            browser: 'edge',
            profile: 'focus',
            url: 'https://ya.ru/',
            domain: 'ya.ru',
            title: 'Яндекс',
            visited_at: '2026-01-10T11:00:00Z',
            dwell_sec: 180,
            dwell_total: 180,
            category: 'other',
            category_display: 'search',
            category_meta: { label: 'Поиск', color: 'secondary' },
            screenshot_file: '',
          },
        ],
        total: 2,
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Тюмень/ }));

    // The entertainment value is a button that deep-links into the host's
    // browser view pre-filtered to the entertainment category.
    fireEvent.click(await screen.findByRole('button', { name: '1ч' }));
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').textContent).toContain('tab=browser'),
    );
    expect(await screen.findByText('vk.com')).toBeInTheDocument();
    // The non-entertainment row is filtered out.
    expect(screen.queryByText('ya.ru')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Категория' })).toHaveTextContent('Развлечения');
  });

  it('restores host list filters and expansion after Esc from a host card', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Тюмень/ }));
    const search = screen.getByPlaceholderText('Поиск по имени ПК или пользователю');
    fireEvent.change(search, { target: { value: 'PC-01' } });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Открыть' }))[0]);
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').textContent).toContain('host=PC-01'),
    );

    // Esc on the host card returns to the list (same as "К списку хостов").
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByTestId('location-probe').textContent).not.toContain('host='),
    );

    // The list remounts with the same search text and expanded branch.
    expect(
      screen.getByPlaceholderText('Поиск по имени ПК или пользователю'),
    ).toHaveValue('PC-01');
    expect(screen.getByRole('button', { name: /Тюмень/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('shows the full attention list and scrolls its KPI card into view', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    fsEgressAPI.getDlpAttention.mockResolvedValue({
      data: {
        hosts: Array.from({ length: 8 }, (_, i) => ({
          computer_name: `ENT-${String(i + 1).padStart(2, '0')}`,
          user_full_name: `User ${i + 1}`,
          branch_name: 'Тюмень',
          active_sec: 100,
          entertainment_sec: 3600 - i * 100,
        })),
      },
    });
    renderPage();

    await waitFor(() => expect(fsEgressAPI.getDlpAttention).toHaveBeenCalled());
    // All 8 nonzero hosts render (was top-5); card total mirrors the KPI.
    const card = (await screen.findByText(/· 8 ПК/)).closest('.MuiPaper-root');
    expect(within(card).getAllByRole('button')).toHaveLength(8);
    expect(within(card).getByText('User 8')).toBeInTheDocument();

    // KPI click scrolls to the matching attention card.
    fireEvent.click(screen.getByRole('button', { name: /Развлечения: / }));
    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollSpy.mock.contexts[0]).toBe(card);
  });
});
