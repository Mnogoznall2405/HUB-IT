import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Button, Chip, Divider, IconButton, Stack, Tooltip, Typography, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';

import MyFilesEditorSurface from './MyFilesEditorSurface';
import MyFilesVersionHistory from './MyFilesVersionHistory';
import MyFilesEditorActions from './MyFilesEditorActions';
import MyFilesOfficeHistoryView from './MyFilesOfficeHistoryView';
import AuthContext from '../../contexts/AuthContext';

/** Native editor controls delegate file management to HUB; older configs keep the HUB toolbar. */
const MyFilesEditorShell = forwardRef(function MyFilesEditorShell({
  fileId,
  fileName,
  onClose,
  closeLabel = 'Закрыть редактор',
  onDownload,
  onTitle,
  onSessionState,
  active = true,
}, ref) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const auth = useContext(AuthContext);
  const accountKey = String(auth?.user?.id ?? auth?.user?.username ?? '');
  const scope = `${fileId}:${accountKey}`;
  const [documentTitle, setDocumentTitle] = useState(fileName);
  const [capabilities, setCapabilities] = useState(null);
  useEffect(() => { setDocumentTitle(fileName); }, [fileName, fileId]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nativeHistoryScope, setNativeHistoryScope] = useState('');
  const [historyKey, setHistoryKey] = useState(0);
  const [canEdit, setCanEdit] = useState(true);
  const editorRef = useRef(null);
  const actionsRef = useRef(null);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const nativeChrome = capabilities?.scope === scope && capabilities.nativeChrome;
  const historyActive = nativeHistoryScope === scope;
  const [editorStatus, setEditorStatus] = useState({ phase: 'loading', save: 'clean', offline: false });
  const showHubToolbar = !historyActive && capabilities?.scope === scope && !nativeChrome && editorStatus.frameReady;
  const showCloseFallback = !historyActive && !showHubToolbar
    && (capabilities?.scope !== scope || !editorStatus.frameReady || ['blocked', 'error'].includes(editorStatus.phase));
  const saveLabel = editorStatus.offline ? 'Нет связи'
    : editorStatus.phase === 'blocked' ? 'Доступ изменён'
    : editorStatus.phase === 'error' ? 'Ошибка редактора'
    : editorStatus.phase === 'refreshing' ? 'Восстанавливаем документ'
    : editorStatus.save === 'dirty' ? 'Есть неотправленные правки'
    : editorStatus.save === 'submitted' ? 'Правки на сервере редактора'
    : editorStatus.phase === 'loading' ? 'Подключаем редактор'
    : editorStatus.phase === 'action-required' ? 'Требуется действие в редакторе'
    : editorStatus.phase === 'opening' ? 'Загружаем документ' : 'Редактор готов';
  const closeHistory = useCallback(() => {
    setNativeHistoryScope('');
    requestAnimationFrame(() => { if (currentScope.current === scope) editorRef.current?.focus(); });
  }, [scope]);
  const handleClose = useCallback(() => {
    if (historyActive) { closeHistory(); return; }
    if (editorRef.current) editorRef.current.requestClose();
    else onClose?.();
  }, [onClose, historyActive, closeHistory]);
  const requestDocumentClose = useCallback(() => {
    if (historyActive) {
      closeHistory();
      requestAnimationFrame(() => { if (currentScope.current === scope) editorRef.current?.requestClose(); });
    } else if (editorRef.current) editorRef.current.requestClose();
    else onClose?.();
  }, [historyActive, closeHistory, scope, onClose]);
  const openHistory = useCallback(() => {
    if (capabilities?.scope !== scope) return;
    if (capabilities.canViewHistory) setNativeHistoryScope(scope);
    else setHistoryOpen(true);
  }, [capabilities, scope]);
  useImperativeHandle(ref, () => ({ requestClose: handleClose, requestDocumentClose, openHistory }), [handleClose, requestDocumentClose, openHistory]);
  const handleStatus = useCallback(value => { setEditorStatus(value); onSessionState?.(value); }, [onSessionState]);

  const handleTitle = useCallback((title) => {
    setDocumentTitle(title);
    onTitle?.(title);
  }, [onTitle]);
  const handleConfig = useCallback((config, actions) => {
    setCanEdit(config?.document?.permissions?.edit !== false);
    setCapabilities({ ...actions, scope });
    const title = String(config?.document?.title || '').trim();
    if (title) handleTitle(title);
  }, [handleTitle, scope]);

  const handleRestored = useCallback(() => {
    // The editor keeps showing the old content until it is reopened, so the version list is the only thing to refresh.
    setHistoryKey((value) => value + 1);
  }, []);

  const handleSharingSaved = useCallback((access) => {
    const label = user => user.full_name || user.username;
    const roles = { edit: 'Правка', comment: 'Комментарии', view: 'Просмотр' };
    const sharingSettings = (access.items || []).map(user => ({ user: label(user), permissions: roles[user.role] || user.role }));
    if (access.owner) sharingSettings.unshift({ user: label(access.owner), permissions: access.owner_kind === 'author' ? 'Автор файла' : 'Владелец' });
    if (access.inherited_access) sharingSettings.push({
      user: access.library_name ? `Участники общей папки «${access.library_name}»` : 'Участники родительской папки',
      permissions: 'По правам папки',
    });
    editorRef.current?.setSharingSettings({ sharingSettings });
  }, []);

  return (
    <>
      <Stack
        data-testid="my-files-hub-toolbar"
        direction="row"
        alignItems="center"
        sx={{ display: showHubToolbar ? 'flex' : 'none',
          px: 2, py: 0.75, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5 }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: { xs: '1 0 100%', md: '1 1 0' }, minWidth: 0 }} noWrap title={documentTitle}>{documentTitle}</Typography>
        <MyFilesEditorActions key={scope} ref={actionsRef} fileId={fileId} fileName={documentTitle} isMobile={isMobile}
          active={active}
          nativeChrome={nativeChrome} onSharingSaved={handleSharingSaved}
          canRename={capabilities?.scope === scope && capabilities.canRename && auth?.hasPermission?.('my_files.write')}
          canManageAccess={capabilities?.scope === scope && capabilities.canManageAccess && auth?.hasPermission?.('my_files.share')}
          disabled={historyActive || editorStatus.offline || ['blocked', 'error', 'loading'].includes(editorStatus.phase)} onRenamed={handleTitle} />
        {isMobile ? null : (
          <Tooltip title="Передача правок серверу редактора ещё не означает сохранение файла в HUB. HUB получает файл после завершения совместной сессии.">
            <Chip
              size="small"
              variant="outlined"
              label={saveLabel}
              color={editorStatus.offline || editorStatus.save === 'dirty' ? 'warning' : editorStatus.save === 'submitted' ? 'info' : 'default'}
              data-testid="my-files-office-save-state"
              role="status"
              aria-live="polite"
              sx={{ flexShrink: 0 }}
            />
          </Tooltip>
        )}
        {onDownload ? (
          <Tooltip title="Скачать копию, чтобы работать у себя. Правки в копии не попадут в общий файл: общий файл редактируется только онлайн">
            <Button
              size="small"
              startIcon={<DownloadOutlinedIcon />}
              onClick={onDownload}
              aria-label="Скачать копию"
              data-testid="my-files-office-download"
              sx={{ flexShrink: 0, minWidth: isMobile ? 40 : undefined }}
            >
              {isMobile ? '' : 'Скачать копию'}
            </Button>
          </Tooltip>
        ) : null}
        <Tooltip title="История версий">
          <Button
            size="small"
            variant={historyOpen ? 'contained' : 'outlined'}
            startIcon={<HistoryRoundedIcon />}
            onClick={() => capabilities?.scope === scope && capabilities.canViewHistory ? setNativeHistoryScope(scope) : setHistoryOpen(value => !value)}
            aria-label="История версий"
            data-testid="my-files-office-history"
            sx={{ flexShrink: 0, minWidth: isMobile ? 40 : undefined }}
          >
            {isMobile ? '' : 'История версий'}
          </Button>
        </Tooltip>
        <IconButton onClick={handleClose} aria-label={closeLabel} data-testid="my-files-office-close">
          <CloseRoundedIcon />
        </IconButton>
      </Stack>
      <Box sx={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
        {showCloseFallback ? <Tooltip title={closeLabel}>
          <IconButton onClick={handleClose} aria-label={closeLabel} data-testid="my-files-office-loading-close"
            sx={{ position: 'absolute', top: 8, right: 8, zIndex: 3, color: 'text.primary', bgcolor: 'background.paper', '&:hover': { bgcolor: 'action.hover' } }}>
            <CloseRoundedIcon />
          </IconButton>
        </Tooltip> : null}
        <Box data-testid="my-files-live-surface" aria-hidden={historyActive || undefined} {...(historyActive ? { inert: '' } : {})}
          sx={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0, visibility: historyActive || !active ? 'hidden' : 'visible' }}>
          <MyFilesEditorSurface
            key={fileId} ref={editorRef} fileId={fileId} onConfig={handleConfig}
            active={active} onStatusChange={handleStatus} onRequestClose={onClose} onTitleChange={handleTitle}
            onRequestHistory={() => { if (active) setNativeHistoryScope(scope); }}
            onRequestRename={title => actionsRef.current?.rename(title)}
            onRequestSharingSettings={() => actionsRef.current?.share()}
          />
        </Box>
        {historyOpen && !historyActive ? (
          <>
            {isMobile ? null : <Divider orientation="vertical" flexItem />}
            <Box
              data-testid="my-files-office-history-panel"
              sx={{
                width: { xs: '100%', md: 320 },
                flexShrink: 0,
                overflowY: 'auto',
                bgcolor: 'background.paper',
                ...(isMobile ? { position: 'absolute', inset: 0, zIndex: 2 } : {}),
              }}
            >
              <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>История версий</Typography>
                <IconButton size="small" aria-label="Закрыть историю версий" onClick={() => setHistoryOpen(false)}>
                  <CloseRoundedIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Divider />
              <MyFilesVersionHistory
                fileId={fileId}
                fileName={documentTitle}
                canRestore={canEdit}
                refreshKey={historyKey}
                onRestored={handleRestored}
              />
            </Box>
          </>
        ) : null}
        {historyActive ? <Box sx={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', bgcolor: 'background.paper' }}>
          <MyFilesOfficeHistoryView key={scope} fileId={fileId} fileName={documentTitle} onClose={closeHistory} active={active} />
        </Box> : null}
      </Box>
    </>
  );
});

export default MyFilesEditorShell;
