import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const {
  mockCreateManagedObject,
  mockGetManagement,
  mockSearchEmployees,
  mockUpdateManagedObject,
} = vi.hoisted(() => ({
  mockCreateManagedObject: vi.fn(),
  mockGetManagement: vi.fn(),
  mockSearchEmployees: vi.fn(),
  mockUpdateManagedObject: vi.fn(),
}));

vi.mock('../../api/construction', () => ({
  constructionAPI: {
    createManagedObject: mockCreateManagedObject,
    getManagement: mockGetManagement,
    searchEmployees: mockSearchEmployees,
    updateManagedObject: mockUpdateManagedObject,
  },
}));

import ConstructionObjectSettingsDialog from './ConstructionObjectSettingsDialog';


const group = {
  group_ref: '11111111-1111-1111-1111-111111111111',
  group_name: 'ЕАСИ',
};

function renderDialog(props = {}) {
  return render(
    <ThemeProvider theme={createTheme()}>
      <ConstructionObjectSettingsDialog
        open
        item={{
          object_ref: group.group_ref,
          name: group.group_name,
          kind: 'project',
          source_groups: [group],
        }}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('ConstructionObjectSettingsDialog', () => {
  beforeEach(() => {
    mockCreateManagedObject.mockReset();
    mockGetManagement.mockReset();
    mockSearchEmployees.mockReset();
    mockUpdateManagedObject.mockReset();
    mockGetManagement.mockResolvedValue({ objects: [], available_groups: [group] });
    mockSearchEmployees.mockResolvedValue({ items: [], total: 0, limit: 30 });
    mockCreateManagedObject.mockResolvedValue({ id: 'construction-1', name: 'ЕАСИ', groups: [group] });
  });

  it('creates one managed object from the selected 1C group', async () => {
    const onSaved = vi.fn();
    renderDialog({ onSaved });

    expect(await screen.findByDisplayValue('ЕАСИ')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить объект' }));

    await waitFor(() => {
      expect(mockCreateManagedObject).toHaveBeenCalledWith({
        name: 'ЕАСИ',
        groups: [group],
        roles: [],
      });
    });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'construction-1' }));
  });

  it('shows role history for an existing managed object', async () => {
    mockGetManagement.mockResolvedValue({
      available_groups: [group],
      objects: [{
        id: 'construction-1',
        name: 'ЕАСИ',
        groups: [group],
        team: [],
        role_history: [{
          role_key: 'project_lead',
          employee_code: 'E-1',
          full_name: 'Иванов Иван Иванович',
          valid_from: '2026-08-01T00:00:00Z',
          valid_to: '2026-08-31T00:00:00Z',
        }],
      }],
    });
    renderDialog({
      item: {
        managed_object_id: 'construction-1',
        object_ref: 'managed:construction-1',
        name: 'ЕАСИ',
        kind: 'project',
      },
    });

    expect(await screen.findByText('История назначений (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByText('История назначений (1)'));
    expect(screen.getByText(/Иванов Иван Иванович/)).toBeInTheDocument();
  });
});
