import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CompanyStructure from './CompanyStructure';
import { companyStructureAPI } from '../api/companyStructure';

const setSearchParamsMock = vi.fn();
const notifyApiErrorMock = vi.fn();
const hasPermissionMock = vi.fn(() => false);

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), setSearchParamsMock],
}));

vi.mock('../api/companyStructure', () => ({
  companyStructureAPI: {
    getTree: vi.fn(),
    createNode: vi.fn(),
    getNodePeople: vi.fn(),
    search: vi.fn(),
    searchDepartmentCodes: vi.fn(),
    searchDepartmentNames: vi.fn(),
    searchLeaderCandidates: vi.fn(),
  },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ hasPermission: hasPermissionMock }),
}));

vi.mock('../contexts/NotificationContext', () => ({
  useNotification: () => ({
    notifySuccess: vi.fn(),
    notifyApiError: notifyApiErrorMock,
  }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

const treePayload = {
  items: [
    {
      id: 'root',
      parent_id: null,
      node_type: 'root',
      title: 'Генеральный директор',
      person_name: 'Руководитель Компании',
      person_position: 'Генеральный директор',
      department_codes: [],
      children: [
        {
          id: 'logistics',
          parent_id: 'root',
          node_type: 'directorate',
          title: 'Управление логистики',
          person_name: '',
          person_position: '',
          department_codes: ['D-1'],
          children: [],
        },
      ],
    },
  ],
};

describe('CompanyStructure employee explorer', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    setSearchParamsMock.mockReset();
    notifyApiErrorMock.mockReset();
    hasPermissionMock.mockReturnValue(false);
    companyStructureAPI.getTree.mockReset();
    companyStructureAPI.createNode.mockReset();
    companyStructureAPI.getNodePeople.mockReset();
    companyStructureAPI.search.mockReset();
    companyStructureAPI.searchDepartmentCodes.mockReset();
    companyStructureAPI.searchLeaderCandidates.mockReset();
    companyStructureAPI.getTree.mockResolvedValue(treePayload);
    companyStructureAPI.searchDepartmentCodes.mockResolvedValue({ items: [] });
    companyStructureAPI.getNodePeople.mockResolvedValue({
      items: [
        {
          full_name: 'Иванов Иван Иванович',
          position: 'Специалист',
          department: 'Управление логистики',
          department_location: 'Тюмень',
          work_phones: ['+7 3452 11-22-33'],
          work_emails: ['ivanov@company.test'],
          personal_phones: ['+7 999 00-00-00'],
          personal_emails: ['private@example.test'],
        },
      ],
    });
    companyStructureAPI.searchLeaderCandidates.mockResolvedValue({ items: [] });
  });

  it('keeps search and structure views in one compact toolbar', async () => {
    render(<CompanyStructure />);

    expect(await screen.findByText('Структура компании')).toBeInTheDocument();
    const toolbar = screen.getByTestId('company-structure-toolbar');
    expect(within(toolbar).getByRole('combobox', { name: 'Поиск по структуре компании' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Фокус' })).toBeInTheDocument();
    expect(screen.queryByText('Найдите коллегу, поймите подчинённость и перейдите к нужному подразделению.')).not.toBeInTheDocument();
    expect(screen.getByTestId('company-structure-stage')).toBeInTheDocument();
  });

  it('shows focus hierarchy and only work contacts in the side drawer', async () => {
    render(<CompanyStructure />);

    expect(await screen.findByText('Структура компании')).toBeInTheDocument();
    expect((await screen.findAllByText('Управление логистики')).length).toBeGreaterThan(0);
    await waitFor(() => expect(companyStructureAPI.getNodePeople).toHaveBeenCalledWith('logistics'));
    fireEvent.click(screen.getAllByRole('button', { name: /Сотрудники/ })[0]);

    expect((await screen.findAllByText('+7 3452 11-22-33')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('ivanov@company.test').length).toBeGreaterThan(0);
    expect(screen.queryByText('+7 999 00-00-00')).not.toBeInTheDocument();
    expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
  });

  it('focuses a terminal department and stores it in the URL', async () => {
    render(<CompanyStructure />);
    fireEvent.click(await screen.findByRole('button', { name: /Управление логистики/ }));

    expect(await screen.findByRole('heading', { name: 'Управление логистики' })).toBeInTheDocument();
    expect(screen.queryByText('Отделы')).not.toBeInTheDocument();
    expect(window.location.search).toContain('node=logistics');
    expect(window.location.search).toContain('view=focus');
  });

  it('opens the semantic map as the default admin layout', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'company_structure.write');
    render(<CompanyStructure />);

    fireEvent.click(await screen.findByRole('button', { name: 'Администратор' }));

    expect(screen.getByRole('button', { name: 'Карта' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Автоматически' })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('Вертикальный обзор')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить из ЗУП' })).toBeInTheDocument();
  });

  it('keeps the admin map mounted while refreshing after a card is created', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'company_structure.write');
    let resolveRefresh;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    const newNode = {
      id: 'new-department',
      parent_id: 'logistics',
      node_type: 'department',
      title: 'Новый отдел',
      department_codes: [],
      children: [],
    };
    const refreshedTree = {
      items: [{
        ...treePayload.items[0],
        children: [{
          ...treePayload.items[0].children[0],
          children: [newNode],
        }],
      }],
    };
    companyStructureAPI.getTree.mockReset();
    companyStructureAPI.getTree
      .mockResolvedValueOnce(treePayload)
      .mockReturnValueOnce(refreshPromise);
    companyStructureAPI.createNode.mockResolvedValue(newNode);

    render(<CompanyStructure />);
    fireEvent.click(await screen.findByRole('button', { name: 'Администратор' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить вручную' }));
    fireEvent.change(await screen.findByRole('textbox', { name: /Название карточки/ }), {
      target: { value: 'Новый отдел' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(companyStructureAPI.createNode).toHaveBeenCalled());
    await waitFor(() => expect(companyStructureAPI.getTree).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Автоматически' })).toBeInTheDocument();
    expect(screen.queryByText('Загружаем структуру…')).not.toBeInTheDocument();

    resolveRefresh(refreshedTree);
    expect(await screen.findByText('Новый отдел')).toBeInTheDocument();
  });

  it('opens employees in a drawer without leaving the selected focus', async () => {
    render(<CompanyStructure />);
    fireEvent.click(await screen.findByRole('button', { name: /Управление логистики/ }));
    await waitFor(() => expect(companyStructureAPI.getNodePeople).toHaveBeenCalledWith('logistics'));

    const peopleButtons = screen.getAllByRole('button', { name: /Сотрудники/ });
    fireEvent.click(peopleButtons[peopleButtons.length - 1]);

    expect((await screen.findAllByText('+7 3452 11-22-33')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Управление логистики' })).toBeInTheDocument();
    expect(screen.getAllByText('ivanov@company.test').length).toBeGreaterThan(0);
  });
});
