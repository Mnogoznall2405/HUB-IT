import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    getNodePeople: vi.fn(),
    search: vi.fn(),
    searchDepartmentNames: vi.fn(),
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
    companyStructureAPI.getNodePeople.mockReset();
    companyStructureAPI.search.mockReset();
    companyStructureAPI.getTree.mockResolvedValue(treePayload);
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
  });

  it('shows a drill-down hierarchy and only work contacts', async () => {
    render(<CompanyStructure />);

    expect(await screen.findByText('Структура компании')).toBeInTheDocument();
    expect(await screen.findByText('Управление логистики')).toBeInTheDocument();
    await waitFor(() => expect(companyStructureAPI.getNodePeople).toHaveBeenCalledWith('root'));
    expect(await screen.findByText('+7 3452 11-22-33')).toBeInTheDocument();
    expect(screen.getByText('ivanov@company.test')).toBeInTheDocument();
    expect(screen.queryByText('+7 999 00-00-00')).not.toBeInTheDocument();
    expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText(/Личные данные не публикуются/)).not.toBeInTheDocument();
  });

  it('shows only employees for a terminal department', async () => {
    render(<CompanyStructure />);
    fireEvent.click(await screen.findByRole('button', { name: /Управление логистики/ }));

    expect(await screen.findByRole('heading', { name: 'Сотрудники' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Подразделения' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Это конечное подразделение/)).not.toBeInTheDocument();
  });

  it('opens the visual hierarchy map as the default admin editor', async () => {
    hasPermissionMock.mockImplementation((permission) => permission === 'company_structure.write');
    render(<CompanyStructure />);

    fireEvent.click(await screen.findByRole('button', { name: 'Администратор' }));

    expect(screen.getByRole('button', { name: 'Карта' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Схема подчинённости')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить из ЗУП' })).toBeInTheDocument();
  });

  it('opens employees in a popup when a chart card is selected', async () => {
    render(<CompanyStructure />);
    await screen.findByRole('button', { name: /Управление логистики/ });

    fireEvent.click(screen.getByRole('button', { name: 'Схема' }));
    fireEvent.click(screen.getByRole('button', { name: /Генеральный директор.*Корень/ }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('+7 3452 11-22-33')).toBeInTheDocument();
    expect(screen.getByText('ivanov@company.test')).toBeInTheDocument();
  });
});
