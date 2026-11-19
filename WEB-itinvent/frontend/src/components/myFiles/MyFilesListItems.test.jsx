import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { FileRow, FolderRow } from './MyFilesListItems';

const theme = createTheme();
const renderWithTheme = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

const file = (overrides = {}) => ({
  id: 'file-1',
  original_file_name: 'Отчёт за квартал с длинным названием.xlsx',
  original_size_bytes: 1024,
  status: 'ready',
  retention_days: 30,
  expires_at: '2099-01-01T00:00:00Z',
  owner_username: 'me',
  ...overrides,
});

const folder = (overrides = {}) => ({
  id: 'folder-1',
  name: 'Документы проекта',
  file_count: 3,
  updated_at: '2026-10-01T10:00:00Z',
  owner_username: 'me',
  ...overrides,
});

const fileRowProps = (overrides = {}) => ({
  item: file(),
  isTrashView: false,
  currentUsername: 'me',
  canWrite: true,
  canShare: true,
  isSelected: false,
  downloading: false,
  fileDragProps: () => ({}),
  openDocumentPreview: vi.fn(),
  openFileActionsMenu: vi.fn(),
  handleRestoreEntry: vi.fn(),
  handlePurgeEntry: vi.fn(),
  handleDownload: vi.fn(),
  handleShare: vi.fn(),
  handleDelete: vi.fn(),
  onToggleFavorite: vi.fn(),
  onOpenSharedFile: vi.fn(),
  onOpenVersions: vi.fn(),
  officeEditable: false,
  opensInEditor: false,
  toggleSelected: vi.fn(),
  ...overrides,
});

const folderRowProps = (overrides = {}) => ({
  folder: folder(),
  isTrashView: false,
  currentUsername: 'me',
  canWrite: true,
  canShare: true,
  isSelected: false,
  isDropTarget: false,
  folderDropProps: () => ({}),
  folderDragProps: () => ({}),
  navigateToFolder: vi.fn(),
  openFolderActionsMenu: vi.fn(),
  openRenameDialog: vi.fn(),
  handleFolderShare: vi.fn(),
  onFolderCollaborators: vi.fn(),
  handleDeleteFolder: vi.fn(),
  handleRestoreEntry: vi.fn(),
  handlePurgeEntry: vi.fn(),
  onToggleFavorite: vi.fn(),
  toggleSelected: vi.fn(),
  ...overrides,
});

// jsdom cannot evaluate media queries, so inspect the generated CSS rules for a
// given element's Emotion classes: base rules live outside @media blocks,
// breakpoint overrides inside them.
const rulesForElement = (element) => {
  const css = Array.from(document.querySelectorAll('style'))
    .map((node) => node.textContent || '')
    .join('\n');
  const mediaBlocks = [];
  const baseCss = css.replace(/@media[^{}]*\{(?:[^{}]|\{[^{}]*\})*\}/g, (block) => {
    mediaBlocks.push(block);
    return '';
  });
  const classes = String(element?.className || '')
    .split(/\s+/)
    .filter((cls) => cls.startsWith('css-'));
  const base = [];
  classes.forEach((cls) => {
    const re = new RegExp(`\\.${cls}[^{}]*\\{([^{}]*)\\}`, 'g');
    [...baseCss.matchAll(re)].forEach((m) => base.push(m[1]));
  });
  const media = mediaBlocks.filter((block) => classes.some((cls) => block.includes(`.${cls}`)));
  return { base: base.join(' '), media };
};

const hasRule = (blocks, query, declaration) =>
  blocks.some((block) => block.includes(query) && block.includes(declaration));

describe('MyFiles mobile list rows', () => {
  it('hides file action icons below md and shows a single overflow button', () => {
    const { container } = renderWithTheme(<FileRow {...fileRowProps()} />);
    const overflow = screen.getByRole('button', { name: 'Действия с файлом Отчёт за квартал с длинным названием.xlsx' });
    expect(overflow).toBeInTheDocument();

    const desktopActions = container.querySelector('.row-actions > div');
    expect(desktopActions).toBeTruthy();
    for (const testid of ['my-files-preview-file-1', 'my-files-download-file-1', 'my-files-share-file-1', 'my-files-delete-file-1']) {
      expect(desktopActions.querySelector(`[data-testid="${testid}"]`)).toBeTruthy();
    }

    const wrapperRules = rulesForElement(desktopActions);
    expect(hasRule(wrapperRules.media, '@media (min-width:0px)', 'display:none')).toBe(true);
    expect(hasRule(wrapperRules.media, '@media (min-width:900px)', 'display:flex')).toBe(true);

    const overflowRules = rulesForElement(overflow);
    expect(hasRule(overflowRules.media, '@media (min-width:0px)', 'inline-flex')).toBe(true);
    expect(hasRule(overflowRules.media, '@media (min-width:900px)', 'display:none')).toBe(true);
  });

  it('file overflow button opens the actions menu without opening the file', () => {
    const props = fileRowProps();
    renderWithTheme(<FileRow {...props} />);
    const overflow = screen.getByRole('button', { name: `Действия с файлом ${props.item.original_file_name}` });
    fireEvent.click(overflow);
    expect(props.openFileActionsMenu).toHaveBeenCalledTimes(1);
    expect(props.openFileActionsMenu.mock.calls[0][1]).toBe(props.item);
    expect(props.openDocumentPreview).not.toHaveBeenCalled();
    expect(props.onOpenSharedFile).not.toHaveBeenCalled();
  });

  it('folder row uses an xs-only overflow button that does not navigate', () => {
    const props = folderRowProps();
    renderWithTheme(<FolderRow {...props} />);
    const overflow = screen.getByRole('button', { name: `Действия с папкой ${props.folder.name}` });
    fireEvent.click(overflow);
    expect(props.openFolderActionsMenu).toHaveBeenCalledTimes(1);
    expect(props.openFolderActionsMenu.mock.calls[0][1]).toBe(props.folder);
    expect(props.navigateToFolder).not.toHaveBeenCalled();
  });

  it('shared-with-me file row keeps actions reachable through the overflow menu', () => {
    const props = fileRowProps({
      item: file({ id: 'shared-1', shared_with_me: true, my_role: 'edit', owner_username: 'anna' }),
      officeEditable: true,
    });
    const { container } = renderWithTheme(<FileRow {...props} />);
    const desktopActions = container.querySelector('.row-actions > div');
    expect(desktopActions).toBeTruthy();
    expect(desktopActions.querySelector('[data-testid="my-files-shared-edit-shared-1"]')).toBeTruthy();
    expect(desktopActions.querySelector('[data-testid="my-files-shared-download-shared-1"]')).toBeTruthy();

    const overflow = screen.getByRole('button', { name: 'Действия с файлом Отчёт за квартал с длинным названием.xlsx' });
    fireEvent.click(overflow);
    expect(props.openFileActionsMenu).toHaveBeenCalledTimes(1);
    expect(props.openFileActionsMenu.mock.calls[0][1]).toBe(props.item);
    expect(props.onOpenSharedFile).not.toHaveBeenCalled();
  });

  it('trash rows keep restore and purge actions visible without an overflow button', () => {
    const props = fileRowProps({ isTrashView: true });
    const { container } = renderWithTheme(<FileRow {...props} />);
    expect(container.querySelector('.row-actions [data-testid="my-files-restore-file-1"]')).toBeTruthy();
    expect(container.querySelector('.row-actions [data-testid="my-files-purge-file-1"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Действия с файлом/ })).not.toBeInTheDocument();
    expect(container.querySelector('.row-actions > div')).toBeNull();
  });
});
