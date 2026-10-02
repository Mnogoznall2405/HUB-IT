import { useMemo } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import ChatRightPanelHeader from './ChatRightPanelHeader';
import { HUB_ASSISTANT_TITLE } from './chatHelpers';
import { AiConversationAvatar } from './ChatCommon';
import OpenCodeConversationContext from './OpenCodeConversationContext';
import AiPersonalMemoryManager from './AiPersonalMemoryManager';
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
    {
      key: 'hub',
      label: 'Данные HUB',
      status: agent?.live_data_enabled ? 'Доступ разрешён' : 'Нет доступа',
      enabled: Boolean(agent?.live_data_enabled),
    },
    { key: 'kb', label: 'База знаний', status: 'Доступ разрешён', enabled: true },
    {
      key: 'mail',
      label: 'Почта',
      status: 'Только черновики',
      enabled: true,
    },
    {
      key: 'docs',
      label: 'Создание документов',
      status: (isGenericAgent || agent?.allow_generated_artifacts) ? 'Требует подтверждения' : 'Нет доступа',
      enabled: Boolean(isGenericAgent || agent?.allow_generated_artifacts),
    },
  ].filter((item) => item.key !== 'hub' || agent?.live_data_enabled || isGenericAgent), [agent, isGenericAgent]);

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
      <ChatRightPanelHeader
        title="О диалоге"
        onClose={onClose}
        closeLabel="Закрыть информацию об агенте"
      />

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, py: 2.5 }}>
        <Stack alignItems="center" spacing={1.25} sx={{ textAlign: 'center', mb: 3 }}>
          <AiConversationAvatar size={72} />
          <Typography variant="h6" fontWeight={800}>
            {agent?.title || HUB_ASSISTANT_TITLE}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300 }}>
            {agent?.description || 'Личный помощник для общения, базы знаний, анализа файлов и создания документов.'}
          </Typography>
        </Stack>

        <Typography variant="overline" color="text.secondary" fontWeight={800}>Возможности</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" gap={1} sx={{ mt: 1, mb: 2.5 }}>
          {capabilities.map((item) => (
            <Chip
              key={item.key}
              label={`${item.label} · ${item.status}`}
              size="small"
              color={item.enabled ? 'primary' : 'default'}
              variant={item.enabled ? 'outlined' : 'filled'}
            />
          ))}
        </Stack>

        <Divider />
        <Stack spacing={1} sx={{ py: 2 }}>
          <Button startIcon={<SearchRoundedIcon />} onClick={onOpenSearch} sx={{ minHeight: 44, justifyContent: 'flex-start' }}>
            Поиск по диалогу
          </Button>
          {agent?.allow_file_input !== false ? (
            <Button startIcon={<AttachFileRoundedIcon />} onClick={onOpenFilePicker} sx={{ minHeight: 44, justifyContent: 'flex-start' }}>
              Файлы диалога {files.length} · Добавить
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
          Память ассистента
        </Typography>
        <AiPersonalMemoryManager
          memory={memory}
          available={personalMemoryAvailable}
          unavailableText="OpenCode работает только с сообщениями и файлами текущей сессии. Общая память для него отключена."
        />

        <Divider />
        <Typography variant="overline" color="text.secondary" fontWeight={800} sx={{ display: 'block', mt: 2 }}>
          Контекст текущего диалога
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, mb: 2 }}>
          Используются последние 20 сообщений. Этот контекст не сохраняется в память ассистента.
        </Typography>

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

    </Box>
  );
}
