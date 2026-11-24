import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EquipmentTab from './EquipmentTab';
import SocketsTab from './SocketsTab';

const CARD_COUNT = 250;

const mockMobileMatchMedia = () => {
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

const makePorts = (count) => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  patch_panel_port: `PP-${index + 1}`,
  device_code: 'SW-01',
  port_name: `p${index + 1}`,
  location_code: 'Офис',
  vlan_raw: '10',
  endpoint_ip_raw: '10.0.0.1',
  endpoint_mac_raw: 'AA:BB:CC:00:00:01',
  fio: '',
}));

const makeSockets = (count) => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  socket_code: `S-${index + 1}`,
  device_code: 'SW-01',
  port_name: `p${index + 1}`,
  location_code: 'Офис',
  vlan_raw: '10',
  endpoint_ip_raw: '10.0.0.1',
  endpoint_mac_raw: 'AA:BB:CC:00:00:01',
  mac_address: '',
  fio: '',
}));

const equipmentProps = (ports) => ({
  isMobile: true,
  canEdit: false,
  isBranchWidePortSearch: false,
  selectedBranch: null,
  devices: [],
  devicePortCounts: new Map(),
  selectedDeviceId: null,
  selectedDevice: null,
  matchedDeviceIds: new Set(),
  matchedDevicePortCount: new Map(),
  portSearch: '',
  setPortSearch: vi.fn(),
  displayedPorts: ports,
  branchPortLoading: false,
  editingPortId: null,
  portDraft: {},
  portSaving: false,
  socketAutocompleteOpen: false,
  setSocketAutocompleteOpen: vi.fn(),
  socketAutocompleteOptions: [],
  socketKey: (value) => String(value || '').trim().toLowerCase(),
  openCreateDeviceDialog: vi.fn(),
  openEditDeviceDialog: vi.fn(),
  setSelectedDeviceId: vi.fn(),
  setDeviceChipRef: vi.fn(),
  handlePortRowClick: vi.fn(),
  startEditPort: vi.fn(),
  cancelEditPort: vi.fn(),
  updatePortDraftField: vi.fn(),
  savePortEdit: vi.fn(),
  setSelectedSocketId: vi.fn(),
});

const socketProps = (sockets) => ({
  canEdit: false,
  socketSearch: '',
  setSocketSearch: vi.fn(),
  filteredSockets: sockets,
  handleSocketRowClick: vi.fn(),
  onCreateSocket: vi.fn(),
  onDeleteSocket: vi.fn(),
  deletingSocketId: null,
});

const cardCount = (container) => container.querySelectorAll('.MuiCard-root').length;

beforeEach(mockMobileMatchMedia);

describe('mobile card render window', () => {
  it('EquipmentTab renders the first chunk and extends it via "Показать ещё"', () => {
    const { container, getByRole, queryByRole } = render(
      <EquipmentTab {...equipmentProps(makePorts(CARD_COUNT))} />,
    );

    expect(cardCount(container)).toBe(100);
    fireEvent.click(getByRole('button', { name: 'Показать ещё 100 из 150' }));
    expect(cardCount(container)).toBe(200);
    fireEvent.click(getByRole('button', { name: 'Показать ещё 50 из 50' }));
    expect(cardCount(container)).toBe(CARD_COUNT);
    expect(queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument();
  });

  it('SocketsTab renders the first chunk and extends it via "Показать ещё"', () => {
    const { container, getByRole, queryByRole } = render(
      <SocketsTab {...socketProps(makeSockets(CARD_COUNT))} />,
    );

    expect(cardCount(container)).toBe(100);
    fireEvent.click(getByRole('button', { name: 'Показать ещё 100 из 150' }));
    expect(cardCount(container)).toBe(200);
    fireEvent.click(getByRole('button', { name: 'Показать ещё 50 из 50' }));
    expect(cardCount(container)).toBe(CARD_COUNT);
    expect(queryByRole('button', { name: /Показать ещё/ })).not.toBeInTheDocument();
  });

  it('resets the window when the filtered list changes', () => {
    const props = socketProps(makeSockets(CARD_COUNT));
    const { container, getByRole, rerender } = render(<SocketsTab {...props} />);
    fireEvent.click(getByRole('button', { name: 'Показать ещё 100 из 150' }));
    expect(cardCount(container)).toBe(200);

    rerender(<SocketsTab {...props} filteredSockets={makeSockets(120)} />);
    expect(cardCount(container)).toBe(100);
  });
});
