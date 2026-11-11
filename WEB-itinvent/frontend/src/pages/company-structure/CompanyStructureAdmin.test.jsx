import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CompanyStructureAdmin from './CompanyStructureAdmin';
import { companyStructureAPI } from '../../api/companyStructure';

vi.mock('../../api/companyStructure', () => ({
  companyStructureAPI: {
    searchDepartmentCodes: vi.fn(),
    searchDepartmentNames: vi.fn(),
    importFromZup: vi.fn(),
    updateNode: vi.fn(),
  },
}));

vi.mock('./CompanyStructureChart', () => ({
  default: () => <div>Схема</div>,
}));

const ugeNode = {
  id: 'uge',
  parent_id: 'root',
  node_type: 'directorate',
  title: 'УГЭ',
  person_name: '',
  person_position: '',
  department_codes: ['0000-0270'],
  children: [],
};

const tree = [
  {
    id: 'root',
    parent_id: null,
    node_type: 'root',
    title: 'Генеральный директор',
    department_codes: [],
    children: [ugeNode],
  },
];

const codeOptions = [
  {
    department_code: '0000-0270',
    department: 'Управление главного энергетика',
    department_locations: ['Тюмень'],
    people_count: 2,
    binding_group: 'office',
    linked_node_id: 'uge',
    linked_node_title: 'УГЭ',
  },
  {
    department_code: '00ЗК-3176',
    department: 'Управление главного энергетика',
    department_locations: ['Новый Уренгой'],
    people_count: 3,
    binding_group: 'object',
    linked_node_id: null,
    linked_node_title: '',
  },
  {
    department_code: 'MIX-1',
    department: 'Управление главного энергетика',
    department_locations: ['Тюмень', 'Новый Уренгой'],
    people_count: 2,
    binding_group: 'mixed',
    linked_node_id: null,
    linked_node_title: '',
  },
  {
    department_code: 'USED-1',
    department: 'Управление главного энергетика',
    department_locations: ['Уренгой'],
    people_count: 1,
    binding_group: 'object',
    linked_node_id: 'other-card',
    linked_node_title: 'Другая карточка',
  },
];

const importNameOptions = [
  {
    department: 'Управление главного энергетика',
    department_base: 'Управление главного энергетика',
    department_location: 'Тюмень',
    department_locations: ['Тюмень'],
    people_count: 2,
    department_codes: ['0000-0270'],
    binding_group: 'office',
  },
  {
    department: 'Управление главного энергетика объект',
    department_base: 'Управление главного энергетика',
    department_location: 'Новый Уренгой',
    department_locations: ['Новый Уренгой'],
    people_count: 27,
    department_codes: ['00ЗК-3176'],
    binding_group: 'object',
  },
];

describe('CompanyStructureAdmin ZUP code binding', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    companyStructureAPI.searchDepartmentCodes.mockReset();
    companyStructureAPI.searchDepartmentNames.mockReset();
    companyStructureAPI.importFromZup.mockReset();
    companyStructureAPI.updateNode.mockReset();
    companyStructureAPI.searchDepartmentCodes.mockResolvedValue({ items: codeOptions });
    companyStructureAPI.searchDepartmentNames.mockResolvedValue({ items: importNameOptions });
    companyStructureAPI.importFromZup.mockResolvedValue({ created: importNameOptions, skipped: [] });
    companyStructureAPI.updateNode.mockResolvedValue(ugeNode);
  });

  it('shows leader controls only for the general director and deputies', async () => {
    const { rerender } = render(
      <CompanyStructureAdmin
        tree={tree}
        selectedId="uge"
        selectedNode={ugeNode}
        peopleCount={2}
        onSelect={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
        notifySuccess={vi.fn()}
        notifyApiError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(await screen.findByText('Изменить узел')).toBeInTheDocument();
    expect(screen.queryByText('Руководитель карточки')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    rerender(
      <CompanyStructureAdmin
        tree={tree}
        selectedId="root"
        selectedNode={tree[0]}
        peopleCount={2}
        onSelect={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
        notifySuccess={vi.fn()}
        notifyApiError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(await screen.findByText('Руководитель карточки')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Найти руководителя в ЗУП/ })).toBeInTheDocument();
    expect(screen.getByText('Доступно только для генерального директора и заместителей.')).toBeInTheDocument();
  });

  it('keeps typed code search text after async options refresh', async () => {
    render(
      <CompanyStructureAdmin
        tree={tree}
        selectedId="uge"
        selectedNode={ugeNode}
        peopleCount={2}
        onSelect={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
        notifySuccess={vi.fn()}
        notifyApiError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    const input = await screen.findByRole('combobox', { name: /Коды подразделений ЗУП/ });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '00ЗК' } });
    expect(input).toHaveValue('00ЗК');

    await waitFor(() => expect(companyStructureAPI.searchDepartmentCodes).toHaveBeenCalledWith({
      q: '00ЗК',
      limit: 200,
    }));
    await waitFor(() => expect(input).toHaveValue('00ЗК'));
  });

  it('keeps the card title separate and replaces codes with the selected binding group', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <CompanyStructureAdmin
        tree={tree}
        selectedId="uge"
        selectedNode={ugeNode}
        peopleCount={2}
        onSelect={vi.fn()}
        onChanged={onChanged}
        notifySuccess={vi.fn()}
        notifyApiError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));

    await screen.findByText('Изменить узел');
    expect(await screen.findByRole('textbox', { name: /Название карточки/ })).toHaveValue('УГЭ');
    await waitFor(() => expect(companyStructureAPI.searchDepartmentCodes).toHaveBeenCalled());
    expect(await screen.findByText(/Смешанные коды не выбираются автоматически/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Выбрать объект (1)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(companyStructureAPI.updateNode).toHaveBeenCalledWith(
      'uge',
      expect.objectContaining({
        title: 'УГЭ',
        department_codes: ['00ЗК-3176'],
      }),
    ));
    expect(onChanged).toHaveBeenCalledWith('uge');
  });

  it('offers office and object as separate ready-to-import cards', async () => {
    render(
      <CompanyStructureAdmin
        tree={tree}
        selectedId="uge"
        selectedNode={ugeNode}
        peopleCount={2}
        onSelect={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
        notifySuccess={vi.fn()}
        notifyApiError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Добавить из ЗУП' }));
    const input = await screen.findByRole('combobox', { name: 'Подразделения ЗУП' });
    fireEvent.mouseDown(input);

    expect(await screen.findByText('Управление главного энергетика объект')).toBeInTheDocument();
    expect(screen.getByText(/Офис · 2 сотрудников · Тюмень/)).toBeInTheDocument();
    expect(screen.getByText(/Объект · 27 сотрудников · Новый Уренгой/)).toBeInTheDocument();
  });
});
