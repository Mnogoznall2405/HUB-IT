// Вертикальный список автоподсказки эмодзи по `:keyword` над композером
// (Telegram Desktop parity, issue #82). Данные — полный CLDR индекс
// (lib/chat/emojiKeywordIndex): lazy-чанк грузится по первому триггеру,
// подписка на версию перерисовывает список, когда индекс готов.
// Клавиатура идёт из композера через imperative handleComposerKey —
// как у полосы стикеров: без активной выдачи события не перехватываются
// и Enter остаётся отправкой сообщения.
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
import { Box, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

import {
  ensureEmojiKeywordIndex,
  peekEmojiKeywordIndex,
  searchEmojiKeywords,
  subscribeEmojiKeywordIndex,
} from '../../lib/chat/emojiKeywordIndex';
import ChatEmojiImage from './ChatEmoji';

const SUGGESTION_LIMIT = 8;
// Esc прячет список только для текущего ключа триггера: новая буква
// в запросе перевооружает подсказку — как в Telegram Desktop.
const dismissKeyOf = (trigger) => (
  trigger ? `${Number(trigger.start)}:${String(trigger.query || '')}` : ''
);

const ChatEmojiSuggestions = memo(forwardRef(function ChatEmojiSuggestions({
  theme,
  ui,
  compactMobile = false,
  emojiTrigger = null,
  onPickEmoji,
  listId,
  onStateChange,
}, ref) {
  // Версия индекса — единственный сигнал перерисовки: индекс неизменен
  // после загрузки, поэтому подписка стреляет максимум один-два раза
  // за сессию (загрузка чанка, тестовый сброс).
  const [indexVersion, setIndexVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeEmojiKeywordIndex(() => {
      if (!cancelled) setIndexVersion((current) => current + 1);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const query = String(emojiTrigger?.query || '');
  const triggerActive = Boolean(emojiTrigger) && query.length > 0;

  // Первый триггер догружает чанк словаря. Повторные вызовы — дешёвый
  // no-op (in-flight дедуп внутри ensure), поэтому дебаунс не нужен.
  useEffect(() => {
    if (!triggerActive) return;
    void ensureEmojiKeywordIndex();
  }, [triggerActive]);

  const results = useMemo(() => {
    if (!triggerActive) return [];
    // indexVersion входит в зависимости осознанно: индекс приходит
    // поздно, и выдача пересчитывается без новых keystroke пользователя.
    void indexVersion;
    return searchEmojiKeywords(peekEmojiKeywordIndex(), query, SUGGESTION_LIMIT);
  }, [triggerActive, query, indexVersion]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedKey, setDismissedKey] = useState('');
  const listRef = useRef(null);

  const dismissKey = dismissKeyOf(emojiTrigger);
  useEffect(() => {
    setActiveIndex(0);
  }, [dismissKey]);

  const visible = triggerActive && results.length > 0 && dismissedKey !== dismissKey;
  const visibleRef = useRef(false);
  visibleRef.current = visible;

  // Refs для imperative handle: коллбэк регистрируется один раз, но
  // читает актуальные результаты/выбор — иначе замыкание устарело бы.
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const triggerRef = useRef(emojiTrigger);
  triggerRef.current = emojiTrigger;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Aria-состояние композера: textarea с role=combobox ведёт список через
  // aria-activedescendant, а выбор живёт здесь — сообщаем наверх только
  // факты (видимость/активная строка/размер выдачи), эффектом, не рендером.
  useEffect(() => {
    if (typeof onStateChange !== 'function') return undefined;
    onStateChange(visible
      ? { visible: true, activeIndex: Math.max(0, Math.min(activeIndex, results.length - 1)), count: results.length }
      : null);
    return undefined;
  }, [visible, activeIndex, results.length, onStateChange]);

  const pickSuggestion = useCallback((entry) => {
    if (!entry || typeof onPickEmoji !== 'function') return;
    onPickEmoji(entry);
  }, [onPickEmoji]);

  // ↑/↓ — навигация, Enter/Tab — вставка, Esc — скрыть только список.
  // Без модификаторов (как в упоминаниях): Shift+Enter остаётся переносом
  // строки, а не вставкой эмодзи.
  useImperativeHandle(ref, () => ({
    handleComposerKey: (event) => {
      if (!visibleRef.current) return false;
      const count = resultsRef.current.length;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setDismissedKey(dismissKeyOf(triggerRef.current));
        return true;
      }
      if (count === 0) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % count);
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + count) % count);
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab')
        && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        pickSuggestionRef.current(resultsRef.current[Math.max(0, Math.min(activeIndexRef.current, count - 1))]);
        return true;
      }
      return false;
    },
  }), []);

  const pickSuggestionRef = useRef(pickSuggestion);
  pickSuggestionRef.current = pickSuggestion;

  useEffect(() => {
    if (!visible) return;
    listRef.current
      ?.querySelector('[data-suggestion-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, visible]);

  if (!visible) return null;

  const accent = ui.accentText || theme.palette.primary.main;
  const composerPrimaryText = ui.textPrimary || theme.palette.text.primary;
  const composerAuxColor = ui.textSecondary || theme.palette.text.secondary;
  const clampedActiveIndex = Math.max(0, Math.min(activeIndex, results.length - 1));

  return (
    <Box
      ref={listRef}
      data-testid="chat-emoji-suggestions"
      id={listId}
      role="listbox"
      aria-label="Подсказки эмодзи"
      sx={{
        mt: compactMobile ? 0.8 : 1,
        mb: 0.75,
        overflowY: 'auto',
        maxHeight: 'min(280px, 34dvh)',
        overscrollBehavior: 'contain',
        borderRadius: compactMobile ? 3 : 2,
        border: `1px solid ${ui.borderSoft || theme.palette.divider}`,
        bgcolor: alpha(ui.composerDockBg || ui.composerBg || theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.98 : 0.96),
        boxShadow: theme.palette.mode === 'dark'
          ? '0 14px 32px rgba(0,0,0,0.28)'
          : '0 14px 32px rgba(15,23,42,0.14)',
      }}
    >
      {results.map((entry, index) => {
        const selected = index === clampedActiveIndex;
        return (
          <Box
            key={entry.emojiNorm}
            component="button"
            type="button"
            role="option"
            aria-selected={selected}
            data-suggestion-active={selected ? 'true' : undefined}
            data-testid={`chat-emoji-suggestion-${index}`}
            id={listId ? `${listId}-${index}` : undefined}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (!compactMobile) return;
              event.preventDefault();
              pickSuggestion(entry);
            }}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => pickSuggestion(entry)}
            sx={{
              width: '100%',
              minHeight: compactMobile ? 44 : 36,
              px: 1.1,
              py: 0.4,
              border: 'none',
              bgcolor: selected ? alpha(accent, 0.13) : 'transparent',
              color: composerPrimaryText,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              textAlign: 'left',
              cursor: 'pointer',
              '&:hover': {
                bgcolor: alpha(accent, 0.1),
              },
            }}
          >
            <Box sx={{ width: 24, height: 24, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
              <ChatEmojiImage emoji={entry.emoji} size={22} />
            </Box>
            <Typography noWrap sx={{ flexShrink: 0, fontSize: compactMobile ? 14.5 : 13.5, fontWeight: 700, lineHeight: 1.2 }}>
              {entry.label || entry.emoji}
            </Typography>
            <Typography noWrap sx={{ minWidth: 0, flex: 1, fontSize: compactMobile ? 13 : 12, lineHeight: 1.25, color: composerAuxColor }}>
              :{entry.keyword}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}));

export default ChatEmojiSuggestions;
