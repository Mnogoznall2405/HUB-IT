import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TablePagination, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import RefreshIcon from '@mui/icons-material/Refresh';
import RestoreIcon from '@mui/icons-material/Restore';

import { myFilesAdminAPI } from '../../../api/myFilesAdmin';
import { myFilesAPI } from '../../../api/myFiles';
import { myFilesOfficeAPI } from '../../../api/myFilesOffice';
import { useAuth } from '../../../contexts/AuthContext';
import { useNotification } from '../../../contexts/NotificationContext';
import FileActionsContextMenu from '../../../components/fileActions/FileActionsContextMenu';
import DocumentPreviewDialog from '../../../components/documentPreview/DocumentPreviewDialog';
import MyFilesOfficeEditorDialog from '../../../components/myFiles/MyFilesOfficeEditorDialog';
import MyFilesCollaboratorsDialog from '../../../components/myFiles/MyFilesCollaboratorsDialog';
import MyFilesVersionsDialog from '../../../components/myFiles/MyFilesVersionsDialog';
import MyFileAuditDialog from '../../../components/myFiles/MyFileAuditDialog';
import MyFilesShareDialog from '../../../components/myFiles/MyFilesShareDialog';
import { useMyFilesDownload } from '../../myFiles/useMyFilesDownload';
import { useMyFilesShares } from '../../myFiles/useMyFilesShares';
import { useMyFilesPreviewController } from '../../myFiles/useMyFilesPreviewController';
import { formatFileSize, getMyFileName } from '../../../lib/myFilesPreview';

const isOffice = file => /\.(docx|xlsx|pptx)$/i.test(getMyFileName(file));
const failure = error => typeof error?.response?.data?.detail === 'string' ? error.response.data.detail : 'Не удалось получить файлы. Повторите запрос.';

