import { memo, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import ForwardRoundedIcon from '@mui/icons-material/ForwardRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';

import { chatAPI } from '../../api/client';
import { ConversationAvatar } from './ChatCommon';
import { getConversationDisplayTitle, resolveActiveAiBotRecord } from './chatHelpers';
import { CHAT_DEFAULT_FONT_SIZES, CHAT_FONT_FAMILY } from './chatUiTokens';

export const CHAT_CONNECTION_INDICATOR_DELAY_MS = 2_000;

const resolveChatConnectionLabel = (socketStatus, offline) => {
  const status = String(socketStatus || '').trim();
  if (status === 'unauthorized' || status === 'forbidden') return 'Сессия истекла';
  if (offline) return 'Нет сети';
  if (!status || status === 'connected') return '';
  return 'Соединение…';
};

function useChatConnectionLabel(socketStatus) {
  const [offline, setOffline] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false,
  );
  const [label, setLabel] = useState('');
  // First moment the socket left 'connected' — switching between unhealthy
  // statuses must not restart the 2s countdown; 'connected' resets it at once.
  const unhealthySinceRef = useRef(0);

  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const next = resolveChatConnectionLabel(socketStatus, offline);
    if (!next) {
      unhealthySinceRef.current = 0;
      setLabel('');
      return undefined;
    }
    if (!unhealthySinceRef.current) unhealthySinceRef.current = Date.now();
    const elapsed = Date.now() - unhealthySinceRef.current;
    const delay = Math.max(0, CHAT_CONNECTION_INDICATOR_DELAY_MS - elapsed);
    const timerId = window.setTimeout(() => setLabel(next), delay);
    return () => window.clearTimeout(timerId);
  }, [socketStatus, offline]);

  return label;
}

export const AI_STAGE_LABELS = {
  analyzing_request: 'Определяю задачу',
  reading_files: 'Проверяю вложенные файлы',
  retrieving_kb: 'Ищу в базе знаний',
  checking_itinvent: 'Проверяю данные ITinvent',
  checking_ad: 'Проверяю данные сотрудников',
  searching_equipment: 'Ищу оборудование',
  opening_equipment_card: 'Открываю карточку HUB',
  generating_answer: 'Формирую ответ',
  generating_files: 'Подготавливаю файлы',
  converting_document: 'Преобразую документ',
};

