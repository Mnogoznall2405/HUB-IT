import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';

export default function ChatFolderDialogs({
  open,
  createMode = false,
  folders = [],
  conversations = [],
  conversationIdsByFolder = {},
  saving = false,
  onClose,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onReorderFolder,
  onRemoveConversationFromFolder,
  onOpenFolderEditor,
}) {
  const [name, setName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState('');
  const [editingName, setEditingName] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
      setEditingFolderId('');
      setEditingName('');
      return;
    }
    if (createMode) {
      setEditingFolderId('');
      setEditingName('');
    }
  }, [createMode, open]);

  const conversationTitleById = useMemo(() => {
    const map = new Map();
    (Array.isArray(conversations) ? conversations : []).forEach((item) => {
      map.set(String(item?.id || ''), String(item?.title || item?.direct_peer?.full_name || item?.id || 'Чат'));
    });
    return map;
  }, [conversations]);

  const handleCreate = async () => {
    const trimmed = String(name || '').trim();
    if (trimmed.length < 1) return;
    await onCreateFolder?.(trimmed);
    setName('');
  };

  const startEdit = (folder) => {
    setEditingFolderId(String(folder?.id || ''));
    setEditingName(String(folder?.name || ''));
  };

  const saveEdit = async () => {
    const folderId = String(editingFolderId || '').trim();
    const trimmed = String(editingName || '').trim();
    if (!folderId || trimmed.length < 1) return;
    await onRenameFolder?.(folderId, trimmed);
    setEditingFolderId('');
    setEditingName('');
  };

  return (
    <Dialog open={Boolean(open)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Папки чатов</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
              Создайте свои папки и добавляйте в них чаты через меню строки чата.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                size="small"
                label="Новая папка"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void handleCreate();
                  }
                }}
                autoFocus={createMode}
              />
              <Button variant="contained" onClick={() => void handleCreate()} disabled={saving || String(name || '').trim().length < 1}>
                Создать
              </Button>
            </Stack>
          </Box>

          <List dense sx={{ bgcolor: 'action.hover', borderRadius: 2 }}>
            {(Array.isArray(folders) ? folders : []).length === 0 ? (
              <ListItem>
                <ListItemText primary="Пользовательских папок пока нет" secondary="Системные вкладки «Все», «Личные» и «Задачи» доступны всегда." />
              </ListItem>
            ) : null}
            {(Array.isArray(folders) ? folders : []).map((folder, index) => {
              const folderId = String(folder?.id || '');
              const isEditing = editingFolderId === folderId;
              const folderConversationIds = Array.isArray(conversationIdsByFolder?.[folderId])
                ? conversationIdsByFolder[folderId]
                : [];
              return (
                <Box key={folderId}>
                  <ListItem alignItems="flex-start">
                    {isEditing ? (
                      <TextField
                        fullWidth
                        size="small"
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveEdit();
                          }
                        }}
                      />
                    ) : (
                      <ListItemText
                        primary={folder?.name || 'Папка'}
                        secondary={`${folderConversationIds.length} чат(ов)`}
                      />
                    )}
                    <ListItemSecondaryAction>
                      <Stack direction="row" spacing={0.5}>
                        {isEditing ? (
                          <Button size="small" onClick={() => void saveEdit()} disabled={saving}>Сохранить</Button>
                        ) : (
                          <>
                            <IconButton size="small" aria-label="Переименовать папку" onClick={() => startEdit(folder)}>
                              <EditOutlinedIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" aria-label="Переместить вверх" disabled={index === 0 || saving} onClick={() => onReorderFolder?.(folderId, 'up')}>
                              <ArrowUpwardRoundedIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" aria-label="Переместить вниз" disabled={index >= folders.length - 1 || saving} onClick={() => onReorderFolder?.(folderId, 'down')}>
                              <ArrowDownwardRoundedIcon fontSize="small" />
                            </IconButton>
                            <IconButton size="small" aria-label="Удалить папку" onClick={() => onDeleteFolder?.(folderId)} disabled={saving}>
                              <DeleteOutlineRoundedIcon fontSize="small" />
                            </IconButton>
                          </>
                        )}
                      </Stack>
                    </ListItemSecondaryAction>
                  </ListItem>
                  {folderConversationIds.length > 0 ? (
                    <List dense sx={{ pl: 2, pr: 1, pb: 1 }}>
                      {folderConversationIds.map((conversationId) => (
                        <ListItem key={`${folderId}-${conversationId}`} sx={{ py: 0.25 }}>
                          <ListItemText
                            primary={conversationTitleById.get(String(conversationId)) || conversationId}
                            primaryTypographyProps={{ variant: 'body2' }}
                          />
                          <ListItemSecondaryAction>
                            <Button
                              size="small"
                              color="inherit"
                              onClick={() => onRemoveConversationFromFolder?.(folderId, conversationId)}
                              disabled={saving}
                            >
                              Убрать
                            </Button>
                          </ListItemSecondaryAction>
                        </ListItem>
                      ))}
                    </List>
                  ) : null}
                </Box>
              );
            })}
          </List>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Закрыть</Button>
      </DialogActions>
    </Dialog>
  );
}
