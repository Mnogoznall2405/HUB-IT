import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HubDesktopDeploySection from './HubDesktopDeploySection';
import { scanAgentsAPI } from '../../../api/scanAgents';
import { scanInstallPackagesAPI } from '../../../api/scanInstallPackages';
import { scanTasksAPI } from '../../../api/scanTasks';
import { computersSoftwareAPI } from '../../../api/computersSoftware';

vi.mock('../../../api/scanAgents', () => ({
  scanAgentsAPI: { getAgents: vi.fn() },
}));
vi.mock('../../../api/scanInstallPackages', () => ({
  scanInstallPackagesAPI: { getPackages: vi.fn(), getDeployment: vi.fn() },
}));
vi.mock('../../../api/scanTasks', () => ({
  scanTasksAPI: { createTask: vi.fn() },
}));
vi.mock('../../../api/computersSoftware', () => ({
  computersSoftwareAPI: { getSoftwarePresence: vi.fn() },
}));

const PACKAGE = {
  package_id: 'hub-desktop',
  display_name: 'HUB Desktop',
  version: '0.1.50',
  kind: 'exe',
  filename: 'HUB-Desktop-Setup-0.1.50-win-x64.exe',
  size_bytes: 201313986,
  ok: true,
};

// Scan agents report an empty branch in production — the branch comes from the inventory presence payload.
const AGENTS = [
  { agent_id: 'PC-OK', hostname: 'PC-OK', version: '1.4.19', branch: '', is_online: true, last_seen_at: 1700000000 },
  { agent_id: 'PC-OLD', hostname: 'PC-OLD', version: '1.4.19', branch: '', is_online: true, last_seen_at: 1700000000 },
  { agent_id: 'PC-NONE', hostname: 'PC-NONE', version: '1.4.19', branch: '', is_online: true, last_seen_at: 1700000000 },
  { agent_id: 'PC-LEGACY', hostname: 'PC-LEGACY', version: '1.4.11', branch: '', is_online: false, last_seen_at: 1690000000 },
];

beforeEach(() => {
  vi.clearAllMocks();
  scanInstallPackagesAPI.getPackages.mockResolvedValue({ configured: true, error: '', packages: [PACKAGE] });
  scanInstallPackagesAPI.getDeployment.mockResolvedValue({ package: PACKAGE, tasks: {} });
  scanAgentsAPI.getAgents.mockResolvedValue(AGENTS);
  computersSoftwareAPI.getSoftwarePresence.mockResolvedValue({
    items: [
      { hostname: 'PC-OK', installed_version: '0.1.50', collected_at: '2026-11-11', has_software_inventory: true, branch_name: 'Тюмень' },
      { hostname: 'PC-OLD', installed_version: '0.1.40', collected_at: '2026-11-11', has_software_inventory: true, branch_name: 'Тюмень' },
      { hostname: 'PC-NONE', installed_version: null, collected_at: '2026-11-11', has_software_inventory: true, branch_name: 'Курган' },
      { hostname: 'PC-LEGACY', installed_version: null, collected_at: null, has_software_inventory: false, branch_name: 'Курган' },
    ],
    total: 4,
  });
  scanTasksAPI.createTask.mockResolvedValue({ success: true, task: { id: 't1', status: 'queued' } });
});

describe('HubDesktopDeploySection', () => {
  it('shows per-host status from the software inventory and deploys a task', async () => {
    render(<HubDesktopDeploySection canScanTasks />);

    expect(await screen.findByText(/версия 0\.1\.50/)).toBeInTheDocument();
    // Branch groups start collapsed like the DLP page — expand the branch first.
    expect(screen.queryByText('PC-OK')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Тюмень/ }));
    expect(await screen.findByText('PC-OK')).toBeInTheDocument();

    // Inventory rows drive the status: current / outdated / not installed.
    expect(screen.getByRole('button', { name: 'Актуальные: 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Устаревшие: 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Старый агент: 1' })).toBeInTheDocument();

    // The outdated host offers "Обновить"; clicking queues install_package.
    const outdatedRow = screen.getByText('PC-OLD').closest('tr');
    fireEvent.click(within(outdatedRow).getByRole('button', { name: 'Обновить' }));
    await waitFor(() => expect(scanTasksAPI.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        agent_id: 'PC-OLD',
        command: 'install_package',
        payload: { package_id: 'hub-desktop' },
      }),
    ));
    // Only package_id leaves the client — file, hash and args stay server-side.
    expect(scanTasksAPI.createTask.mock.calls[0][0].payload).toEqual({ package_id: 'hub-desktop' });
  });

  it('marks a host outdated when a newer package exists despite an old completed install task', async () => {
    // Regression: a completed install_package task used to pin the row to
    // "Актуальная" forever, hiding "Обновить" after a newer package publish.
    scanInstallPackagesAPI.getPackages.mockResolvedValue({
      configured: true, error: '',
      packages: [{ ...PACKAGE, version: '0.1.51', filename: 'HUB-Desktop-Setup-0.1.51-win-x64.exe' }],
    });
    scanInstallPackagesAPI.getDeployment.mockResolvedValue({
      package: { ...PACKAGE, version: '0.1.51' },
      tasks: {
        'PC-OK': {
          status: 'completed',
          payload: { package_id: 'hub-desktop', version: '0.1.50' },
          result: { phase: 'already_installed', installed_version: '0.1.50' },
          is_active: false,
        },
      },
    });
    computersSoftwareAPI.getSoftwarePresence.mockResolvedValue({
      items: [
        { hostname: 'PC-OK', installed_version: '0.1.50', collected_at: '2026-11-11', has_software_inventory: true, branch_name: 'Тюмень' },
      ],
      total: 1,
    });
    scanAgentsAPI.getAgents.mockResolvedValue([AGENTS[0]]);

    render(<HubDesktopDeploySection canScanTasks />);
    // The status filter force-expands matching groups regardless of persisted branch state.
    fireEvent.click(await screen.findByRole('button', { name: 'Устаревшие: 1' }));
    await screen.findByText('PC-OK');

    expect(screen.queryByRole('button', { name: 'Актуальные: 1' })).not.toBeInTheDocument();
    const row = screen.getByText('PC-OK').closest('tr');
    expect(within(row).getByRole('button', { name: 'Обновить' })).toBeInTheDocument();
  });

  it('queues the package for every host without it via the bulk action', async () => {
    render(<HubDesktopDeploySection canScanTasks />);
    fireEvent.click(await screen.findByRole('button', { name: /Курган/ }));
    await screen.findByText('PC-NONE');

    fireEvent.click(screen.getByRole('button', { name: 'Установить, где нет' }));
    const dialogButton = await screen.findByRole('button', { name: /Развернуть \(/ });
    fireEvent.click(dialogButton);

    await waitFor(() => expect(scanTasksAPI.createTask).toHaveBeenCalled());
    const targets = scanTasksAPI.createTask.mock.calls.map((call) => call[0].agent_id);
    // PC-NONE has no install; PC-LEGACY is too old for install_package and is skipped.
    expect(targets).toEqual(['PC-NONE']);
  });
});
