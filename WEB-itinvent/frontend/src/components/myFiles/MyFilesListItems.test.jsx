import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { FileRow, FolderRow, rowGridColumns } from './MyFilesListItems';

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
  it('hides quick action icons below md while the overflow button stays on all breakpoints', () => {
    const { container } = renderWithTheme(<FileRow {...fileRowProps()} />);
    const overflow = screen.getByRole('button', { name: 'Действия с файлом Отчёт за квартал с длинным названием.xlsx' });
    expect(overflow).toBeInTheDocument();

    // Быстрые действия — плавающая пилюля: видна только на md+ при наведении/фокусе.
    const quickActions = container.querySelector('.row-quick-actions');
    expect(quickActions).toBeTruthy();
    for (const testid of ['my-files-preview-file-1', 'my-files-download-file-1', 'my-files-share-file-1', 'my-files-delete-file-1']) {
      expect(quickActions.querySelector(`[data-testid="${testid}"]`)).toBeTruthy();
    }

    const overlayRules = rulesForElement(quickActions);
    expect(hasRule(overlayRules.media, '@media (min-width:0px)', 'display:none')).toBe(true);
    expect(hasRule(overlayRules.media, '@media (min-width:900px)', 'display:flex')).toBe(true);
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

  it('Enter on a row button bubbles up but does not trigger the row preview/navigation', () => {
    const fileProps = fileRowProps();
    const { container } = renderWithTheme(<FileRow {...fileProps} />);
    const overflow = screen.getByRole('button', { name: `Действия с файлом ${fileProps.item.original_file_name}` });
    // keydown bubbles from the button to the row — Enter must stay with the
    // button (opens the menu via click), not also open the file preview.
    fireEvent.keyDown(overflow, { key: 'Enter' });
    expect(fileProps.openDocumentPreview).not.toHaveBeenCalled();

    const fileRow = overflow.closest('[data-testid^="my-files-card-"]');
    fireEvent.keyDown(fileRow, { key: 'Enter' });
    expect(fileProps.openDocumentPreview).toHaveBeenCalledTimes(1);

    const folderProps = folderRowProps();
    renderWithTheme(<FolderRow {...folderProps} />);
    const folderOverflow = screen.getByRole('button', { name: `Действия с папкой ${folderProps.folder.name}` });
    fireEvent.keyDown(folderOverflow, { key: 'Enter' });
    expect(folderProps.navigateToFolder).not.toHaveBeenCalled();

    const folderRowEl = folderOverflow.closest('[data-testid^="my-files-folder-"]');
    fireEvent.keyDown(folderRowEl, { key: 'Enter' });
    expect(folderProps.navigateToFolder).toHaveBeenCalledTimes(1);
    expect(container).toBeTruthy();
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
    const quickActions = container.querySelector('.row-quick-actions');
    expect(quickActions).toBeTruthy();
    expect(quickActions.querySelector('[data-testid="my-files-shared-edit-shared-1"]')).toBeTruthy();
    expect(quickActions.querySelector('[data-testid="my-files-shared-download-shared-1"]')).toBeTruthy();

    const overflow = screen.getByRole('button', { name: 'Действия с файлом Отчёт за квартал с длинным названием.xlsx' });
    fireEvent.click(overflow);
    expect(props.openFileActionsMenu).toHaveBeenCalledTimes(1);
    expect(props.openFileActionsMenu.mock.calls[0][1]).toBe(props.item);
    expect(props.onOpenSharedFile).not.toHaveBeenCalled();
  });

  it('grid tiers keep the name flexible and hide secondary columns by container width', () => {
    const normal = rowGridColumns(false);
    // Base tier (narrow list): checkbox + name + overflow button only.
    expect(normal.gridTemplateColumns).toBe('40px minmax(0,1fr) 48px');
    // Each wider tier adds exactly one secondary column; the name stays 1fr.
    expect(normal['@container (min-width: 620px)'].gridTemplateColumns)
      .toBe('40px minmax(0,1fr) 160px 48px');
    expect(normal['@container (min-width: 760px)'].gridTemplateColumns)
      .toBe('40px minmax(0,1fr) 160px 96px 48px');
    expect(normal['@container (min-width: 960px)'].gridTemplateColumns)
      .toBe('40px minmax(0,1fr) 140px 160px 96px 48px');
    // The name column never gets a fixed minimum that could overflow the row.
    const allTemplates = [normal, ...Object.values(normal).filter((v) => typeof v === 'object')];
    allTemplates.forEach((tier) => {
      expect(tier.gridTemplateColumns).toContain('minmax(0,1fr)');
      expect(tier.gridTemplateColumns).not.toMatch(/minmax\((?!0,)/); // name has no px floor
    });

    const trash = rowGridColumns(true);
    expect(trash.gridTemplateColumns).toBe('minmax(0,1fr) 80px');
    expect(trash['@container (min-width: 400px)'].gridTemplateColumns).toBe('minmax(0,1fr) 110px 80px');
    expect(trash['@container (min-width: 560px)'].gridTemplateColumns).toBe('minmax(0,1fr) 170px 110px 80px');
  });

  it('row emits real @container CSS for secondary cells (emotion serializes it)', () => {
    renderWithTheme(<FileRow {...fileRowProps()} />);
    const css = Array.from(document.querySelectorAll('style'))
      .map((node) => node.textContent || '')
      .join('\n');
    // If emotion dropped @container the cells would never appear at any width —
    // this guards the mechanism the whole adaptive layout relies on.
    expect(css).toContain('@container (min-width: 620px)');
    expect(css).toContain('@container (min-width: 960px)');
    expect(css).toContain('grid-template-columns:40px minmax(0,1fr) 160px 48px');
  });

  it('trash rows keep restore and purge actions visible without an overflow button', () => {
    const props = fileRowProps({ isTrashView: true });
    const { container } = renderWithTheme(<FileRow {...props} />);
    expect(container.querySelector('.row-actions [data-testid="my-files-restore-file-1"]')).toBeTruthy();
    expect(container.querySelector('.row-actions [data-testid="my-files-purge-file-1"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Действия с файлом/ })).not.toBeInTheDocument();
    expect(container.querySelector('.row-quick-actions')).toBeNull();
  });
});
