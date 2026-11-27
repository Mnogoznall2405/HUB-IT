// Полоса подсказок стикеров над композером (Telegram Desktop parity):
// пока последний токен ввода — эмодзи, предлагает подходящие стикеры
// из «недавних», «избранных» и наборов. Данные и поисковый индекс —
// из единого scoped store (lib/chatStickerStore): каталог грузится
// лениво по первому эмодзи-токену и разделяется с вкладкой стикеров.
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Box } from '@mui/material';
import { alpha } from '@mui/material/styles';

import {
  ensureChatStickerData,
  getStickerSearchIndex,
  peekStickerScopeRecord,
  rememberRecentSticker,
  subscribeChatStickerStore,
} from '../../lib/chatStickerStore';
import {
  getEmojiKeywordIndexVersion,
  subscribeEmojiKeywordIndex,
} from '../../lib/chat/emojiKeywordIndex';
import ChatStickerThumbnail from './ChatStickerThumbnail';
import {
  collectStickerSuggestions,
  readStickerSuggestionsEnabled,
  STICKER_SUGGESTIONS_EVENT,
} from './stickerSearchIndex';

const SUGGESTION_LIMIT = 12;
const THUMB_SIZE = 40;
const BUTTON_SIZE = 46;
const EMPTY_SEARCH_INDEX = [];

const ChatStickerSuggestions = memo(forwardRef(function ChatStickerSuggestions({
  theme,
  ui,
  compactMobile = false,
  emojiToken = '',
  onSendSticker,
  currentUserId = null,
  onStickerSent,
  // Открытый поповер/док эмодзи — сам полная поверхность стикеров:
  // полоса подсказок тогда не показывается, каталог не грузится и Escape
  // не перехватывается (он закрывает панель).
  pickerOpen = false,
}, ref) {
  const stickerScope = useMemo(() => ({ userId: currentUserId }), [currentUserId]);
  // Узкая подписка: dv растёт только при смене массивов данных — статусные
  // флипы загрузки (loading/error) полосу не перерендеривают.
  const stickerDataVersion = useSyncExternalStore(
    subscribeChatStickerStore,
    useCallback(() => peekStickerScopeRecord(stickerScope).dv, [stickerScope]),
  );
  const scopeKey = peekStickerScopeRecord(stickerScope).key;
  const [enabled, setEnabled] = useState(() => readStickerSuggestionsEnabled());
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

  // Ленивая загрузка каталога: запрос идёт только при включённой
  // настройке и появившемся первом эмодзи-токене. Каталог привязан к
  // scope — смена аккаунта перечитывает его через новый ключ. Открытая
  // панель эмодзи/стикеров подавляет и запрос, и полосу.
  useEffect(() => {
    if (!enabled || !emojiToken || pickerOpen) return;
    ensureChatStickerData(stickerScope);
  }, [enabled, emojiToken, pickerOpen, stickerScope]);

  useEffect(() => {
    setDismissedToken('');
    setActiveIndex(-1);
  }, [emojiToken]);

  // Версия CLDR-словаря — второй (после dv) триггер пересчёта: lazy-чанк
  // ключевых слов приезжает позже первой сборки индекса, и store
  // перестраивает его с полным словарём (issue #82). Без подписки
  // обновление доехало бы только со следующим keystroke пользователя.
  const emojiKeywordsVersion = useSyncExternalStore(
    subscribeEmojiKeywordIndex,
    getEmojiKeywordIndexVersion,
  );
  // Стабильный индекс из store: строится один раз на поколение данных и
  // разделяется с вкладкой. Работа на каждый токен — только дешёвый
  // lookup по готовому индексу. stickerDataVersion — триггер пересчёта
  // при смене данных scope.
  const searchIndex = useMemo(
    () => (emojiToken ? getStickerSearchIndex(scopeKey) : EMPTY_SEARCH_INDEX),
    [emojiToken, scopeKey, stickerDataVersion, emojiKeywordsVersion],
  );
  const suggestions = useMemo(
    () => collectStickerSuggestions(searchIndex, emojiToken, SUGGESTION_LIMIT),
    [searchIndex, emojiToken],
  );

  const visible = enabled
    && !pickerOpen
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
      // «Недавние» — через store: вкладка стикеров (и поповер, и док)
      // видит обновление без событий и повторных чтений localStorage.
      rememberRecentSticker(scopeKey, stickerId);
      setActiveIndex(-1);
      onStickerSent?.();
    } finally {
      sendingRef.current.delete(stickerId);
    }
  }, [onSendSticker, scopeKey, onStickerSent]);

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
