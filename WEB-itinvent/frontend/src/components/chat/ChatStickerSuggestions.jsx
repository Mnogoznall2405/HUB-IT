// Полоса подсказок стикеров над композером (Telegram Desktop parity):
// пока последний токен ввода — эмодзи, предлагает подходящие стикеры
// из «недавних», «избранных» и наборов. Каталог грузится лениво по
// первому эмодзи-токену и дальше живёт на кэше listPacks.
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';

import { chatStickersAPI, scheduleRecentStickersSync } from '../../api/chatStickers';
import ChatStickerThumbnail from './ChatStickerThumbnail';
import {
  buildRecentStorageKey,
  buildStickerSearchIndex,
  CHAT_STICKER_RECENTS_EVENT,
  collectStickerSuggestions,
  notifyStickerRecentsChanged,
  readRecentStickerIds,
  readStickerSuggestionsEnabled,
  rememberRecentStickerId,
  STICKER_SUGGESTIONS_EVENT,
} from './stickerSearchIndex';

const SUGGESTION_LIMIT = 12;
const THUMB_SIZE = 40;
const BUTTON_SIZE = 46;

// Частичные моки API в тестах могут не иметь метода — падение промиса
// просто означает «нет данных», полоса тогда не показывается.
const safeApiCall = (call) => {
  try {
    return Promise.resolve(call()).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
};

const ChatStickerSuggestions = memo(forwardRef(function ChatStickerSuggestions({
  theme,
  ui,
  compactMobile = false,
  emojiToken = '',
  onSendSticker,
  currentUserId = null,
  onStickerSent,
}, ref) {
  const recentStorageKey = useMemo(() => buildRecentStorageKey(currentUserId), [currentUserId]);
  const [enabled, setEnabled] = useState(() => readStickerSuggestionsEnabled());
  const [catalog, setCatalog] = useState(null);
  const [recentStickerIds, setRecentStickerIds] = useState(() => readRecentStickerIds(recentStorageKey));
  // Dismissed-токен: Esc прячет полосу, пока токен не исчез/не сменился.
  const [dismissedToken, setDismissedToken] = useState('');
  // -1 — фокус в тексте; ↑ переносит выбор на полосу (как в TDesktop).
  const [activeIndex, setActiveIndex] = useState(-1);
  const stripRef = useRef(null);
  const sendingRef = useRef(new Set());

  useEffect(() => {
    const syncSetting = () => setEnabled(readStickerSuggestionsEnabled());
    window.addEventListener(STICKER_SUGGESTIONS_EVENT, syncSetting);
    return () => window.removeEventListener(STICKER_SUGGESTIONS_EVENT, syncSetting);
  }, []);

  // Ленивая загрузка каталога: запрос идёт только когда появился первый
  // эмодзи-токен. Каталог привязан к пользователю — смена аккаунта его
  // перечитывает.
  useEffect(() => {
    if (!emojiToken || (catalog && catalog.userId === (currentUserId ?? null))) return undefined;
    let cancelled = false;
    const scope = { userId: currentUserId };
    Promise.all([
      safeApiCall(() => chatStickersAPI.listPacks(scope)),
      safeApiCall(() => chatStickersAPI.listFavorites(scope)),
    ]).then(([packsPayload, favoritesPayload]) => {
      if (cancelled) return;
      setCatalog({
        userId: currentUserId ?? null,
        packs: Array.isArray(packsPayload?.items) ? packsPayload.items : [],
        favorites: Array.isArray(favoritesPayload?.items) ? favoritesPayload.items : [],
      });
    });
    return () => { cancelled = true; };
  }, [emojiToken, catalog, currentUserId]);

  // Импорт/удаление наборов инвалидирует каталог — следующий токен
  // подтянет свежий список.
  useEffect(() => {
    const invalidate = () => setCatalog(null);
    window.addEventListener('chat-sticker-packs-changed', invalidate);
    return () => window.removeEventListener('chat-sticker-packs-changed', invalidate);
  }, []);

  useEffect(() => {
    setRecentStickerIds(readRecentStickerIds(recentStorageKey));
  }, [recentStorageKey]);

  useEffect(() => {
    const syncRecents = (event) => {
      const detailKey = String(event?.detail?.storageKey || '');
      if (detailKey && detailKey !== recentStorageKey) return;
      setRecentStickerIds(readRecentStickerIds(recentStorageKey));
    };
    window.addEventListener(CHAT_STICKER_RECENTS_EVENT, syncRecents);
    return () => window.removeEventListener(CHAT_STICKER_RECENTS_EVENT, syncRecents);
  }, [recentStorageKey]);

  useEffect(() => {
    setDismissedToken('');
    setActiveIndex(-1);
  }, [emojiToken]);

  const suggestions = useMemo(() => {
    if (!emojiToken || !catalog) return [];
    const stickersById = new Map([
      ...catalog.favorites.map((sticker) => [String(sticker?.id || ''), sticker]),
      ...catalog.packs.flatMap((pack) => (pack?.stickers || []).map((sticker) => [
        String(sticker?.id || ''),
        sticker?.pack_short_name ? sticker : { ...sticker, pack_short_name: pack.short_name },
      ])),
    ]);
    const recentStickers = recentStickerIds
      .map((stickerId) => stickersById.get(stickerId))
      .filter(Boolean);
    const sections = [
      { id: 'recent', title: 'Недавние', stickers: recentStickers, recent: true },
      { id: 'favorites', title: 'Избранные', stickers: catalog.favorites, favorites: true },
      ...catalog.packs,
    ];
    return collectStickerSuggestions(buildStickerSearchIndex(sections), emojiToken, SUGGESTION_LIMIT);
  }, [emojiToken, catalog, recentStickerIds]);

  const visible = enabled
    && Boolean(emojiToken)
    && typeof onSendSticker === 'function'
    && suggestions.length > 0
    && dismissedToken !== emojiToken;

  const sendSuggestion = useCallback(async (sticker) => {
    const stickerId = String(sticker?.id || '').trim();
    if (!stickerId || sendingRef.current.has(stickerId)) return;
    sendingRef.current.add(stickerId);
    try {
      const sent = await onSendSticker?.(sticker);
      if (sent === false) return;
      const nextIds = rememberRecentStickerId(recentStorageKey, stickerId);
      scheduleRecentStickersSync(nextIds, recentStorageKey);
      setRecentStickerIds(nextIds);
      notifyStickerRecentsChanged(recentStorageKey);
      setActiveIndex(-1);
      onStickerSent?.();
    } finally {
      sendingRef.current.delete(stickerId);
    }
  }, [onSendSticker, recentStorageKey, onStickerSent]);

  // Клавиатура идёт из композера: ↑ входит в полосу, ←/→ ходят по
  // стикерам, Enter/Tab отправляют выбранный, ↓ возвращает фокус в текст,
  // Esc прячет только полосу. Без выбора (activeIndex = -1) события не
  // перехватываются — Enter по-прежнему отправляет сообщение.
  useImperativeHandle(ref, () => ({
    handleComposerKey: (event) => {
      if (!visible) return false;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissedToken(emojiToken);
        setActiveIndex(-1);
        return true;
      }
      if (activeIndex < 0) {
        if (event.key !== 'ArrowUp') return false;
        event.preventDefault();
        setActiveIndex(0);
        return true;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveIndex((current) => Math.min(suggestions.length - 1, current + 1));
        return true;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return true;
      }
      if (event.key === 'ArrowUp') {
        // Курсор уже на полосе — глушим, чтобы не прыгать в начало текста.
        event.preventDefault();
        return true;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex(-1);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const sticker = suggestions[Math.min(activeIndex, suggestions.length - 1)];
        if (sticker) void sendSuggestion(sticker);
        return true;
      }
      return false;
    },
  }), [visible, emojiToken, activeIndex, suggestions, sendSuggestion]);

  useEffect(() => {
    if (activeIndex < 0) return;
    stripRef.current
      ?.querySelector('[data-suggestion-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeIndex]);

  if (!visible) return null;

  const accent = ui.accentText || theme.palette.primary.main;

  return (
    <Box
      ref={stripRef}
      data-testid="chat-sticker-suggestions"
      role="listbox"
      aria-label="Подходящие стикеры"
      sx={{
        mt: compactMobile ? 0.8 : 1,
        mb: 0.75,
        display: 'flex',
        alignItems: 'center',
        gap: 0.4,
        overflowX: 'auto',
        overscrollBehaviorInline: 'contain',
        scrollbarWidth: 'none',
        '&::-webkit-scrollbar': { display: 'none' },
        borderRadius: compactMobile ? 3 : 2,
        border: `1px solid ${ui.borderSoft || theme.palette.divider}`,
        bgcolor: alpha(ui.composerDockBg || ui.composerBg || theme.palette.background.paper, 0.96),
        boxShadow: theme.palette.mode === 'dark'
          ? '0 14px 32px rgba(0,0,0,0.28)'
          : '0 14px 32px rgba(15,23,42,0.14)',
        p: 0.4,
      }}
    >
      {suggestions.map((sticker, index) => (
        <Box
          key={String(sticker.id)}
          component="button"
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          data-suggestion-active={index === activeIndex ? 'true' : undefined}
          aria-label={`Отправить стикер ${sticker.emoji || ''}`.trim()}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void sendSuggestion(sticker)}
          sx={{
            width: BUTTON_SIZE,
            height: BUTTON_SIZE,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            p: 0.2,
            border: 'none',
            borderRadius: 1.5,
            bgcolor: index === activeIndex ? alpha(accent, 0.18) : 'transparent',
            cursor: 'pointer',
            transition: 'background-color 100ms ease, transform 100ms ease',
            '&:hover': { bgcolor: alpha(accent, 0.1) },
            '&:active': { transform: 'scale(0.94)' },
          }}
        >
          <ChatStickerThumbnail sticker={sticker} size={THUMB_SIZE} staticOnly />
        </Box>
      ))}
    </Box>
  );
}));

export default ChatStickerSuggestions;