export default function MyFilesAdminBrowser({ initialOwner = null }) {
  const { user } = useAuth();
  const account = String(user?.id ?? '');
  const admin = String(user?.role || '').toLowerCase() === 'admin';
  const alive = useRef(false);
  const identity = useRef({ account, admin });
  identity.current = { account, admin };
  const isCurrent = useCallback(() => alive.current && identity.current.admin && identity.current.account === account, [account]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const notices = useNotification();
  const notifySuccess = useCallback((...args) => { if (isCurrent()) notices.notifySuccess(...args); }, [isCurrent, notices.notifySuccess]);
  const notifyWarning = useCallback((...args) => { if (isCurrent()) notices.notifyWarning(...args); }, [isCurrent, notices.notifyWarning]);
  const notifyApiError = useCallback((...args) => { if (isCurrent()) notices.notifyApiError(...args); }, [isCurrent, notices.notifyApiError]);
  const { downloadFile, downloadingFileId } = useMyFilesDownload({ notifySuccess, notifyWarning, notifyApiError, isCurrent });
  const preview = useMyFilesPreviewController({ downloadFile });
  const [filters, setFilters] = useState({ q: '', scope: 'all', state: 'active', page: 0, size: 25 });
  const [model, setModel] = useState({ items: [], total: 0, key: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const [officeEnabled, setOfficeEnabled] = useState(false);
  const [menu, setMenu] = useState(null);
  const [officeFile, setOfficeFile] = useState(null);
  const [accessFile, setAccessFile] = useState(null);
  const [versionsFile, setVersionsFile] = useState(null);
  const [auditFile, setAuditFile] = useState(null);
  const [action, setAction] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const operation = useRef(false);
  const key = JSON.stringify([account, filters, initialOwner?.user_id || null]);
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    if (!admin) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(async () => {
      try {
        const data = await myFilesAdminAPI.listFiles({ q: filters.q.trim(), ownerUserId: initialOwner?.user_id,
          scope: filters.scope, state: filters.state, limit: filters.size, offset: filters.page * filters.size, signal: controller.signal });
        if (!Array.isArray(data?.items) || !Number.isInteger(data.total) || data.total < 0) throw new Error('Некорректный список файлов');
        if (!controller.signal.aborted && isCurrent()) setModel({ items: data.items, total: data.total, key });
      } catch (err) {
        if (!controller.signal.aborted && isCurrent()) setError(failure(err));
      } finally {
        if (!controller.signal.aborted && isCurrent()) setLoading(false);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [admin, filters, initialOwner?.user_id, isCurrent, key, tick]);
  useEffect(() => {
    const controller = new AbortController();
    myFilesOfficeAPI.getStatus({ signal: controller.signal })
      .then(data => { if (!controller.signal.aborted && isCurrent()) setOfficeEnabled(data?.enabled === true); })
      .catch(() => {});
    return () => controller.abort();
  }, [isCurrent]);

  const changeFilter = (field, value) => setFilters(previous => ({ ...previous, [field]: value, page: 0 }));
  const updateRow = useCallback(async fileId => {
    const requestKey = currentKey.current;
    try {
      const file = await myFilesAdminAPI.getFile(fileId);
      if (!isCurrent() || currentKey.current !== requestKey) return;
      if (String(file?.id) !== String(fileId)) throw new Error('HUB не подтвердил карточку файла');
      setModel(previous => {
        if (previous.key !== requestKey) return previous;
        const stateMatches = filters.state === 'all' || (filters.state === 'trash' ? Boolean(file.deleted_at) : !file.deleted_at);
        const needle = filters.q.trim().toLowerCase();
        const queryMatches = !needle || [file.original_file_name, file.owner_label, file.owner_username,
          file.uploaded_by_username, file.folder_name, file.library_name].some(value => String(value || '').toLowerCase().includes(needle));
        const visible = stateMatches && queryMatches;
        const removed = !visible && previous.items.some(row => row.id === file.id);
        return { ...previous, items: visible ? previous.items.map(row => row.id === file.id ? file : row)
          : previous.items.filter(row => row.id !== file.id), total: previous.total - (removed ? 1 : 0) };
      });
    } catch (err) { notifyApiError(err, 'Действие выполнено, но карточку файла не удалось обновить.'); }
  }, [filters.state, filters.q, isCurrent, notifyApiError]);
  const onShareChanged = useCallback(fileId => { void updateRow(fileId); }, [updateRow]);
  const sharing = useMyFilesShares({ notifySuccess, notifyWarning, notifyApiError, isCurrent, onFileShareChanged: onShareChanged });
  const beginAction = (kind, file) => {
    setAction({ kind, file });
    const suffix = /\.[^.]+$/.exec(getMyFileName(file))?.[0] || '';
    setName(suffix ? getMyFileName(file).slice(0, -suffix.length) : getMyFileName(file));
    setActionError('');
  };
  const confirmAction = async event => {
    event.preventDefault();
    if (!action || operation.current || !isCurrent()) return;
    if (action.kind === 'rename' && !name.trim()) { setActionError('Укажите имя файла.'); return; }
    operation.current = true;
    setSaving(true);
    setActionError('');
    try {
      const { file, kind } = action;
      if (kind === 'rename') {
        const suffix = /\.[^.]+$/.exec(getMyFileName(file))?.[0] || '';
        if (officeEnabled && isOffice(file)) {
          const result = await myFilesOfficeAPI.renameDocument(file.id, name.trim());
          if (isCurrent() && result.editor_notified !== true) notifyWarning('Имя сохранено в HUB; обновление имени в редакторе не подтверждено.');
        } else await myFilesAPI.updateFile(file.id, { name: name.trim() + suffix });
      } else if (kind === 'restore') await myFilesAPI.restoreFile(file.id);
      else await myFilesAPI.deleteFile(file.id);
      if (!isCurrent()) return;
      setAction(null);
      await updateRow(file.id);
      notifySuccess(kind === 'trash' ? 'Файл перемещён в корзину.' : kind === 'restore' ? 'Файл восстановлен.' : 'Файл переименован.');
    } catch (err) { if (isCurrent()) setActionError(failure(err)); }
    finally { operation.current = false; if (isCurrent()) setSaving(false); }
  };
  const openFile = file => {
    if (officeEnabled && isOffice(file)) setOfficeFile(file);
    else void preview.openDocumentPreview(file, { forcePreview: true });
  };
  const activeModel = model.key === key && !error;
  const busy = loading || !activeModel;
  const documentPreview = preview.documentPreview;

  if (!admin) return <Alert severity="error">Доступно только администратору.</Alert>;
  return <Stack spacing={1.5} sx={{ minWidth: 0, maxWidth: '100%' }} data-testid="my-files-admin-browser">
    <Alert severity="info">Все личные файлы и общие папки. Действия выполняются от вашей учётной записи администратора.</Alert>
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
      <TextField size="small" label="Поиск по файлу, пользователю или папке" value={filters.q} onChange={event => changeFilter('q', event.target.value)} sx={{ flex: 1 }} />
      <TextField select size="small" label="Хранилище" value={filters.scope} onChange={event => changeFilter('scope', event.target.value)} sx={{ minWidth: 170 }}>
        <MenuItem value="all">Все хранилища</MenuItem><MenuItem value="personal">Личные файлы</MenuItem><MenuItem value="library">Общие папки</MenuItem>
      </TextField>
      <TextField select size="small" label="Состояние" value={filters.state} onChange={event => changeFilter('state', event.target.value)} sx={{ minWidth: 160 }}>
        <MenuItem value="active">Активные</MenuItem><MenuItem value="trash">В корзине</MenuItem><MenuItem value="all">Все состояния</MenuItem>
      </TextField>
      <Tooltip title="Обновить"><span><IconButton aria-label="Обновить файлы" onClick={() => setTick(value => value + 1)} disabled={loading}><RefreshIcon /></IconButton></span></Tooltip>
    </Stack>
    {initialOwner ? <Typography variant="body2">Владелец: {initialOwner.full_name || initialOwner.username}</Typography> : null}
    {loading ? <LinearProgress aria-label="Загрузка файлов" /> : null}
    {error ? <Alert severity="error" action={<Button color="inherit" onClick={() => setTick(value => value + 1)}>Повторить</Button>}>{error}</Alert> : null}
    {activeModel ? <>
      <TableContainer sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 700 }} aria-label="Все файлы пользователей">
          <TableHead><TableRow><TableCell>Файл</TableCell><TableCell>Владелец / общая папка</TableCell><TableCell>Автор загрузки</TableCell><TableCell>Состояние</TableCell><TableCell align="right">Размер</TableCell><TableCell align="right">Действия</TableCell></TableRow></TableHead>
          <TableBody>{model.items.map(file => <TableRow key={file.id} hover>
            <TableCell sx={{ maxWidth: 330 }}><Button variant="text" onClick={() => openFile(file)} disabled={busy || !file.can_open} sx={{ textTransform: 'none', justifyContent: 'flex-start', maxWidth: '100%' }}>
              <Typography variant="body2" noWrap title={getMyFileName(file)}>{getMyFileName(file)}</Typography>
            </Button>{file.folder_name ? <Typography variant="caption" display="block" color="text.secondary">{file.folder_name}</Typography> : null}</TableCell>
            <TableCell><Typography variant="body2">{file.owner_label}</Typography><Typography variant="caption" color="text.secondary">{file.library_id ? 'Общая папка' : 'Личный диск'}</Typography></TableCell>
            <TableCell>{file.uploaded_by_username || 'Не указан'}</TableCell>
            <TableCell>{file.deleted_at ? 'Корзина' : file.expires_at && new Date(file.expires_at) <= new Date() ? 'Срок хранения истёк' : !file.can_open && file.security_scan_status !== 'clean' ? `Проверка: ${file.security_scan_status}` : file.status === 'ready' ? 'Готов' : file.status}</TableCell>
            <TableCell align="right">{formatFileSize(file.original_size_bytes)}</TableCell>
            <TableCell align="right">{file.can_restore ? <Tooltip title="Восстановить"><span><IconButton aria-label={`Восстановить ${getMyFileName(file)}`} disabled={busy} onClick={() => beginAction('restore', file)}><RestoreIcon /></IconButton></span></Tooltip> : null}
              <IconButton aria-label={`Действия: ${getMyFileName(file)}`} disabled={busy} onClick={event => setMenu({ file, anchorEl: event.currentTarget })}><MoreVertIcon /></IconButton>
            </TableCell>
          </TableRow>)}</TableBody>
        </Table>
      </TableContainer>
      {model.items.length === 0 && !loading ? <Typography color="text.secondary">Файлы по выбранным условиям не найдены.</Typography> : null}
      <TablePagination component="div" count={model.total} page={filters.page} rowsPerPage={filters.size} rowsPerPageOptions={[25, 50, 100]}
        onPageChange={(_, page) => setFilters(previous => ({ ...previous, page }))} onRowsPerPageChange={event => changeFilter('size', Number(event.target.value))}
        labelRowsPerPage="На странице" labelDisplayedRows={({ from, to, count }) => `${from}–${to} из ${count}`} />
    </> : null}
    <FileActionsContextMenu open={Boolean(menu)} anchorEl={menu?.anchorEl} fileName={getMyFileName(menu?.file)} onClose={() => setMenu(null)}
      busy={busy || downloadingFileId === menu?.file?.id} canDownload={Boolean(menu?.file?.can_open)}
      onPreview={menu?.file?.can_open ? () => { void preview.openDocumentPreview(menu.file, { forcePreview: true }); } : undefined}
      onEditOnline={menu?.file?.can_open && officeEnabled && isOffice(menu.file) ? () => setOfficeFile(menu.file) : undefined}
      onDownload={menu?.file?.can_open ? () => { void downloadFile(menu.file); } : undefined}
      onCollaborators={menu?.file?.can_manage_access ? () => setAccessFile(menu.file) : undefined}
      onVersions={menu?.file?.can_open && isOffice(menu.file) ? () => setVersionsFile(menu.file) : undefined}
      onRename={menu?.file?.can_open ? () => beginAction('rename', menu.file) : undefined}
      onShare={menu?.file?.can_manage_access ? () => { void sharing.shareFile(menu.file); } : undefined}
      onRevokeShare={menu?.file?.can_manage_access && menu.file.is_shared ? () => { void sharing.revokeShare(menu.file); } : undefined}
      isShared={Boolean(menu?.file?.is_shared)} onAudit={menu ? () => setAuditFile(menu.file) : undefined}
      onDelete={menu && !menu.file.deleted_at && menu.file.status !== 'deleted' ? () => beginAction('trash', menu.file) : undefined} />
    <MyFilesOfficeEditorDialog open={Boolean(officeFile)} file={officeFile} onDownload={downloadFile} onClose={() => { const id = officeFile?.id; setOfficeFile(null); if (id) void updateRow(id); }} />
    <MyFilesCollaboratorsDialog open={Boolean(accessFile)} file={accessFile} onShareLink={sharing.shareFile} onClose={saved => { const id = accessFile?.id; setAccessFile(null); if (saved && id) void updateRow(id); }} />
    <MyFilesVersionsDialog open={Boolean(versionsFile)} file={versionsFile} onClose={restored => { const id = versionsFile?.id; setVersionsFile(null); if (restored && id) void updateRow(id); }} />
    <MyFileAuditDialog open={Boolean(auditFile)} file={auditFile} onClose={() => setAuditFile(null)} />
    <MyFilesShareDialog {...sharing.shareDialog} onClose={() => sharing.setShareDialog({ open: false })}
      onRotateShare={sharing.shareDialog.item ? () => { void sharing.shareFile(sharing.shareDialog.item, { rotate: true }); } : undefined} />
    <DocumentPreviewDialog {...documentPreview} title={getMyFileName(documentPreview.item)}
      onClose={preview.closeDocumentPreview} onRefresh={preview.refreshDocumentPreview}
      onDownloadOriginal={documentPreview.item ? () => { void downloadFile(documentPreview.item); } : undefined}
      canDownloadOriginal={Boolean(documentPreview.item)} onDownloadPdf={preview.downloadDocumentPreviewPdf} canDownloadPdf={Boolean(documentPreview.previewBlob)} />
    <Dialog open={Boolean(action)} onClose={() => { if (!saving) setAction(null); }} fullWidth maxWidth="xs" aria-labelledby="admin-file-action-title">
      <Box component="form" onSubmit={confirmAction}>
        <DialogTitle id="admin-file-action-title">{action?.kind === 'rename' ? 'Переименовать файл' : action?.kind === 'restore' ? 'Восстановить файл?' : 'Переместить файл в корзину?'}</DialogTitle>
        <DialogContent>{action?.kind === 'rename' ? <TextField autoFocus fullWidth margin="dense" label="Имя файла" value={name} onChange={event => setName(event.target.value)} disabled={saving} helperText="Расширение и формат сохранятся." /> : <Typography>{getMyFileName(action?.file)}</Typography>}
          {actionError ? <Alert severity="error" sx={{ mt: 1 }}>{actionError}</Alert> : null}</DialogContent>
        <DialogActions><Button onClick={() => setAction(null)} disabled={saving}>Отмена</Button><Button type="submit" variant="contained" disabled={saving}>{saving ? 'Выполняем…' : 'Подтвердить'}</Button></DialogActions>
      </Box>
    </Dialog>
  </Stack>;
}
