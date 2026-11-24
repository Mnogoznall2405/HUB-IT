import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import MyFilesSidebar from './MyFilesSidebar';

const LIB = { id: 'lib-1', name: 'Отдел ИТ' };
const LIB2 = { id: 'lib-2', name: 'Подбор' };

// Real parent_id chain inside the library: a → b → c → d.
const CHAIN = [
  { id: 'a', name: 'Корень', parent_id: null, library_id: 'lib-1' },
  { id: 'b', name: 'Уровень 2', parent_id: 'a', library_id: 'lib-1' },
  { id: 'c', name: 'Уровень 3', parent_id: 'b', library_id: 'lib-1' },
  { id: 'd', name: 'Уровень 4', parent_id: 'c', library_id: 'lib-1' },
];

const baseProps = {
  officeEnabled: false,
  onCreateFolder: vi.fn(),
  onUploadFiles: vi.fn(),
  onUploadFolder: vi.fn(),
  navigateToView: vi.fn(),
  navigateToTrash: vi.fn(),
  libraries: [LIB, LIB2],
  canManageLibraries: false,
  activeLibraryId: 'lib-1',
  onLibraryOpen: vi.fn(),
  libraryFolders: CHAIN,
  currentFolderId: null,
  onLibraryFolderOpen: vi.fn(),
};

const renderSidebar = (props = {}) => render(<MyFilesSidebar {...baseProps} {...props} />);

describe('MyFilesSidebar library tree', () => {
  it('auto-expands the whole ancestor chain of the open folder, deep nesting included', async () => {
    renderSidebar({ currentFolderId: 'd' });
    await waitFor(() => expect(screen.getByTestId('my-files-tree-folder-d')).toBeInTheDocument());
    for (const id of ['a', 'b', 'c']) {
      expect(screen.getByTestId(`my-files-tree-toggle-${id}`)).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('re-expands ancestors above a middle node that was left expanded under a collapsed root', async () => {
    const { rerender } = renderSidebar({ currentFolderId: null });
    // User expands a, then b, then folds a back — the set keeps {b} while the
    // visible chain is broken at a.
    fireEvent.click(screen.getByTestId('my-files-tree-toggle-a'));
    fireEvent.click(screen.getByTestId('my-files-tree-toggle-b'));
    fireEvent.click(screen.getByTestId('my-files-tree-toggle-a'));
    expect(screen.queryByTestId('my-files-tree-folder-b')).not.toBeInTheDocument();

    // Deep navigation into d must restore the WHOLE chain, not stop at b.
    rerender(<MyFilesSidebar {...baseProps} currentFolderId="d" />);
    await waitFor(() => expect(screen.getByTestId('my-files-tree-folder-d')).toBeInTheDocument());
    for (const id of ['a', 'b', 'c']) {
      expect(screen.getByTestId(`my-files-tree-toggle-${id}`)).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('keeps a manual collapse: folding the root hides the subtree until the next navigation', async () => {
    renderSidebar({ currentFolderId: 'd' });
    await screen.findByTestId('my-files-tree-folder-d');

    fireEvent.click(screen.getByTestId('my-files-tree-toggle-a'));
    expect(screen.getByTestId('my-files-tree-toggle-a')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('my-files-tree-folder-b')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-tree-folder-d')).not.toBeInTheDocument();
  });

  it('opens a folder from the tree through the same callback as the list', async () => {
    const onLibraryFolderOpen = vi.fn();
    renderSidebar({ currentFolderId: 'b', onLibraryFolderOpen });
    await screen.findByTestId('my-files-tree-folder-b');
    fireEvent.click(screen.getByTestId('my-files-tree-folder-b'));
    expect(onLibraryFolderOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('shows the tree only under the active library and drops it on switch', async () => {
    const { rerender } = renderSidebar({ currentFolderId: 'b' });
    await screen.findByTestId('my-files-tree-folder-b');

    rerender(<MyFilesSidebar {...baseProps} activeLibraryId="lib-2" libraryFolders={[]} currentFolderId={null} />);
    expect(screen.queryByTestId('my-files-tree-folder-a')).not.toBeInTheDocument();
    expect(screen.queryByTestId('my-files-tree-folder-b')).not.toBeInTheDocument();
  });

  it('keeps libraries reachable from the collapsed icon rail flyout', async () => {
    const onLibraryOpen = vi.fn();
    renderSidebar({ collapsed: true, onToggleCollapse: vi.fn(), libraryFolders: [], onLibraryOpen });

    fireEvent.click(screen.getByTestId('my-files-libraries-flyout'));
    const item = await screen.findByTestId('my-files-library-lib-2');
    fireEvent.click(item);
    expect(onLibraryOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib-2' }));
  });
});
