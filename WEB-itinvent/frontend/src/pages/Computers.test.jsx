import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Computers from './Computers';
import { equipmentAPI } from '../api/client';

vi.mock('../api/client', () => ({
  equipmentAPI: {
    getAgentComputers: vi.fn(),
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
    last_reboot_at: 1_710_000_000,
  },
  last_seen_at: 1_710_003_000,
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
      last_modified_at: 1_710_002_000,
    },
    active_stores: [
      {
        path: 'D:\\Mail\\archive-user1.ost',
        type: 'ost',
        size_bytes: 52 * (1024 ** 3),
        last_modified_at: 1_710_002_000,
      },
    ],
    archives: [
      {
        path: 'D:\\Mail\\archive-user1.pst',
        type: 'pst',
        size_bytes: 8 * (1024 ** 3),
        last_modified_at: 1_710_001_500,
      },
    ],
    total_outlook_size_bytes: 60 * (1024 ** 3),
  },
  has_hardware_changes: true,
  changes_count_30d: 1,
  last_change_at: 1_710_002_500,
  recent_changes: [
    {
      event_id: 'chg-1',
      detected_at: 1_710_002_500,
      change_types: ['storage'],
      diff: { storage: { before: ['SSD-old'], after: ['SSD-001'] } },
    },
  ],
};

describe('Computers page', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    equipmentAPI.getAgentComputers.mockReset();
    equipmentAPI.getAgentComputerChanges.mockReset();
    equipmentAPI.getAgentComputers.mockResolvedValue([sampleComputer]);
    equipmentAPI.getAgentComputerChanges.mockResolvedValue({
      totals: { changed_24h: 1, changed_7d: 1, changed_30d: 1 },
      daily: [],
    });
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders computers data from the backend contract and opens details drawer', async () => {
    render(<Computers />);

    expect(await screen.findByText('Дашборд компьютеров')).toBeInTheDocument();
    expect(await screen.findByText('Петров А.А.')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Кабинет 12'));
    fireEvent.click(await screen.findByText('PC-01'));

    expect(await screen.findByText('Пользователь и сеть')).toBeInTheDocument();
    expect(screen.getByText(/Филиал: Тюмень/)).toBeInTheDocument();
    expect(screen.getByText(/CPU:/)).toBeInTheDocument();
    expect(screen.getByText(/D:\\Mail\\archive-user1.ost/)).toBeInTheDocument();
    expect(screen.getByText(/SMART\/физические диски/i)).toBeInTheDocument();
  });

  it('sends server-side filter options when search, changedOnly, and scope change', async () => {
    render(<Computers />);

    await waitFor(() => {
      expect(equipmentAPI.getAgentComputers).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'selected', sortBy: 'hostname', sortDir: 'asc' })
      );
    });

    fireEvent.change(screen.getByLabelText('Поиск'), { target: { value: 'petrov' } });
    vi.advanceTimersByTime(400);

    await waitFor(() => {
      expect(equipmentAPI.getAgentComputers).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: 'petrov' })
      );
    });

    fireEvent.click(screen.getByLabelText('Изменения'));
    await waitFor(() => {
      expect(equipmentAPI.getAgentComputers).toHaveBeenLastCalledWith(
        expect.objectContaining({ changedOnly: true })
      );
    });

    fireEvent.click(screen.getByLabelText('Текущая БД'));
    await waitFor(() => {
      expect(equipmentAPI.getAgentComputers).toHaveBeenLastCalledWith(
        expect.objectContaining({ scope: 'all' })
      );
    });
  });
});
