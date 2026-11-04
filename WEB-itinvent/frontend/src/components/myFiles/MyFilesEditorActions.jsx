import { useEffect, useRef, useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Snackbar, TextField, Tooltip,
} from '@mui/material';
import DriveFileRenameOutlineRoundedIcon from '@mui/icons-material/DriveFileRenameOutlineRounded';
import GroupAddOutlinedIcon from '@mui/icons-material/GroupAddOutlined';

import { myFilesOfficeAPI } from '../../api/myFilesOffice';
import MyFilesCollaboratorsDialog from './MyFilesCollaboratorsDialog';

/** These are HUB actions. They never replace or reload the live document frame. */
export default function MyFilesEditorActions({ fileId, fileName, canRename, canManageAccess, disabled, isMobile, onRenamed }) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const request = useRef(null);
  const input = useRef(null);
  const mounted = useRef(false);
  const canSubmit = useRef(false);
  canSubmit.current = Boolean(canRename && !disabled);
  const suffix = /\.[^.]+$/.exec(fileName)?.[0] || '';

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!canManageAccess || disabled) setSharingOpen(false);
    if (!canRename || disabled) setRenameOpen(false);
  }, [canManageAccess, canRename, disabled]);
  useEffect(() => {
    if (error && !saving && renameOpen) input.current?.focus();
  }, [error, saving, renameOpen]);

  const openRename = () => {
    setName(suffix ? fileName.slice(0, -suffix.length) : fileName);
    setError('');
    setNotice(null);
    setRenameOpen(true);
  };
  const closeRename = () => { if (!request.current) setRenameOpen(false); };
  const saveName = async (event) => {
    event.preventDefault();
    if (request.current || !canSubmit.current) return;
    const trimmed = name.trim();
    if (!trimmed || /[\\/\u0000]/.test(trimmed)) {
      setError('Укажите имя файла без пути.');
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setSaving(true);
    setError('');
    try {
      const result = await myFilesOfficeAPI.renameDocument(fileId, trimmed, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || !canSubmit.current) return;
      const title = result?.file?.original_file_name;
      if (String(result?.file?.id) !== String(fileId) || typeof title !== 'string' || !title.trim()) {
        setError('HUB не подтвердил новое имя. Проверьте файл в разделе «Мои файлы».');
        return;
      }
      onRenamed?.(title);
      setRenameOpen(false);
      setNotice(result.editor_notified === true
        ? { severity: 'success', text: 'Имя файла обновлено.' }
        : { severity: 'warning', text: 'Имя сохранено в HUB. Сервер редактора не подтвердил обновление имени в открытых окнах. Текущий документ сохранён на экране.' });
    } catch (err) {
      if (!mounted.current || controller.signal.aborted) return;
      const detail = err?.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : err?.response
        ? 'Не удалось переименовать файл.' : 'Ответ HUB не получен. Проверьте имя в «Моих файлах» перед повтором.');
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current) setSaving(false);
    }
  };

  return <>
    {canRename ? <Tooltip title="Переименовать файл">
      <span><IconButton aria-label="Переименовать файл" onClick={openRename} disabled={disabled || saving}>
        <DriveFileRenameOutlineRoundedIcon fontSize="small" />
      </IconButton></span>
    </Tooltip> : null}
    {canManageAccess ? <Tooltip title="Совместный доступ через HUB">
      <span><Button size="small" startIcon={<GroupAddOutlinedIcon />} disabled={disabled}
        aria-label="Совместный доступ" onClick={() => setSharingOpen(true)} sx={{ flexShrink: 0, minWidth: isMobile ? 40 : undefined }}>
        {isMobile ? '' : 'Доступ'}
      </Button></span>
    </Tooltip> : null}
    <Dialog open={renameOpen} onClose={closeRename} maxWidth="xs" fullWidth aria-labelledby="office-rename-title">
      <form onSubmit={saveName}>
        <DialogTitle id="office-rename-title">Переименовать файл</DialogTitle>
        <DialogContent>
          <TextField autoFocus inputRef={input} fullWidth margin="dense" label="Имя файла" value={name} disabled={saving}
            error={Boolean(error)} helperText={error || 'Формат файла останется прежним.'}
            onChange={(event) => { setName(event.target.value); setError(''); }}
            inputProps={{ maxLength: 200 }}
            InputProps={{ endAdornment: <InputAdornment position="end">{suffix}</InputAdornment> }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRename} disabled={saving}>Отмена</Button>
          <Button type="submit" variant="contained" disabled={saving} startIcon={saving ? <CircularProgress size={16} /> : null}>
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
    {sharingOpen ? <MyFilesCollaboratorsDialog open file={{ id: fileId, original_file_name: fileName }}
      onClose={(saved) => {
        setSharingOpen(false);
        if (saved) setNotice({ severity: 'success', text: 'Совместный доступ обновлён в HUB.' });
      }} /> : null}
    <Snackbar open={Boolean(notice)} autoHideDuration={notice?.severity === 'success' ? 5000 : null}
      onClose={(_, reason) => { if (reason !== 'clickaway') setNotice(null); }} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      {notice ? <Alert severity={notice.severity} role={notice.severity === 'success' ? 'status' : 'alert'} onClose={() => setNotice(null)}>{notice.text}</Alert> : undefined}
    </Snackbar>
  </>;
}
