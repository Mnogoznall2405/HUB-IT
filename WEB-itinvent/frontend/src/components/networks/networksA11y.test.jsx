import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BranchList from './BranchList';
import EquipmentTab from './EquipmentTab';
import SocketsTab from './SocketsTab';

const mobileMatchMedia = () => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const nestedButtons = (container) => container.querySelectorAll('button button').length;

const branch = {
  id: 1,
  name: 'Центральный офис',
  branch_code: 'TYU-01',
  devices_count: 3,
  ports_count: 48,
  sockets_count: 12,
  maps_count: 1,
  map_points_count: 40,
};

beforeEach(mobileMatchMedia);

describe('card actions are siblings of the clickable area, not nested buttons', () => {
  it('BranchList keeps edit/delete buttons outside the card action area', () => {
    const { container } = render(
      <BranchList
        branches={[branch]}
        canEdit
        onBranchClick={vi.fn()}
        onEditClick={vi.fn()}
        onDeleteClick={vi.fn()}
      />,
    );
    expect(nestedButtons(container)).toBe(0);
    expect(screen.getByRole('button', { name: 'Редактировать филиал Центральный офис' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Удалить филиал Центральный офис' })).toBeInTheDocument();
  });

  it('EquipmentTab mobile cards keep the edit button outside the action area', () => {
    const ports = [{ id: 1, patch_panel_port: 'PP-1', device_code: 'SW-01', port_name: 'p1' }];
    const { container } = render(
      <EquipmentTab
        isMobile
        canEdit
        isBranchWidePortSearch={false}
        devices={[]}
        devicePortCounts={new Map()}
        selectedDeviceId={null}
        selectedDevice={null}
        matchedDeviceIds={new Set()}
        matchedDevicePortCount={new Map()}
        portSearch=""
        setPortSearch={vi.fn()}
        displayedPorts={ports}
        branchPortLoading={false}
        editingPortId={null}
        portDraft={{}}
        socketAutocompleteOptions={[]}
        socketKey={(v) => String(v || '')}
        openCreateDeviceDialog={vi.fn()}
        openEditDeviceDialog={vi.fn()}
        setSelectedDeviceId={vi.fn()}
        handlePortRowClick={vi.fn()}
        startEditPort={vi.fn()}
        updatePortDraftField={vi.fn()}
        savePortEdit={vi.fn()}
        setSelectedSocketId={vi.fn()}
      />,
    );
    expect(nestedButtons(container)).toBe(0);
    expect(screen.getByRole('button', { name: /Изменить порт/ })).toBeInTheDocument();
  });

  it('SocketsTab mobile cards keep the delete button outside the action area', () => {
    const { container } = render(
      <SocketsTab
        canEdit
        socketSearch=""
        setSocketSearch={vi.fn()}
        filteredSockets={[{ id: 1, socket_code: 'S-1' }]}
        handleSocketRowClick={vi.fn()}
        onDeleteSocket={vi.fn()}
      />,
    );
    expect(nestedButtons(container)).toBe(0);
    expect(screen.getByRole('button', { name: /Удалить розетку/ })).toBeInTheDocument();
  });
});
