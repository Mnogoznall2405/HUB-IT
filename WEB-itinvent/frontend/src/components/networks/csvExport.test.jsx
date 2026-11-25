import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EquipmentTab from './EquipmentTab';

const props = (ports) => ({
  isMobile: false,
  canEdit: false,
  isBranchWidePortSearch: false,
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
  socketAutocompleteOptions: [],
  socketKey: (v) => String(v || ''),
  openCreateDeviceDialog: vi.fn(),
  openEditDeviceDialog: vi.fn(),
  setSelectedDeviceId: vi.fn(),
  handlePortRowClick: vi.fn(),
  startEditPort: vi.fn(),
  updatePortDraftField: vi.fn(),
  savePortEdit: vi.fn(),
  setSelectedSocketId: vi.fn(),
});

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: !query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

describe('CSV export sanitization', () => {
  it('quotes fields and neutralizes spreadsheet formulas', () => {
    let href = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      href = this.getAttribute('href');
    });
    render(
      <EquipmentTab
        {...props([
          {
            id: 1,
            device_code: 'SW-01',
            port_name: '=2+5',
            patch_panel_port: 'PP-"1";x',
            location_code: 'Офис',
            fio: '+cmd',
          },
        ])}
      />,
    );

    fireEvent.click(screen.getByTestId('DownloadIcon').closest('button'));

    const csv = decodeURIComponent(href.replace(/^data:text\/csv;charset=utf-8,/, ''));
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain(`"'=2+5"`);
    expect(dataRow).toContain(`"'+cmd"`);
    expect(dataRow).toContain('"PP-""1"";x"');
    expect(dataRow.startsWith('"SW-01";"\'=2+5";')).toBe(true);
  });
});