function HeaderAction({ title, children, onClick, active = false, compactMobile = false, hidden = false, disabled = false, density }) {
  if (hidden) return null;
  const actionSize = compactMobile
    ? Math.max(density?.touchTarget || 44, density?.threadHeaderAction || 44)
    : (density?.threadHeaderAction || 34);
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          aria-label={title}
          onClick={onClick}
          disabled={disabled}
          sx={{
            width: actionSize,
            height: actionSize,
            borderRadius: 0,
            color: active ? 'var(--chat-action-active-text)' : 'inherit',
            bgcolor: 'transparent',
            transition: 'opacity 100ms ease, background-color 120ms ease, transform 120ms ease',
            ...(compactMobile ? {
              '&:active': {
                opacity: 0.62,
                transform: 'scale(0.96)',
              },
            } : {
              '&:hover': {
                bgcolor: active ? 'var(--chat-action-active-bg)' : 'var(--chat-action-hover-bg)',
              },
            }),
            '&.Mui-disabled': {
              opacity: 0.36,
              color: 'inherit',
            },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

// AI5: queued/running без обновления updated_at дольше этого порога —
// зависший запуск. Формат статуса теперь рендерит AiRunFeedStatus
// внутри ленты сообщений (ChatMessageList).
export const AI_RUN_STALE_AFTER_MS = 5 * 60 * 1000;

// AI9/Д7: выпадающий выбор ассистента в шапке AI-беседы («ИИ-помощник ▾»).
// Список ботов подгружается лениво при первом открытии; выбор открывает
// последнюю беседу бота, «Новый чат» создаёт свежую. Навигация — через
// существующий ?conversation= bootstrap, без изменения контроллеров.
function AiAssistantSelect({ activeConversation, activeAiBot, aiStatus, navigate, theme, ui, compactMobile }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const [bots, setBots] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [openingKey, setOpeningKey] = useState('');
  const menuOpen = Boolean(anchorEl);

  const loadBots = async () => {
    if (bots !== null || loading) return;
    setLoading(true);
    setLoadError('');
    try {
      const data = await chatAPI.listAiBots();
      setBots(Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []));
    } catch {
      setLoadError('Не удалось загрузить список ассистентов.');
    } finally {
      setLoading(false);
    }
  };

  const botItems = Array.isArray(bots) ? bots : [];
  const currentBot = resolveActiveAiBotRecord({
    aiBots: botItems,
    activeConversationId: activeConversation?.id,
    aiStatus,
  }) || activeAiBot || null;
  const currentBotId = String(currentBot?.id || currentBot?.bot_id || '').trim();
  const buttonTitle = String(currentBot?.title || activeAiBot?.title || 'HUB Ассистент').trim() || 'HUB Ассистент';

  const openConversationForResponse = (conversation) => {
    const conversationId = String(conversation?.id || conversation?.conversation_id || '').trim();
    if (!conversationId || typeof navigate !== 'function') return false;
    setAnchorEl(null);
    navigate(`/chat?conversation=${encodeURIComponent(conversationId)}`);
    return true;
  };

  const handleSelectBot = async (bot) => {
    const botId = String(bot?.id || bot?.bot_id || '').trim();
    if (!botId || openingKey) return;
    setOpeningKey(botId);
    setLoadError('');
    try {
      const conversation = await chatAPI.openAiBotConversation(botId);
      openConversationForResponse(conversation);
    } catch {
      setLoadError('Не удалось открыть чат с ассистентом.');
    } finally {
      setOpeningKey('');
    }
  };

  const handleCreateChat = async () => {
    if (openingKey) return;
    setOpeningKey('new');
    setLoadError('');
    try {
      const conversation = currentBotId
        ? await chatAPI.createAiBotConversation(currentBotId)
        : await chatAPI.createAiConversation();
      openConversationForResponse(conversation);
    } catch {
      setLoadError('Не удалось создать новый чат.');
    } finally {
      setOpeningKey('');
    }
  };

  return (
    <>
      <Tooltip title="Выбрать ассистента">
        <Button
          size="small"
          data-testid="chat-ai-assistant-select"
          aria-label={`Ассистент: ${buttonTitle}`}
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onClick={(event) => {
            setAnchorEl(event.currentTarget);
            void loadBots();
          }}
          startIcon={<SmartToyOutlinedIcon sx={{ fontSize: 16 }} />}
          endIcon={<KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />}
          sx={{
            minHeight: compactMobile ? 36 : 30,
            maxWidth: compactMobile ? 168 : 220,
            px: compactMobile ? 1 : 1.2,
            borderRadius: 999,
            textTransform: 'none',
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: CHAT_FONT_FAMILY,
            color: ui.accentText,
            bgcolor: alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.1),
            '& .MuiButton-startIcon': { mr: 0.4 },
            '& .MuiButton-endIcon': { ml: 0.2 },
            '&:hover': { bgcolor: alpha(ui.accentText || theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.16) },
          }}
        >
          <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {buttonTitle}
          </Box>
        </Button>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={menuOpen}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        data-testid="chat-ai-assistant-menu"
      >
        {loading ? (
          <MenuItem disabled>
            <CircularProgress size={16} sx={{ mr: 1.2 }} />
            <ListItemText primary="Загружаю ассистентов…" />
          </MenuItem>
        ) : null}
        {botItems.map((bot) => {
          const botId = String(bot?.id || bot?.bot_id || '').trim();
          const title = String(bot?.title || 'Ассистент').trim() || 'Ассистент';
          const isCurrent = Boolean(botId) && botId === currentBotId;
          return (
            <MenuItem
              key={botId || title}
              disabled={!botId || Boolean(openingKey)}
              onClick={() => void handleSelectBot(bot)}
              selected={isCurrent}
            >
              <ListItemIcon sx={{ minWidth: 26 }}>
                {openingKey === botId
                  ? <CircularProgress size={15} />
                  : isCurrent
                    ? <CheckRoundedIcon sx={{ fontSize: 17 }} />
                    : null}
              </ListItemIcon>
              <ListItemText
                primary={title}
                secondary={String(bot?.description || '').trim() || undefined}
                secondaryTypographyProps={{ noWrap: true, sx: { maxWidth: 260 } }}
              />
            </MenuItem>
          );
        })}
        {botItems.length > 0 ? <Divider sx={{ my: 0.5 }} /> : null}
        <MenuItem
          data-testid="chat-ai-new-chat"
          disabled={Boolean(openingKey)}
          onClick={() => void handleCreateChat()}
        >
          <ListItemIcon sx={{ minWidth: 26 }}>
            {openingKey === 'new' ? <CircularProgress size={15} /> : <AddRoundedIcon sx={{ fontSize: 18 }} />}
          </ListItemIcon>
          <ListItemText primary="Новый чат с ассистентом" />
        </MenuItem>
        {loadError ? (
          <MenuItem disabled dense>
            <ListItemText
              primary={loadError}
              primaryTypographyProps={{ fontSize: 12, color: 'error.main' }}
            />
          </MenuItem>
        ) : null}
      </Menu>
    </>
  );
}

const ChatThreadHeader = memo(function ChatThreadHeader({
  theme,
  ui,
  isMobile,
  compactMobile,
  fullWidth = false,
  activeConversation,
  activeAiBot,
  aiStatus,
  navigate,
  headerSubtitle,
  typingLine,
  socketStatus,
  contextPanelOpen,
  onBack,
  backLabel = 'Назад к чатам',
  onOpenDrawer,
  onOpenInfo,
  onOpenTask,
  onOpenSearch,
  onOpenMenu,
  selectionMode = false,
  selectedMessageCount = 0,
  canCopySelectedMessages = false,
  canDeleteSelectedMessages = false,
  onClearMessageSelection,
  onCopySelectedMessages,
  onForwardSelectedMessages,
  onDeleteSelectedMessages,
}) {
  const density = ui.density || {};
  const taskId = String(activeConversation?.task_id || '').trim();
  const headerTitle = getConversationDisplayTitle(activeConversation);
  const connectionLabel = useChatConnectionLabel(socketStatus);
  const resolvedSubtitle = connectionLabel || typingLine || headerSubtitle;
  const openHeaderPrimary = () => {
    if (taskId && typeof onOpenTask === 'function') {
      onOpenTask(taskId);
      return;
    }
    onOpenInfo?.();
  };
  const headerShellSx = {
    px: { xs: compactMobile ? 0.65 : 1.15, md: density.threadHeaderPx || 1.6 },
    pb: compactMobile ? 0.45 : (density.threadHeaderPb || 0.78),
    bgcolor: ui.threadTopbarBg,
    backdropFilter: 'blur(16px)',
    position: 'sticky',
    top: 0,
    zIndex: 5,
    boxShadow: theme.palette.mode === 'dark' ? 'none' : `0 1px 0 ${ui.borderSoft}, 0 6px 14px ${alpha('#000', 0.06)}`,
    borderBottom: theme.palette.mode === 'dark' ? `0.5px solid ${ui.borderSoft}` : 'none',
  };
  const headerContentSx = {
    maxWidth: compactMobile || fullWidth ? '100%' : `${Number(density.contentMaxWidth || ui.contentMaxWidth || 980) + 56}px`,
    mx: 'auto',
    width: '100%',
  };

  if (selectionMode && compactMobile) {
    const selectionIconButtonSx = {
      width: 38,
      height: 38,
      borderRadius: 0,
      color: theme.palette.text.primary,
      bgcolor: 'transparent',
      transition: 'opacity 120ms ease, transform 120ms ease',
      '&:active': {
        opacity: 0.62,
        transform: 'scale(0.96)',
      },
      '&:disabled': {
        opacity: 0.34,
      },
    };

    return (
      <Box
        className="chat-safe-top chat-no-select"
        data-testid="chat-selection-toolbar"
        sx={{
          ...headerShellSx,
          px: 0.65,
          pb: 0.3,
          bgcolor: alpha(ui.threadTopbarBg || theme.palette.background.paper, 0.98),
          backdropFilter: 'blur(18px) saturate(1.06)',
          borderBottom: `1px solid ${ui.borderSoft || alpha(theme.palette.divider, 0.14)}`,
          boxShadow: 'none',
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            ...headerContentSx,
            minHeight: 44,
          }}
        >
          <Stack direction="row" spacing={0.9} alignItems="center" sx={{ minWidth: 0 }}>
            <IconButton
              data-testid="chat-selection-clear"
              aria-label="Отменить выделение"
              onClick={onClearMessageSelection}
              sx={selectionIconButtonSx}
            >
              <CloseRoundedIcon sx={{ fontSize: 28 }} />
            </IconButton>
            <Typography
              data-testid="chat-selection-count-badge"
              sx={{
                color: theme.palette.text.primary,
                fontSize: 21,
                fontWeight: 700,
                lineHeight: 1,
                fontFamily: CHAT_FONT_FAMILY,
              }}
            >
              {selectedMessageCount}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={0.65} alignItems="center">
            <IconButton
              data-testid="chat-selection-copy-action"
              aria-label="Копировать"
              disabled={!canCopySelectedMessages || selectedMessageCount <= 0 || typeof onCopySelectedMessages !== 'function'}
              onClick={onCopySelectedMessages}
              sx={selectionIconButtonSx}
            >
              <ContentCopyRoundedIcon sx={{ fontSize: 25 }} />
            </IconButton>
            <IconButton
              data-testid="chat-selection-header-forward-action"
              aria-label="Переслать"
              disabled={selectedMessageCount <= 0 || typeof onForwardSelectedMessages !== 'function'}
              onClick={onForwardSelectedMessages}
              sx={selectionIconButtonSx}
            >
              <ForwardRoundedIcon sx={{ fontSize: 27 }} />
            </IconButton>
            <IconButton
              data-testid="chat-selection-header-delete-action"
              aria-label="Удалить"
              disabled={!canDeleteSelectedMessages || selectedMessageCount <= 0 || typeof onDeleteSelectedMessages !== 'function'}
              onClick={onDeleteSelectedMessages}
              sx={{ ...selectionIconButtonSx, color: theme.palette.error.main }}
            >
              <DeleteRoundedIcon sx={{ fontSize: 25 }} />
            </IconButton>
          </Stack>
        </Stack>
      </Box>
    );
  }

  if (selectionMode) {
    return (
      <Box className="chat-safe-top chat-no-select" data-testid="chat-selection-toolbar" sx={headerShellSx}>
        <Stack
          direction="row"
          spacing={compactMobile ? 0.85 : 1.05}
          alignItems="center"
          justifyContent="space-between"
          sx={headerContentSx}
        >
          <Stack direction="row" spacing={compactMobile ? 0.75 : 1} alignItems="center" sx={{ minWidth: 0 }}>
            {isMobile ? (
              <IconButton
                size="small"
                onClick={onBack}
                aria-label={backLabel}
                sx={{
                  ml: -0.2,
                  width: compactMobile ? 44 : 38,
                  height: compactMobile ? 44 : 38,
                  borderRadius: 0,
                  bgcolor: 'transparent',
                }}
              >
                <ArrowBackRoundedIcon />
              </IconButton>
            ) : null}
            <Box
              data-testid="chat-selection-count-badge"
              sx={{
                width: compactMobile ? 34 : 36,
                height: compactMobile ? 34 : 36,
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                bgcolor: ui.accentText || theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
                fontWeight: 850,
                fontSize: compactMobile ? 16 : 17,
                fontFamily: CHAT_FONT_FAMILY,
              }}
            >
              {selectedMessageCount}
            </Box>
            <Box
              component="button"
              type="button"
              onClick={openHeaderPrimary}
              aria-label={taskId ? 'Открыть задачу' : 'Информация о чате'}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: compactMobile ? '10px' : '12px',
                p: 0,
                border: 'none',
                bgcolor: 'transparent',
                color: theme.palette.text.primary,
                textAlign: 'left',
                cursor: 'pointer',
                minWidth: 0,
              }}
            >
              <ConversationAvatar
                conversation={activeConversation}
                online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
                size={compactMobile ? 40 : (density.threadHeaderAvatar || 42)}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerTitleMobile : (density.threadHeaderTitleFontSize || CHAT_DEFAULT_FONT_SIZES.desktopPrimary), letterSpacing: '-0.01em', fontFamily: CHAT_FONT_FAMILY }} noWrap>
                  {headerTitle}
                </Typography>
                <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerSubtitleMobile : (density.threadHeaderSubtitleFontSize || '0.82rem'), lineHeight: 1.12, fontFamily: CHAT_FONT_FAMILY }} noWrap>
                  {resolvedSubtitle}
                </Typography>
              </Box>
            </Box>
          </Stack>

          <HeaderAction
            title="Действия чата"
            onClick={onOpenMenu}
            active={contextPanelOpen}
            compactMobile={compactMobile}
            density={density}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </HeaderAction>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      className="chat-safe-top chat-no-select"
      sx={headerShellSx}
    >
      <Stack
        direction="row"
        spacing={compactMobile ? 0.85 : 1.05}
        alignItems="center"
        justifyContent="space-between"
        sx={{
          ...headerContentSx,
        }}
      >
        <Stack direction="row" spacing={compactMobile ? 0.75 : 1} alignItems="center" sx={{ minWidth: 0 }}>
          {isMobile ? (
            <IconButton
              size="small"
              onClick={onBack}
              aria-label={backLabel}
              sx={{
                ml: -0.2,
                width: compactMobile ? 44 : 38,
                height: compactMobile ? 44 : 38,
                borderRadius: 0,
                bgcolor: 'transparent',
                '&:active': compactMobile ? {
                  opacity: 0.62,
                  transform: 'scale(0.96)',
                } : undefined,
              }}
            >
              <ArrowBackRoundedIcon />
            </IconButton>
          ) : null}

          <Box
            component="button"
            type="button"
            onClick={openHeaderPrimary}
            aria-label={taskId ? 'Открыть задачу' : 'Информация о чате'}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: compactMobile ? '10px' : '12px',
              p: 0,
              border: 'none',
              bgcolor: 'transparent',
              color: theme.palette.text.primary,
              textAlign: 'left',
              cursor: 'pointer',
              minWidth: 0,
              '&:active': compactMobile ? {
                opacity: 0.72,
              } : undefined,
            }}
          >
            <ConversationAvatar
              conversation={activeConversation}
              online={Boolean(activeConversation?.kind === 'direct' && activeConversation?.direct_peer?.presence?.is_online)}
              size={compactMobile ? 40 : (density.threadHeaderAvatar || 42)}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.1, color: theme.palette.text.primary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerTitleMobile : (density.threadHeaderTitleFontSize || CHAT_DEFAULT_FONT_SIZES.desktopPrimary), letterSpacing: '-0.01em', fontFamily: CHAT_FONT_FAMILY }} noWrap>
                {headerTitle}
              </Typography>
              <Typography variant="caption" sx={{ color: ui.textSecondary, fontSize: compactMobile ? CHAT_DEFAULT_FONT_SIZES.headerSubtitleMobile : (density.threadHeaderSubtitleFontSize || '0.82rem'), lineHeight: 1.12, fontFamily: CHAT_FONT_FAMILY }} noWrap>
                {resolvedSubtitle}
              </Typography>
            </Box>
          </Box>
        </Stack>

        <Stack direction="row" spacing={0.1} alignItems="center">
          {String(activeConversation?.kind || '').trim() === 'ai' ? (
            <AiAssistantSelect
              activeConversation={activeConversation}
              activeAiBot={activeAiBot}
              aiStatus={aiStatus}
              navigate={navigate}
              theme={theme}
              ui={ui}
              compactMobile={compactMobile}
            />
          ) : null}
          <HeaderAction title="Поиск по сообщениям" onClick={onOpenSearch} compactMobile={compactMobile} hidden={compactMobile} density={density}>
            <SearchRoundedIcon fontSize="small" />
          </HeaderAction>
          <HeaderAction
            title="Действия чата"
            onClick={onOpenMenu}
            active={contextPanelOpen}
            compactMobile={compactMobile}
            density={density}
          >
            <MoreVertRoundedIcon fontSize="small" />
          </HeaderAction>
        </Stack>
      </Stack>
    </Box>
  );
});


export default ChatThreadHeader;
