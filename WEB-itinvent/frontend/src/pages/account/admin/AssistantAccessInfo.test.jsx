import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AssistantAccessInfo, { groupCapabilities, permissionLabel } from './AssistantAccessInfo';
import { aiAssistantCapabilities } from '../../../api/aiAssistantCapabilities';

vi.mock('../../../api/aiAssistantCapabilities', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, aiAssistantCapabilities: { get: vi.fn() } };
});

const theme = createTheme();
const renderPanel = (props = {}) => render(
  <ThemeProvider theme={theme}>
    <AssistantAccessInfo {...props} />
  </ThemeProvider>,
);

beforeEach(() => vi.clearAllMocks());

describe('AssistantAccessInfo', () => {
  it('explains unified access and groups capabilities with permission labels', async () => {
    aiAssistantCapabilities.get.mockResolvedValue({
      assistant: { label: 'HUB Ассистент', required_permission: 'chat.ai.use' },
      source: 'static',
      capabilities: [
        { key: 'kb', group: 'kb', label: 'База знаний: поиск', permissions: ['kb.read'], granted: true },
        { key: 'itinvent.read', group: 'itinvent', label: 'ITinvent: поиск техники', permissions: ['database.read'], granted: false },
        { key: 'ad.read', group: 'ad', label: 'AD: срок пароля', permissions: ['ad_users.read'], it_only: true, granted: false },
        { key: 'itinvent.multi_db', group: 'itinvent', label: 'Мульти-БД поиск', permissions: [], admin_only: true, granted: false },
      ],
    });

    renderPanel();

    expect(await screen.findByText(/доступен всем сотрудникам с правом/i)).toBeInTheDocument();
    expect(screen.getByText('Что умеет ассистент по правам сотрудника')).toBeInTheDocument();
    expect(screen.getByText('База знаний')).toBeInTheDocument();
    expect(screen.getByText('ITinvent')).toBeInTheDocument();
    // Метка права берётся из матрицы прав настроек, а не показывается сырым id.
    expect(screen.getByText('База: просмотр')).toBeInTheDocument();
    expect(screen.getByText('есть у вас')).toBeInTheDocument();
    expect(screen.getAllByText('нет у вас').length).toBeGreaterThan(0);
    expect(screen.getByText('только ИТ')).toBeInTheDocument();
    expect(screen.getByText('только админ')).toBeInTheDocument();
    expect(screen.queryByText(/встроенная карта прав/i)).not.toBeInTheDocument();
  });

  it('falls back to the built-in permission map when the endpoint is unavailable', async () => {
    aiAssistantCapabilities.get.mockRejectedValue(new Error('404'));

    renderPanel();

    expect(await screen.findByText(/встроенная карта прав/i)).toBeInTheDocument();
    expect(screen.getByText('ITinvent: поиск техники, карточки, справочники, история и акты')).toBeInTheDocument();
    expect(screen.getByText('Active Directory')).toBeInTheDocument();
  });

  it('keeps working when the endpoint returns an empty capability list', async () => {
    aiAssistantCapabilities.get.mockResolvedValue({ capabilities: [], source: 'static' });

    renderPanel();

    expect(await screen.findByText('Что умеет ассистент по правам сотрудника')).toBeInTheDocument();
    expect(screen.queryByText('База знаний')).not.toBeInTheDocument();
  });
});

describe('groupCapabilities', () => {
  it('orders known groups and appends unknown ones at the end', () => {
    const groups = groupCapabilities([
      { key: 'x', group: 'custom', label: 'x' },
      { key: 'a', group: 'kb', label: 'a' },
      { key: 'b', group: 'itinvent', label: 'b' },
    ]);

    expect(groups.map((item) => item.group)).toEqual(['kb', 'itinvent', 'custom']);
  });

  it('normalizes missing group and non-array input', () => {
    expect(groupCapabilities(null)).toEqual([]);
    expect(groupCapabilities([{ key: 'k', label: 'row' }])[0].group).toBe('other');
  });
});

describe('permissionLabel', () => {
  it('maps known permission ids to matrix labels and keeps unknown ids', () => {
    expect(permissionLabel('database.read')).toBe('База: просмотр');
    expect(permissionLabel('unknown.permission')).toBe('unknown.permission');
  });
});
