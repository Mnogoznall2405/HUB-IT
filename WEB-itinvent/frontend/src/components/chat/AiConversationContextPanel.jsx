import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import MemoryRoundedIcon from '@mui/icons-material/MemoryRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import { AiConversationAvatar } from './ChatCommon';
import OpenCodeConversationContext from './OpenCodeConversationContext';
import useAiPersonalMemory from './useAiPersonalMemory';

const PANEL_WIDTH = 360;

const collectSources = (messages) => {
  const found = new Map();
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const structuredSources = [
      ...(Array.isArray(message?.sources) ? message.sources : []),
      ...(Array.isArray(message?.metadata?.sources) ? message.metadata.sources : []),
      ...(Array.isArray(message?.ai_sources) ? message.ai_sources : []),
    ];
    structuredSources.forEach((source) => {
      const normalized = typeof source === 'string'
        ? { title: source }
        : {
          title: String(source?.title || source?.label || source?.name || '').trim(),
          subtitle: String(source?.subtitle || source?.source_type || source?.kind || '').trim(),
        };
      if (normalized.title && !found.has(normalized.title)) found.set(normalized.title, normalized);
    });
    const body = String(message?.body || '');
    body.split(/\r?\n/u).forEach((line) => {
      if (!/^источник(?:и)?\s*:/iu.test(line.trim())) return;
      const value = line.replace(/^источник(?:и)?\s*:/iu, '').trim();
      if (value && !found.has(value)) found.set(value, { title: value });
    });
  });
  return Array.from(found.values()).slice(0, 12);
};

const collectRelatedObjects = (messages) => {
  const found = new Map();
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const items = [
      ...(Array.isArray(message?.related_objects) ? message.related_objects : []),
      ...(Array.isArray(message?.metadata?.related_objects) ? message.metadata.related_objects : []),
    ];
    items.forEach((item) => {
      const id = String(item?.id || item?.object_id || '').trim();
      const title = String(item?.title || item?.label || item?.name || '').trim();
      const key = `${String(item?.kind || item?.type || '').trim()}:${id || title}`;
      if (title && !found.has(key)) found.set(key, { ...item, title });
    });
  });
  return Array.from(found.values()).slice(0, 12);
};

const collectFiles = (messages) => (Array.isArray(messages) ? messages : [])
  .flatMap((message) => (Array.isArray(message?.attachments) ? message.attachments : []))
  .filter((attachment, index, items) => (
    items.findIndex((item) => String(item?.id || '') === String(attachment?.id || '')) === index
  ));

