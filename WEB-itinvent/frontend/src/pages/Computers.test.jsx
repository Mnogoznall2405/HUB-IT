import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Computers from './Computers';
import { equipmentAPI } from '../api/client';

vi.mock('../api/client', () => ({
  equipmentAPI: {
    getAgentComputers: vi.fn(),
    searchAgentComputers: vi.fn(),
    getAgentComputerChanges: vi.fn(),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    hasPermission: (permission) => permission === 'computers.read_all' || permission === 'computers.read',
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

const sampleComputer = {
  hostname: 'PC-01',
  mac_address: 'AA-BB-CC-DD-EE-01',
  status: 'online',
  age_seconds: 60,
  current_user: 'CORP\\petrov_aa',
  user_login: 'CORP\\petrov_aa',
  user_full_name: 'Петров А.А.',
  branch_name: 'Тюмень',
  location_name: 'Кабинет 12',
  database_name: 'Основная БД',
  ip_primary: '10.10.1.11',
  network_link: {
    device_code: 'SW-01',
    port_name: 'Gi1/0/12',
    socket_code: 'T-12',
    site_name: 'Тюмень / 1 этаж',
  },
  health: {
    cpu_load_percent: 12.3,
    ram_used_percent: 55.5,
    uptime_seconds: 3600,
    last_reboot_at: 1710000000,
  },
  last_seen_at: 1710003000,
  logical_disks: [
    { mountpoint: 'C:\\', total_gb: 512, free_gb: 128, fstype: 'NTFS' },
  ],
  storage: [
    {
      display_name: 'Samsung SSD',
      serial_number: 'SSD-001',
      health_status: 'Warning',
      wear_out_percentage: 10,
      temperature: 41,
      media_type: 'SSD',
      bus_type: 'NVMe',
      size_bytes: 512 * (1024 ** 3),
    },
  ],
  monitors: [
    { manufacturer: 'Dell', product_code: 'U2422H', serial_number: 'MON-001', serial_source: 'wmi' },
  ],
  outlook_status: 'critical',
  outlook_active_path: 'D:\\Mail\\archive-user1.ost',
  outlook_active_size_bytes: 52 * (1024 ** 3),
  outlook_total_size_bytes: 60 * (1024 ** 3),
  outlook_archives_count: 1,
  outlook: {
    status: 'critical',
    confidence: 'high',
    active_store: {
      path: 'D:\\Mail\\archive-user1.ost',
      type: 'ost',
      size_bytes: 52 * (1024 ** 3),
      last_modified_at: 1710002000,
    },
    active_stores: [
      {
        path: 'D:\\Mail\\archive-user1.ost',
        type: 'ost',
        size_bytes: 52 * (1024 ** 3),
        last_modified_at: 1710002000,
      },
    ],
    archives: [
      {
        path: 'D:\\Mail\\archive-user1.pst',
        type: 'pst',
        size_bytes: 8 * (1024 ** 3),
        last_modified_at: 1710001500,
      },
    ],
    total_outlook_size_bytes: 60 * (1024 ** 3),
  },
  user_profile_sizes: {
    collected_at: 1710002600,
    profiles_count: 1,
    total_size_bytes: 12 * (1024 ** 3),
    profiles: [
      {
        user_name: 'petrov_aa',
        profile_path: 'C:\\Users\\petrov_aa',
        total_size_bytes: 12 * (1024 ** 3),
        files_count: 1200,
        dirs_count: 80,
        errors_count: 0,
        partial: true,
        partial_reasons: ['entry_limit'],
        top_level_folders: [
          { name: 'Documents', path: 'C:\\Users\\petrov_aa\\Documents', size_bytes: 8 * (1024 ** 3), files_count: 600, dirs_count: 20, partial: true, partial_reasons: ['entry_limit'] },
          { name: 'Desktop', path: 'C:\\Users\\petrov_aa\\Desktop', size_bytes: 2 * (1024 ** 3), files_count: 200, dirs_count: 10 },
          { name: 'AppData', path: 'C:\\Users\\petrov_aa\\AppData', size_bytes: 1 * (1024 ** 3), files_count: 300, dirs_count: 30 },
          { name: 'Downloads', path: 'C:\\Users\\petrov_aa\\Downloads', size_bytes: 512 * (1024 ** 2), files_count: 60, dirs_count: 5 },
          { name: 'Pictures', path: 'C:\\Users\\petrov_aa\\Pictures', size_bytes: 256 * (1024 ** 2), files_count: 30, dirs_count: 4 },
          { name: 'Music', path: 'C:\\Users\\petrov_aa\\Music', size_bytes: 128 * (1024 ** 2), files_count: 10, dirs_count: 2 },
        ],
      },
    ],
    partial: true,
    partial_reasons: ['entry_limit'],
  },
  has_hardware_changes: true,
  changes_count_30d: 1,
  last_change_at: 1710002500,
  recent_changes: [
    {
      event_id: 'chg-1',
      detected_at: 1710002500,
      change_types: ['storage'],
      diff: { storage: { before: ['SSD-old'], after: ['SSD-001'] } },
    },
  ],
};

describe('Computers page', () => {
  beforeEach(() => {
    equipmentAPI.getAgentComputers.mockReset();
    equipmentAPI.searchAgentComputers.mockReset();
    equipmentAPI.getAgentComputerChanges.mockReset();
    equipmentAPI.getAgentComputers.mockResolvedValue([sampleComputer]);
    equipmentAPI.searchAgentComputers.mockResolvedValue({
      items: [sampleComputer],
      total: 1,
      limit: 50,
      offset: 0,
      has_more: false,
      next_offset: null,
      summary: {
        total: 1,
        statuses: { online: 1, stale: 0, offline: 0, unknown: 0 },
        branches: { [sampleComputer.branch_name]: 1 },
        outlook: { critical: 1 },
      },
    });
    equipmentAPI.getAgentComputerChanges.mockResolvedValue({
      totals: { changed_24h: 1, changed_7d: 1, changed_30d: 1 },
      daily: [],
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders computers data from the backend contract and opens details drawer', async () => {
    render(<Computers />);

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(await screen.findByText(sampleComputer.location_name));
    expect(await screen.findByText(sampleComputer.user_full_name)).toBeInTheDocument();
    const hostnameMatches = await screen.findAllByText(sampleComputer.hostname);
    fireEvent.click(hostnameMatches[hostnameMatches.length - 1]);

    expect(await screen.findByText(new RegExp(`Филиал: ${sampleComputer.branch_name}`))).toBeInTheDocument();
    expect(screen.getByText(/Загрузка CPU:/)).toBeInTheDocument();
    expect(screen.getByText(sampleComputer.outlook_active_path)).toBeInTheDocument();
    expect(screen.getByText('petrov_aa')).toBeInTheDocument();
    expect(screen.getByText('Расчет не полный')).toBeInTheDocument();
    expect(screen.getByText('Частично')).toBeInTheDocument();
    expect(screen.queryByText('partial')).not.toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('Документы') && content.includes('8.0'))).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes('+ еще 2'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Показать все папки \(6\)/i }));
    expect(screen.getByText('AppData')).toBeInTheDocument();
    expect(screen.getByText('Изображения')).toBeInTheDocument();
    expect(screen.getByText('Music')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Скрыть системные/i }));
    expect(screen.queryByText('AppData')).not.toBeInTheDocument();
    expect(screen.getByText('Скрыто системных: 1')).toBeInTheDocument();
    expect(screen.getByText('Music')).toBeInTheDocument();
    expect(screen.getByText('Samsung SSD')).toBeInTheDocument();
  }, 15000);

  it('sends server-side filter options when search, changedOnly, and scope change', async () => {
    render(<Computers />);

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'selected',
          sortBy: 'hostname',
          sortDir: 'asc',
          limit: 50,
          offset: 0,
          includeSummary: true,
          searchFields: expect.arrayContaining(['identity', 'profiles', 'outlook']),
        })
      );
    });

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'petrov' } });

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'petrov' })
      );
    }, { timeout: 2000 });

    fireEvent.click(screen.getByLabelText('Изменения'));

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenLastCalledWith(
        expect.objectContaining({ changedOnly: true })
      );
    }, { timeout: 2000 });

    fireEvent.click(screen.getByLabelText('Текущая БД'));

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'all' })
      );
    }, { timeout: 2000 });
  }, 15000);

  it('automatically loads remaining pages after the first page is shown', async () => {
    const nextComputer = {
      ...sampleComputer,
      hostname: 'PC-02',
      mac_address: 'AA-BB-CC-DD-EE-02',
      location_name: 'Office 2',
    };
    equipmentAPI.searchAgentComputers
      .mockResolvedValueOnce({
        items: [sampleComputer],
        total: 2,
        limit: 1,
        offset: 0,
        has_more: true,
        next_offset: 1,
        summary: {
          total: 2,
          statuses: { online: 2, stale: 0, offline: 0, unknown: 0 },
          branches: { [sampleComputer.branch_name]: 2 },
          outlook: { critical: 2 },
        },
      })
      .mockResolvedValueOnce({
        items: [nextComputer],
        total: 2,
        limit: 1,
        offset: 1,
        has_more: false,
        next_offset: null,
      });

    render(<Computers />);

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 0, includeSummary: true })
      );
    });

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 1, includeSummary: false })
      );
    }, { timeout: 3000 });

    expect(equipmentAPI.getAgentComputerChanges).toHaveBeenCalledTimes(1);
  }, 15000);

  it('refreshes the loaded range and does not query when a location is expanded', async () => {
    const nextComputer = {
      ...sampleComputer,
      hostname: 'PC-02',
      mac_address: 'AA-BB-CC-DD-EE-02',
      location_name: sampleComputer.location_name,
    };
    equipmentAPI.searchAgentComputers
      .mockResolvedValueOnce({
        items: [sampleComputer],
        total: 2,
        limit: 1,
        offset: 0,
        has_more: true,
        next_offset: 1,
        summary: {
          total: 2,
          statuses: { online: 2, stale: 0, offline: 0, unknown: 0 },
          branches: { [sampleComputer.branch_name]: 2 },
          outlook: { critical: 2 },
        },
      })
      .mockResolvedValueOnce({
        items: [nextComputer],
        total: 2,
        limit: 1,
        offset: 1,
        has_more: false,
        next_offset: null,
      })
      .mockResolvedValueOnce({
        items: [sampleComputer, nextComputer],
        total: 2,
        limit: 2,
        offset: 0,
        has_more: false,
        next_offset: null,
        summary: {
          total: 2,
          statuses: { online: 2, stale: 0, offline: 0, unknown: 0 },
          branches: { [sampleComputer.branch_name]: 2 },
          outlook: { critical: 2 },
        },
      });

    render(<Computers />);

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 1, includeSummary: false })
      );
    }, { timeout: 3000 });

    const callsAfterAutoLoad = equipmentAPI.searchAgentComputers.mock.calls.length;
    fireEvent.click(await screen.findByText(sampleComputer.location_name));
    expect(equipmentAPI.searchAgentComputers).toHaveBeenCalledTimes(callsAfterAutoLoad);

    fireEvent.click(screen.getByRole('button', { name: /РћР±РЅРѕРІРёС‚СЊ РґР°РЅРЅС‹Рµ|Обновить данные/i }));

    await waitFor(() => {
      expect(equipmentAPI.searchAgentComputers).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, limit: 2, includeSummary: true })
      );
    });
  }, 15000);
});
