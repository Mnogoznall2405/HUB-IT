import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountCategoryLayout from './AccountCategoryLayout';

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../layout/MainLayout', () => ({
  default: ({ children }) => <div data-testid="main-layout">{children}</div>,
}));

vi.mock('../layout/PageShell', () => ({
  default: ({ children }) => <div data-testid="page-shell">{children}</div>,
}));

const categories = [
  { key: 'appearance', label: 'Внешний вид', description: 'Тема и шрифт', icon: <PaletteOutlinedIcon /> },
  { key: 'security', label: 'Безопасность', description: '2FA и passkey', icon: <ShieldOutlinedIcon /> },
];

function installMatchMedia(desktop) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: desktop && query.includes('min-width:900px'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderLayout(activeKey = '') {
  return render(
    <ThemeProvider theme={createTheme()}>
      <AccountCategoryLayout
        title="Настройки"
        description="Персональные параметры"
        categories={categories}
        activeKey={activeKey}
        basePath="/settings"
      >
        <div>Содержимое категории</div>
      </AccountCategoryLayout>
    </ThemeProvider>,
  );
}

describe('AccountCategoryLayout', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('shows a mobile category index and opens a category as a separate route', () => {
    installMatchMedia(false);
    renderLayout();

    expect(screen.getByText('Настройки')).toBeInTheDocument();
    expect(screen.queryByText('Содержимое категории')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('account-category-security'));
    expect(mockNavigate).toHaveBeenCalledWith('/settings/security');
  });

  it('shows desktop master-detail navigation with the active category', () => {
    installMatchMedia(true);
    renderLayout('appearance');

    expect(screen.getByText('Содержимое категории')).toBeInTheDocument();
    expect(screen.getByTestId('account-category-appearance')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('account-category-security')).not.toHaveAttribute('aria-current');
  });
});