export default function AiConversationContextPanel({
  activeConversation,
  agent,
  messages,
  onClose,
  onOpenSearch,
  onOpenFilePicker,
  onOpenAttachmentPreview,
  onCreateNewConversation,
  onUpdateConversationSettings,
  newConversationCreating = false,
  settingsUpdating = false,
  mobileScreen = false,
  realtimeRevision = '',
}) {
  const sources = useMemo(() => collectSources(messages), [messages]);
  const files = useMemo(() => collectFiles(messages), [messages]);
  const relatedObjects = useMemo(() => collectRelatedObjects(messages), [messages]);
  const [editingMemory, setEditingMemory] = useState(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState('');
  const [clearMemoryOpen, setClearMemoryOpen] = useState(false);
  const isGenericAgent = !agent?.id;
  const isSandboxAgent = String(agent?.surface || '').trim().toLowerCase() === 'sandbox';
  const personalMemoryAvailable = !isSandboxAgent
    && agent?.personal_memory_enabled !== false
    && agent?.uses_personal_memory !== false;
  const memory = useAiPersonalMemory({
    available: personalMemoryAvailable,
    conversationId: activeConversation?.id,
  });
  const capabilities = useMemo(() => [
    agent?.live_data_enabled ? 'Данные HUB' : null,
    'База знаний',
    agent?.allow_file_input !== false ? 'Файлы и документы' : null,
    (isGenericAgent || agent?.allow_generated_artifacts) ? 'Создание документов' : null,
  ].filter(Boolean), [agent, isGenericAgent]);

  const beginEditMemory = (item) => {
    setEditingMemory(item);
    setEditingMemoryContent(String(item?.content || '').trim());
  };
  const submitMemoryEdit = async () => {
    const updated = await memory.updateItem(editingMemory?.id, editingMemoryContent);
    if (updated) {
      setEditingMemory(null);
      setEditingMemoryContent('');
    }
  };

  return (
    <Box
      data-testid="ai-conversation-context-panel"
      sx={{
        width: mobileScreen ? '100%' : PANEL_WIDTH,
        maxWidth: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        color: 'text.primary',
        borderLeft: mobileScreen ? 0 : 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ minHeight: 64, px: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
        <IconButton aria-label="Закрыть информацию об агенте" onClick={onClose} sx={{ minWidth: 44, minHeight: 44 }}>
          <CloseRoundedIcon />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={800}>О диалоге</Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 2.5 }}>
        <Stack alignItems="center" spacing={1.25} sx={{ textAlign: 'center', mb: 3 }}>
          <AiConversationAvatar size={72} />
          <Typography variant="h6" fontWeight={800}>
            {agent?.title || 'Личный AI'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300 }}>
            {agent?.description || 'Личный помощник для общения, базы знаний, анализа файлов и создания документов.'}
          </Typography>
        </Stack>

        <Typography variant="overline" color="text.secondary" fontWeight={800}>Возможности</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1, mb: 2.5 }}>
          {capabilities.map((item) => <Chip key={item} label={item} size="small" />)}
        </Stack>

        <Divider />
        <Stack spacing={1} sx={{ py: 2 }}>
          <Button startIcon={<SearchRoundedIcon />} onClick={onOpenSearch} sx={{ minHeight: 44, justifyContent: 'flex-start' }}>
            Поиск по диалогу
          </Button>
          {agent?.allow_file_input !== false ? (
            <Button startIcon={<AttachFileRoundedIcon />} onClick={onOpenFilePicker} sx={{ minHeight: 44, justifyContent: 'flex-start' }}>
              Прикрепить файл
            </Button>
          ) : null}
        </Stack>

        <Divider />
        {isSandboxAgent ? (
          <>
            <OpenCodeConversationContext
              conversationId={activeConversation?.id}
              refreshKey={realtimeRevision}
            />
            <Divider />
          </>
        ) : null}
        <Typography variant="overline" color="text.secondary" fontWeight={800} sx={{ display: 'block', mt: 2 }}>
          Личная память
        </Typography>
        {!personalMemoryAvailable ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
            OpenCode работает только с сообщениями и файлами текущей сессии. Общая память для него отключена.
          </Typography>
        ) : (
          <Stack spacing={1} sx={{ mt: 0.5, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              В текущем чате учитываются последние 20 сообщений и краткое резюме более ранней части. Личная память может использоваться между AI-чатами.
            </Typography>
            <FormControlLabel
              control={(
                <Switch
                  checked={memory.enabled}
                  disabled={memory.busyKey === 'settings' || memory.loading}
                  onChange={(event) => void memory.updateEnabled(event.target.checked)}
                  inputProps={{ 'aria-label': 'Использовать личную память' }}
                />
              )}
              label="Использовать в AI-чатах"
              sx={{ minHeight: 44, m: 0 }}
            />
            {memory.loading ? (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 44 }}>
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">Загружаю память…</Typography>
              </Stack>
            ) : null}
            {memory.error ? <Alert severity="error">{memory.error}</Alert> : null}
            {memory.notice ? (
              <Alert severity={memory.noticeSeverity || 'success'} onClose={memory.dismissNotice}>{memory.notice}</Alert>
            ) : null}
            {!memory.loading && memory.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Сохранённых предпочтений и рабочих фактов пока нет.
              </Typography>
            ) : null}
            {memory.items.map((item) => (
              <Box
                key={item.id}
                sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, p: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}
              >
                <MemoryRoundedIcon color="action" fontSize="small" sx={{ mt: 1.25 }} />
                <Box sx={{ minWidth: 0, flex: 1, py: 0.75 }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{item.content}</Typography>
                  {item.category ? <Typography variant="caption" color="text.secondary">{item.category}</Typography> : null}
                </Box>
                <IconButton
                  aria-label="Изменить факт памяти"
                  disabled={memory.busyKey === String(item.id)}
                  onClick={() => beginEditMemory(item)}
                  sx={{ minWidth: 44, minHeight: 44 }}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label="Удалить факт памяти"
                  disabled={memory.busyKey === String(item.id)}
                  onClick={() => void memory.deleteItem(item.id)}
                  sx={{ minWidth: 44, minHeight: 44 }}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            {memory.items.length > 0 ? (
              <Button
                color="error"
                startIcon={<DeleteOutlineRoundedIcon />}
                disabled={memory.busyKey === 'clear'}
                onClick={() => setClearMemoryOpen(true)}
                sx={{ minHeight: 44, justifyContent: 'flex-start' }}
              >
                Очистить всю память
              </Button>
            ) : null}
          </Stack>
        )}

        <Divider />
        <Typography variant="overline" color="text.secondary" fontWeight={800} sx={{ display: 'block', mt: 2 }}>
          Использованные источники
        </Typography>
        {sources.length > 0 ? (
          <Stack spacing={1} sx={{ mt: 1 }}>
            {sources.map((source) => (
              <Box key={`${source.title}:${source.subtitle || ''}`} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <HubOutlinedIcon fontSize="small" color="action" />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{source.title}</Typography>
                  {source.subtitle ? <Typography variant="caption" color="text.secondary">{source.subtitle}</Typography> : null}
                </Box>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Источники появятся после первого ответа с данными HUB.
          </Typography>
        )}

        <Typography variant="overline" color="text.secondary" fontWeight={800} sx={{ display: 'block', mt: 2.5 }}>
          Файлы диалога
        </Typography>
        {files.length > 0 ? (
          <Stack spacing={0.5} sx={{ mt: 0.75 }}>
            {files.slice(0, 8).map((file) => (
              <Button
                key={file.id || file.file_name}
                startIcon={<DescriptionOutlinedIcon />}
                onClick={() => onOpenAttachmentPreview?.(file)}
                sx={{ minHeight: 44, justifyContent: 'flex-start', textTransform: 'none' }}
              >
                {file.file_name || 'Файл'}
              </Button>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Файлов пока нет.</Typography>
        )}

        <Typography variant="overline" color="text.secondary" fontWeight={800} sx={{ display: 'block', mt: 2.5 }}>
          Связанные объекты
        </Typography>
        {relatedObjects.length > 0 ? (
          <Stack spacing={0.5} sx={{ mt: 0.75 }}>
            {relatedObjects.map((item) => (
              <Box key={`${item.kind || item.type || ''}:${item.id || item.object_id || item.title}`} sx={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 1 }}>
                <LinkRoundedIcon color="action" fontSize="small" />
                <Typography variant="body2">{item.title}</Typography>
              </Box>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>Связанных карточек пока нет.</Typography>
        )}

        <Divider sx={{ my: 2 }} />
        <Typography variant="overline" color="text.secondary" fontWeight={800}>Настройки диалога</Typography>
        <Stack spacing={0.5} sx={{ mt: 0.75 }}>
          {onCreateNewConversation ? (
            <Button
              startIcon={<AddRoundedIcon />}
              disabled={newConversationCreating}
              onClick={onCreateNewConversation}
              sx={{ minHeight: 44, justifyContent: 'flex-start' }}
            >
              Новый чат с этим помощником
            </Button>
          ) : null}
          <Box>
            <Button
              startIcon={<RestartAltRoundedIcon />}
              disabled={memory.busyKey === 'reset-context'}
              onClick={() => void memory.resetContext()}
              sx={{ minHeight: 44, justifyContent: 'flex-start' }}
            >
              Сбросить контекст
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1.5 }}>
              Старые сообщения останутся видимыми, но помощник перестанет учитывать их в новых ответах.
            </Typography>
          </Box>
          <Button
            startIcon={<PushPinOutlinedIcon />}
            disabled={settingsUpdating}
            onClick={() => onUpdateConversationSettings?.({ is_pinned: !activeConversation?.is_pinned })}
            sx={{ minHeight: 44, justifyContent: 'flex-start' }}
          >
            {activeConversation?.is_pinned ? 'Открепить диалог' : 'Закрепить диалог'}
          </Button>
          <Button
            startIcon={<ArchiveOutlinedIcon />}
            disabled={settingsUpdating}
            onClick={() => onUpdateConversationSettings?.({ is_archived: !activeConversation?.is_archived })}
            sx={{ minHeight: 44, justifyContent: 'flex-start' }}
          >
            {activeConversation?.is_archived ? 'Вернуть из архива' : 'Архивировать диалог'}
          </Button>
        </Stack>
      </Box>

      <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <SmartToyOutlinedIcon color="action" fontSize="small" />
        <Typography variant="caption" color="text.secondary">
          Агент видит только разрешённые вам данные и действия.
        </Typography>
      </Box>

      <Dialog
        open={Boolean(editingMemory)}
        onClose={() => setEditingMemory(null)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="ai-memory-edit-title"
      >
        <DialogTitle id="ai-memory-edit-title">Изменить факт памяти</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            margin="dense"
            label="Что помощнику нужно помнить"
            value={editingMemoryContent}
            onChange={(event) => setEditingMemoryContent(event.target.value)}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingMemory(null)} sx={{ minHeight: 44 }}>Отмена</Button>
          <Button
            variant="contained"
            disabled={!editingMemoryContent.trim() || memory.busyKey === String(editingMemory?.id || '')}
            onClick={() => void submitMemoryEdit()}
            sx={{ minHeight: 44 }}
          >
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={clearMemoryOpen}
        onClose={() => setClearMemoryOpen(false)}
        fullWidth
        maxWidth="xs"
        aria-labelledby="ai-memory-clear-title"
      >
        <DialogTitle id="ai-memory-clear-title">Очистить личную память?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Все сохранённые предпочтения и рабочие факты будут удалены. История чатов не изменится.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearMemoryOpen(false)} sx={{ minHeight: 44 }}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disabled={memory.busyKey === 'clear'}
            onClick={async () => {
              const cleared = await memory.clear();
              if (cleared) setClearMemoryOpen(false);
            }}
            sx={{ minHeight: 44 }}
          >
            Очистить
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
