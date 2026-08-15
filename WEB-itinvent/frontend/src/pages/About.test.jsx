import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const aboutMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  navigate: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock('../api/client', () => ({
  authAPI: { completeAboutOnboarding: aboutMocks.complete },
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ refreshSession: aboutMocks.refreshSession }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => aboutMocks.navigate };
});

vi.mock('../components/desktop/DesktopInstallerDownload', () => ({
  default: () => <a href="/desktop-updates/stable/test.exe">Скачать для Windows</a>,
}));

import About from './About';

describe('About page', () => {
  afterEach(() => {
    document.querySelector('meta[name="robots"]')?.remove();
    aboutMocks.complete.mockReset();
    aboutMocks.navigate.mockReset();
    aboutMocks.refreshSession.mockReset();
    window.sessionStorage.clear();
  });

  it('presents real anonymized desktop, mobile and Windows Desktop screens', () => {
    const { container } = render(<About />);

    expect(screen.getByRole('heading', { level: 1, name: /Все рабочие сервисы/i })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Перейти в HUB/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Перейти к содержанию' })).toHaveAttribute('href', '#about-main');
    expect(screen.getByRole('heading', { name: 'Личные беседы и групповые чаты' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Диалог, чек-лист и материалы внутри задачи' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'HUB адаптируется к экрану телефона' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'HUB в отдельном приложении для Windows' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Доступ к разделам зависит от роли' })).toBeInTheDocument();
    expect(screen.getByText(/подтверждение по PIN-коду либо биометрии/i)).toBeInTheDocument();
    expect(screen.queryByText(/Доступ к работе — не к лишней информации/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ровно два отсутствующих сотрудника/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/системного tray/i)).not.toBeInTheDocument();

    const imageSources = screen.getAllByRole('img')
      .map((image) => image.getAttribute('src'))
      .filter(Boolean);

    expect(imageSources).toEqual(expect.arrayContaining([
      '/about/dashboard-desktop-dark@2x.png',
      '/about/chat-group-desktop-dark@2x.png',
      '/about/task-discussion-desktop-dark@2x.png',
      '/about/dashboard-mobile-dark@3x.png',
      '/about/chat-mobile-dark@3x.png',
      '/about/task-mobile-dark@3x.png',
      '/about/menu-mobile-dark@3x.png',
      '/about/hub-desktop-window-dark.png',
    ]));

    expect(container.querySelector('img[src="/about/dashboard-desktop-dark@2x.png"]')).toHaveAttribute(
      'srcset',
      expect.stringContaining('/about/dashboard-desktop-dark.png 1440w'),
    );
    expect(container.querySelector('img[src="/about/dashboard-desktop-dark@2x.png"]')).toHaveAttribute(
      'srcset',
      expect.stringContaining('/about/dashboard-desktop-dark@1920w.png 1920w'),
    );
    expect(container.querySelector('source[srcset*="dashboard-mobile-dark@3x.png"]')).toBeInTheDocument();
    expect(screen.getByText('На всех экранах показаны вымышленные сотрудники и тестовые данные.')).toBeInTheDocument();
    expect(container.querySelectorAll('.about-mobile-card figcaption')).toHaveLength(0);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  });

  it('switches product tools without leaving the page', () => {
    render(<About />);

    expect(screen.getByRole('heading', { name: 'Почта без переключения между окнами' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Файлы' }));

    expect(screen.getByRole('tab', { name: 'Файлы' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Рабочие файлы всегда под рукой' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Раздел файлов HUB-IT/i })).toHaveAttribute(
      'src',
      '/about/files-desktop-dark@2x.png',
    );
  });

  it('opens a labeled image viewer and returns focus after closing', () => {
    render(<About />);

    const trigger = screen.getByRole('button', { name: /Увеличить изображение: Главная страница HUB-IT/i });
    fireEvent.click(trigger);

    const dialog = screen.getAllByRole('dialog').find((candidate) => candidate.hasAttribute('open'));
    expect(dialog).toBeDefined();
    expect(dialog).toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть просмотр' }));

    expect(dialog).not.toHaveAttribute('open');
    expect(trigger).toHaveFocus();
  });

  it('completes onboarding and returns to the requested internal route', async () => {
    window.sessionStorage.setItem('hubit.auth.return-to', '/shared-files/test-token');
    aboutMocks.complete.mockResolvedValue({ about_onboarding_completed_at: '2026-08-13T10:00:00Z' });
    aboutMocks.refreshSession.mockResolvedValue({ about_onboarding_completed_at: '2026-08-13T10:00:00Z' });
    render(<About />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Перейти в HUB' })[0]);

    await waitFor(() => {
      expect(aboutMocks.complete).toHaveBeenCalledTimes(1);
      expect(aboutMocks.refreshSession).toHaveBeenCalledWith({ suppressAuthRequired: true });
      expect(aboutMocks.navigate).toHaveBeenCalledWith('/shared-files/test-token', { replace: true });
    });
  });

  it('shows a stable error and stays on the presentation when saving fails', async () => {
    aboutMocks.complete.mockRejectedValue(new Error('offline'));
    render(<About />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Перейти в HUB' })[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Не удалось сохранить. Проверьте подключение и повторите попытку.',
    );
    expect(aboutMocks.navigate).not.toHaveBeenCalled();
  });

  it('renders inside settings without onboarding actions or a public header and footer', () => {
    const { container } = render(<About mode="embedded" />);

    expect(container.querySelector('.about-header')).not.toBeInTheDocument();
    expect(container.querySelector('.about-footer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Перейти в HUB' })).not.toBeInTheDocument();
    expect(container.querySelector('.about-page--embedded')).toBeInTheDocument();
  });
});
