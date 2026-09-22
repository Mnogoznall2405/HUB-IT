import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FeedComposerDialog from './FeedComposerDialog';
import { hubAnnouncementsAPI } from '../../api/hubAnnouncements';

vi.mock('../../api/hubAnnouncements', () => ({
  hubAnnouncementsAPI: {
    getCategories: vi.fn(),
    getTags: vi.fn(),
    createDraft: vi.fn(),
    updateAnnouncement: vi.fn(),
    getAnnouncement: vi.fn(),
    publishAnnouncement: vi.fn(),
    createAnnouncement: vi.fn(),
    uploadAttachment: vi.fn(),
    reorderAttachments: vi.fn(),
    deleteAttachment: vi.fn(),
    buildAttachmentUrl: vi.fn(() => ''),
  },
}));

const recipients = {
  users: [
    { id: 1, full_name: 'Иван Петров', username: 'ipetrov' },
    { id: 2, full_name: 'Мария Сидорова', username: 'msidorova' },
  ],
  roles: [
    { value: 'admin', label: 'Администраторы' },
    { value: 'manager', label: 'Руководители' },
  ],
  departments: [
    { code: 'IT', name: 'ИТ-отдел' },
    { code: 'HR', name: 'Кадры' },
  ],
  cities: [
    { value: 'msk', label: 'Москва' },
    { value: 'spb', label: 'Санкт-Петербург' },
  ],
};

const renderDialog = (props = {}) => render(
  <ThemeProvider theme={createTheme()}>
    <FeedComposerDialog
      open
      post={null}
      recipients={recipients}
      user={{ username: 'admin', full_name: 'Админ' }}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      notifyError={vi.fn()}
      {...props}
    />
  </ThemeProvider>,
);

describe('FeedComposerDialog render', () => {
  let consoleError;
  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    hubAnnouncementsAPI.getCategories.mockResolvedValue({ items: [{ id: 1, name: 'Офис' }] });
    hubAnnouncementsAPI.getTags.mockResolvedValue({ items: [{ name: 'инструкция' }] });
    hubAnnouncementsAPI.createDraft.mockResolvedValue({ id: 'd1' });
    return () => consoleError.mockRestore();
  });

  it('renders without React errors and shows searchable fields', async () => {
    renderDialog();
    expect(await screen.findByText('Аудитория и параметры публикации')).toBeInTheDocument();
    expect(screen.getByLabelText('Аудитория')).toBeInTheDocument();
    expect(screen.getByLabelText('Категория')).toBeInTheDocument();
    expect(screen.getByLabelText('Тип сообщения')).toBeInTheDocument();
    expect(screen.getByLabelText('Теги')).toBeInTheDocument();
    const reactErrors = consoleError.mock.calls.filter((args) => (
      /Warning:|Error:|Invalid/.test(String(args[0] || ''))
    ));
    expect(reactErrors).toEqual([]);
  });

  it.each(['roles', 'users', 'departments', 'cities', 'departments_cities'])(
    'renders audience pickers for scope %s',
    async (scope) => {
      renderDialog({ post: { id: 'p1', status: 'draft', audience_scope: scope } });
      expect(await screen.findByText('Аудитория и параметры публикации')).toBeInTheDocument();
      const reactErrors = consoleError.mock.calls.filter((args) => (
        /Warning:|Error:|Invalid/.test(String(args[0] || ''))
      ));
      expect(reactErrors).toEqual([]);
    },
  );
});
