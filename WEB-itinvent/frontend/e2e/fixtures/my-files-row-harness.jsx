import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, ListItemText, Menu, MenuItem } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../src/theme';
import { FileRow, FolderRow, sharedOpenLabel } from '../../src/components/myFiles/MyFilesListItems';
import FileActionsContextMenu, { getFileActionsAnchorPosition } from '../../src/components/fileActions/FileActionsContextMenu';

window.__calls = { preview: 0, navigate: 0, shared: 0, download: 0, fileMenu: [], folderMenu: [] };

const normalFile = {
  id: 'file-a',
  original_file_name: 'Договор поставки 2026 год подробное наименование.pdf',
  original_size_bytes: 2048,
  status: 'ready',
  retention_days: 30,
  expires_at: '2099-01-01T00:00:00Z',
  owner_username: 'me',
  updated_at: '2026-10-01T10:00:00Z',
};
const sharedFile = {
  id: 'shared-1',
  original_file_name: 'Общий документ с длинным именем.docx',
  original_size_bytes: 4096,
  status: 'ready',
  shared_with_me: true,
  my_role: 'edit',
  owner_username: 'anna',
  updated_at: '2026-10-01T10:00:00Z',
};
const folderA = {
  id: 'folder-a',
  name: 'Документы и отчёты за год',
  file_count: 4,
  updated_at: '2026-10-01T10:00:00Z',
  owner_username: 'me',
};

function Harness() {
  const [fileMenu, setFileMenu] = useState({ item: null, anchorPosition: null });
  const [folderMenu, setFolderMenu] = useState({ folder: null, anchorPosition: null });
  const closeFileMenu = () => setFileMenu({ item: null, anchorPosition: null });
  const closeFolderMenu = () => setFolderMenu({ folder: null, anchorPosition: null });
  const openFileMenu = (event, item) => {
    window.__calls.fileMenu.push(item.id);
    setFileMenu({ item, anchorPosition: getFileActionsAnchorPosition(event) });
  };
  const openFolderMenu = (event, folder) => {
    window.__calls.folderMenu.push(folder.id);
    setFolderMenu({ folder, anchorPosition: getFileActionsAnchorPosition(event) });
  };

  const common = {
    isTrashView: false,
    currentUsername: 'me',
    canWrite: true,
    canShare: true,
    isSelected: false,
    downloading: false,
    fileDragProps: () => ({}),
    openDocumentPreview: () => { window.__calls.preview += 1; },
    openFileActionsMenu: openFileMenu,
    handleRestoreEntry: () => {},
    handlePurgeEntry: () => {},
    handleDownload: () => { window.__calls.download += 1; },
    handleShare: () => {},
    handleDelete: () => {},
    onToggleFavorite: () => {},
    onOpenSharedFile: () => { window.__calls.shared += 1; },
    onOpenVersions: () => {},
    officeEditable: true,
    opensInEditor: false,
    toggleSelected: () => {},
  };

  const sharedWithMeFile = Boolean(fileMenu.item?.shared_with_me);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ width: '100%', p: 1, containerType: 'inline-size' }}>
        <FolderRow
          folder={folderA}
          isTrashView={false}
          currentUsername="me"
          canWrite
          canShare
          isSelected={false}
          isDropTarget={false}
          folderDropProps={() => ({})}
          folderDragProps={() => ({})}
          navigateToFolder={() => { window.__calls.navigate += 1; }}
          openFolderActionsMenu={openFolderMenu}
          openRenameDialog={() => {}}
          handleFolderShare={() => {}}
          onFolderCollaborators={() => {}}
          handleDeleteFolder={() => {}}
          handleRestoreEntry={() => {}}
          handlePurgeEntry={() => {}}
          onToggleFavorite={() => {}}
          toggleSelected={() => {}}
        />
        <FileRow {...common} item={normalFile} />
        <FileRow {...common} item={sharedFile} />
      </Box>
      <FileActionsContextMenu
        open={Boolean(fileMenu.anchorPosition)}
        anchorPosition={fileMenu.anchorPosition}
        fileName={fileMenu.item?.original_file_name || ''}
        canDownload
        onClose={closeFileMenu}
        onDownload={() => { window.__calls.download += 1; }}
        onPreview={sharedWithMeFile ? undefined : () => { window.__calls.preview += 1; }}
        onEditOnline={sharedWithMeFile ? () => { window.__calls.shared += 1; } : undefined}
        editOnlineLabel={sharedWithMeFile ? sharedOpenLabel(fileMenu.item) : 'Редактировать онлайн'}
      />
      <Menu
        open={Boolean(folderMenu.anchorPosition)}
        anchorReference="anchorPosition"
        anchorPosition={folderMenu.anchorPosition || undefined}
        onClose={closeFolderMenu}
      >
        <MenuItem onClick={() => { window.__calls.navigate += 1; closeFolderMenu(); }}>
          <ListItemText>Открыть</ListItemText>
        </MenuItem>
        <MenuItem onClick={closeFolderMenu}><ListItemText>Поделиться</ListItemText></MenuItem>
      </Menu>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
