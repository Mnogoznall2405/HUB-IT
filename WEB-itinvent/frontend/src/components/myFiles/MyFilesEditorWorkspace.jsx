import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, IconButton, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import AuthContext from '../../contexts/AuthContext';
import MyFilesEditorShell from './MyFilesEditorShell';

const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const sameStatus = (a, b) => ['phase', 'save', 'offline', 'frameReady'].every(key => a?.[key] === b?.[key]);

/** A workspace belongs to one account; documents are never carried into the next account. */
export default function MyFilesEditorWorkspace(props) {
  const auth = useContext(AuthContext);
  const account = String(auth?.user?.id ?? auth?.user?.username ?? '');
  return <DocumentWorkspace key={account} {...props} />;
}

function DocumentWorkspace({ fileId, requestKey, onActiveDocumentChange, onCloseLast, onTitle, onDownload }) {
  const [workspace, setWorkspace] = useState(() => ({
    documents: validId(fileId) ? [{ id: fileId, title: '', status: {} }] : [],
    activeId: validId(fileId) ? fileId : '',
  }));
  const current = useRef(workspace);
  const editors = useRef(new Map());
  const closeFrame = useRef(null);
  const callbacks = useRef({});
  callbacks.current = { onActiveDocumentChange, onCloseLast, onTitle, onDownload };

  const update = useCallback(change => {
    const next = change(current.current);
    if (next !== current.current) { current.current = next; setWorkspace(next); }
  }, []);

  useEffect(() => {
    if (!validId(fileId)) return;
    update(previous => {
      if (previous.activeId === fileId && previous.documents.some(item => item.id === fileId)) return previous;
      return { activeId: fileId, documents: previous.documents.some(item => item.id === fileId)
        ? previous.documents : [...previous.documents, { id: fileId, title: '', status: {} }] };
    });
  }, [fileId, requestKey, update]);
  useEffect(() => () => { if (closeFrame.current !== null) cancelAnimationFrame(closeFrame.current); }, []);

  const activate = useCallback(id => {
    if (!current.current.documents.some(item => item.id === id)) return;
    update(previous => previous.activeId === id ? previous : { ...previous, activeId: id });
    callbacks.current.onActiveDocumentChange?.(id);
  }, [update]);

  const requestClose = useCallback(id => {
    activate(id);
    if (closeFrame.current !== null) cancelAnimationFrame(closeFrame.current);
    // Show the document before asking its SDK, so its confirmation remains visible.
    closeFrame.current = requestAnimationFrame(() => {
      closeFrame.current = null;
      if (current.current.activeId === id) editors.current.get(id)?.requestDocumentClose();
    });
  }, [activate]);

  const remove = useCallback(id => {
    const previous = current.current;
    const index = previous.documents.findIndex(item => item.id === id);
    if (index < 0) return;
    const documents = previous.documents.filter(item => item.id !== id);
    const activeId = previous.activeId === id ? (documents[Math.min(index, documents.length - 1)]?.id || '') : previous.activeId;
    update(() => ({ documents, activeId }));
    if (!documents.length) callbacks.current.onCloseLast?.();
    else if (activeId !== previous.activeId) callbacks.current.onActiveDocumentChange?.(activeId);
  }, [update]);

  const rename = useCallback((id, title) => {
    update(previous => previous.documents.some(item => item.id === id && item.title !== title)
      ? { ...previous, documents: previous.documents.map(item => item.id === id ? { ...item, title } : item) } : previous);
  }, [update]);
  const status = useCallback((id, value) => {
    update(previous => previous.documents.some(item => item.id === id && !sameStatus(item.status, value))
      ? { ...previous, documents: previous.documents.map(item => item.id === id ? { ...item, status: value } : item) } : previous);
  }, [update]);

  const active = workspace.documents.find(item => item.id === workspace.activeId);
  useEffect(() => { callbacks.current.onTitle?.(active?.title || 'Документы'); }, [active?.id, active?.title]);

  return <Box component="main" aria-label="Открытые документы" sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', minWidth: 0, bgcolor: 'background.paper' }}>
    <Stack direction="row" alignItems="center" sx={{ flexShrink: 0, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <Tabs value={workspace.activeId || false} onChange={(_, id) => activate(id)} aria-label="Документы"
        variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile selectionFollowsFocus
        sx={{ flex: 1, minWidth: 0, minHeight: { xs: 44, sm: 36 }, '& .MuiTab-root': { minHeight: { xs: 44, sm: 36 }, py: 0.25, px: 1.25, minWidth: 120, maxWidth: 280, textTransform: 'none' } }}>
        {workspace.documents.map((item, index) => <Tab key={item.id} component="div" value={item.id}
          id={`document-tab-${item.id}`} aria-controls={`document-panel-${item.id}`}
          onKeyDown={event => { if (event.key === 'Delete' && event.target === event.currentTarget) { event.preventDefault(); requestClose(item.id); } }}
          label={<Stack component="span" direction="row" alignItems="center" sx={{ minWidth: 0, width: '100%' }}>
            {item.status.save === 'dirty' ? <Box component="span" aria-label="Есть неотправленные правки" sx={{ width: 6, height: 6, mr: 0.75, borderRadius: '50%', bgcolor: 'warning.main', flexShrink: 0 }} /> : null}
            <Typography component="span" variant="body2" noWrap title={item.title || `Документ ${index + 1}`} sx={{ flex: 1, minWidth: 0 }}>{item.title || `Документ ${index + 1}`}</Typography>
            <Tooltip title="Закрыть документ">
              <IconButton component="button" size="small" tabIndex={-1} aria-label={`Закрыть документ «${item.title || `Документ ${index + 1}`}»`}
                onClick={event => { event.stopPropagation(); requestClose(item.id); }} sx={{ ml: 0.5, width: { xs: 44, sm: 28 }, height: { xs: 44, sm: 28 }, color: 'text.secondary' }}>
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>} />)}
      </Tabs>
      <Tooltip title="История версий и авторов. Новая версия появляется после закрытия документа всеми участниками.">
        <span><Button aria-label="История изменений документа" size="small" startIcon={<HistoryRoundedIcon fontSize="small" />}
          disabled={!active?.status?.frameReady || active.status.offline || active.status.phase === 'blocked'}
          onClick={() => editors.current.get(workspace.activeId)?.openHistory()}
          sx={{ color: 'text.primary', flexShrink: 0, minWidth: { xs: 44, sm: 96 }, height: { xs: 44, sm: 36 }, '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 }, ml: 0 } }}>
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>История</Box>
        </Button></span>
      </Tooltip>
    </Stack>
    {!validId(fileId) ? <Alert severity="error">Некорректная ссылка на документ.</Alert> : null}
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
      {workspace.documents.map(item => {
        const selected = item.id === workspace.activeId;
        return <Box key={item.id} role="tabpanel" id={`document-panel-${item.id}`} aria-labelledby={`document-tab-${item.id}`}
          aria-hidden={!selected || undefined} {...(!selected ? { inert: '' } : {})}
          sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', visibility: selected ? 'visible' : 'hidden', zIndex: selected ? 1 : 0 }}>
          <MyFilesEditorShell ref={instance => { if (instance) editors.current.set(item.id, instance); else editors.current.delete(item.id); }}
            fileId={item.id} fileName={item.title || 'Документ'} active={selected}
            onClose={() => remove(item.id)} onTitle={title => rename(item.id, title)} onSessionState={value => status(item.id, value)}
            onDownload={onDownload ? () => callbacks.current.onDownload?.(item.id) : undefined} />
        </Box>;
      })}
    </Box>
  </Box>;
}
