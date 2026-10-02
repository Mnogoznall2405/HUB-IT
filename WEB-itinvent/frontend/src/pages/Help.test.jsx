import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Help from './Help';

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(() => true),
  user: { role: 'admin' },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user, hasPermission: mocks.hasPermission }),
}));

vi.mock('../components/layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../components/layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

vi.mock('../components/layout/MobileShellPageHeader', () => ({
  default: () => null,
}));

const renderHelp = () => render(
  <MemoryRouter>
    <Help />
  </MemoryRouter>,
);

const withPermissions = (...permissions) => {
  const set = new Set(permissions);
  mocks.hasPermission.mockImplementation((permission) => set.has(permission));
};

describe('Help page', () => {
  beforeEach(() => {
    mocks.user = { role: 'admin' };
    mocks.hasPermission.mockReset();
    mocks.hasPermission.mockImplementation(() => true);
  });

  it('renders topic cards with counters and the support contact card', () => {
    renderHelp();

    expect(screen.getByText('Чем помочь?')).toBeInTheDocument();
    expect(screen.getByText('Первый вход')).toBeInTheDocument();
    expect(screen.getByText('Разделы HUB')).toBeInTheDocument();
    expect(screen.getByText('Частые вопросы')).toBeInTheDocument();
    expect(screen.getByText('5 шагов')).toBeInTheDocument();
    expect(screen.getByText('Нужна помощь?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'it@zsgp.ru' })).toHaveAttribute('href', 'mailto:it@zsgp.ru');
    expect(screen.getByRole('link', { name: '«О HUB»' })).toHaveAttribute('href', '/settings/about');
  });

  it('opens a topic guide with numbered steps, screenshot and settings links', async () => {
    renderHelp();

    fireEvent.click(screen.getByRole('button', { name: /Первый вход/ }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Откройте HUB')).toBeInTheDocument();
    expect(screen.getByText('Привяжите устройство')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Главная страница HUB-IT/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Настройки → Безопасность/ })).toHaveAttribute('href', '/settings/security');

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('filters answers across all topics when searching', () => {
    renderHelp();

    fireEvent.change(screen.getByLabelText('Поиск по справке и базе знаний'), { target: { value: 'уведомлен' } });

    expect(screen.getByText(/Не приходят уведомления/i)).toBeInTheDocument();
    expect(screen.queryByText('Первый вход')).not.toBeInTheDocument();
  });

  it('hides permission-gated topics and items from a basic viewer', () => {
    withPermissions('dashboard.read', 'tasks.read');
    renderHelp();

    expect(screen.queryByText('Почта в HUB Desktop')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Разделы HUB/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Задачи')).toBeInTheDocument();
    expect(screen.getByText('Лента')).toBeInTheDocument();
    expect(screen.getByText(/Откройте задачу — внутри срок/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Открыть раздел/ })[0]).toHaveAttribute('href', '/dashboard');
    expect(screen.queryByText('Почта')).not.toBeInTheDocument();
    expect(screen.queryByText('Документооборот')).not.toBeInTheDocument();
  });

  it('shows mail and docflow content when permissions exist', () => {
    withPermissions('dashboard.read', 'mail.access', 'docflow.read');
    renderHelp();

    expect(screen.getByText('Почта в HUB Desktop')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Частые вопросы/ }));
    expect(screen.getByText(/пароль 1С/i)).toBeInTheDocument();
  });
});
