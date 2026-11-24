import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Portal,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DeleteSweepRoundedIcon from '@mui/icons-material/DeleteSweepRounded';
import EmojiEmotionsRoundedIcon from '@mui/icons-material/EmojiEmotionsRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import TelegramIcon from '@mui/icons-material/Telegram';

import {
  cancelRecentStickersSync,
  chatStickersAPI,
  getStickerPacksEpoch,
  invalidateStickerPacksCache,
  peekStickerPacksCache,
  primeStickerPacksCache,
  scheduleRecentStickersSync,
} from '../../api/chatStickers';
import ChatStickerManageDialog from './ChatStickerManageDialog';
import ChatStickerMedia from './ChatStickerMedia';
import ChatStickerThumbnail from './ChatStickerThumbnail';
import {
  buildRecentStorageKey,
  buildStickerSearchIndex,
  normalizeStickerSearchQuery,
  notifyStickerRecentsChanged,
  readRecentStickerIds,
  readStickerSuggestionsEnabled,
  RECENT_STICKERS_LIMIT,
  searchStickerIndex,
  STICKER_SUGGESTIONS_EVENT,
  writeRecentStickerIds,
  writeStickerSuggestionsEnabled,
} from './stickerSearchIndex';
import {
  getFileActionsAnchorPosition,
  isFileActionsKeyboardShortcut,
} from '../fileActions/FileActionsContextMenu';

const STICKER_PREVIEW_HOLD_MS = 420;
const STICKER_PREVIEW_MOVE_TOLERANCE_PX = 12;

// Позиция прокрутки списка стикеров переживает закрытие панели —
// Telegram Desktop возвращает пользователя туда, где он остановился.
let persistedStickerScrollTop = 0;
// Поисковый запрос тоже переживает remount поповера/дока — Telegram
// сохраняет его, пока пользователь не очистил поле и не отправил стикер.
let persistedStickerSearchQuery = '';

const getApiError = (error, fallback) => String(
  error?.response?.data?.detail
  || error?.message
  || fallback,
).trim();

const TelegramStickersTab = memo(function TelegramStickersTab({
  theme,
  ui,
  onSendSticker,
  dense = false,
  currentUserId = null,
}) {
  const recentStorageKey = useMemo(() => buildRecentStorageKey(currentUserId), [currentUserId]);
  const cacheScope = useMemo(() => ({ userId: currentUserId }), [currentUserId]);
  const [packs, setPacks] = useState(() => {
    const cached = peekStickerPacksCache(cacheScope);
    return Array.isArray(cached?.items) ? cached.items : [];
  });
  const [activeSectionId, setActiveSectionId] = useState('recent');
  const [recentStickerIds, setRecentStickerIds] = useState(() => readRecentStickerIds(recentStorageKey));
  // Избранное приходит с сервера полными объектами — у стикера может
  // не быть установленного набора, поэтому резолв через stickersById
  // здесь невозможен, в отличие от «недавних».
  const [favoriteStickers, setFavoriteStickers] = useState([]);
  // { sticker, left, top } — меню привязывается к курсору (anchorPosition),
  // а не к кнопке, как в Telegram Desktop.
  const [stickerMenu, setStickerMenu] = useState(null);
  const [loading, setLoading] = useState(() => !Array.isArray(peekStickerPacksCache(cacheScope)?.items));
  const [loadError, setLoadError] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  // «Управление наборами» — диалог со списком, удалением и DnD-порядком.
  const [manageOpen, setManageOpen] = useState(false);
  const [source, setSource] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [statusText, setStatusText] = useState('');
  // Отправка параллельная: блокируется только повторный клик по тому же стикеру.
  const [sendingStickerIds, setSendingStickerIds] = useState({});
  const [previewSticker, setPreviewSticker] = useState(null);
  const sourceInputRef = useRef(null);
  const packStripRef = useRef(null);
  const packTabRefsRef = useRef(new Map());
  const scrollContainerRef = useRef(null);
  const sectionRefsRef = useRef(new Map());
  const scrollFrameRef = useRef(null);
  const pendingScrollSectionRef = useRef('');
  const holdTimerRef = useRef(null);
  const pointerPressRef = useRef(null);
  const keyboardPressRef = useRef(false);
  const holdTriggeredRef = useRef(false);
  const suppressClickRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const openHoldPreview = useCallback((sticker) => {
    holdTriggeredRef.current = true;
    suppressClickRef.current = true;
    setPreviewSticker(sticker);
  }, []);

  const closeHoldPreview = useCallback(() => {
    clearHoldTimer();
    holdTriggeredRef.current = false;
    setPreviewSticker(null);
  }, [clearHoldTimer]);

  const scheduleHoldPreview = useCallback((sticker) => {
    clearHoldTimer();
    holdTriggeredRef.current = false;
    suppressClickRef.current = false;
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      openHoldPreview(sticker);
    }, STICKER_PREVIEW_HOLD_MS);
  }, [clearHoldTimer, openHoldPreview]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  useEffect(() => {
    if (!previewSticker) return undefined;
    const handleEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      suppressClickRef.current = true;
      closeHoldPreview();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeHoldPreview, previewSticker]);

  const applyPackPayload = useCallback((payload, preferredPackId = '', requestEpoch) => {
    // requestEpoch — эпоха кэша на момент старта запроса. Если за время
    // запроса кэш инвалидировали (logout, смена аккаунта, импорт), ответ
    // устарел: ни кэш, ни состояние трогать нельзя.
    if (requestEpoch !== undefined && requestEpoch !== getStickerPacksEpoch()) return;
    const nextPacks = Array.isArray(payload?.items) ? payload.items : [];
    primeStickerPacksCache(cacheScope, payload, requestEpoch);
    setPacks(nextPacks);
    const preferred = String(preferredPackId || '').trim();
    if (preferred && nextPacks.some((item) => item.id === preferred)) {
      setActiveSectionId(preferred);
      pendingScrollSectionRef.current = preferred;
    }
  }, [cacheScope]);

  useEffect(() => {
    setRecentStickerIds(readRecentStickerIds(recentStorageKey));
  }, [recentStorageKey]);

  // Отмена без flush при размонтировании и смене аккаунта: в очереди список
  // прежнего пользователя — слать его под чужой сессией нельзя, а локальная
  // копия уже сохранена в его localStorage-ключ. Дебаунс общий для всех
  // поверхностей отправки (api/chatStickers), scope — ключ хранилища.
  useEffect(() => () => cancelRecentStickersSync(recentStorageKey), [recentStorageKey]);

  // Серверные «недавние» выигрывают у локального кэша; если сервер пуст,
  // а локальная копия есть — поднимаем её наверх один раз (миграция с
  // localStorage-only версии и офлайн-периоды).
  useEffect(() => {
    let cancelled = false;
    chatStickersAPI.listRecentStickers()
      .then((payload) => {
        if (cancelled) return;
        const serverIds = (Array.isArray(payload?.items) ? payload.items : [])
          .map((item) => String(item?.id || '').trim())
          .filter(Boolean)
          .slice(0, RECENT_STICKERS_LIMIT);
        if (serverIds.length > 0) {
          setRecentStickerIds(serverIds);
          writeRecentStickerIds(recentStorageKey, serverIds);
          notifyStickerRecentsChanged(recentStorageKey);
          return;
        }
        const localIds = readRecentStickerIds(recentStorageKey);
        if (localIds.length > 0) scheduleRecentStickersSync(localIds, recentStorageKey);
      })
      .catch(() => {
        // Офлайн/старый backend — остаёмся на localStorage-копии.
      });
    return () => { cancelled = true; };
  }, [recentStorageKey]);

  // Избранное грузится параллельно наборам: секция рендерится сразу,
  // стикеры появляются по готовности.
  useEffect(() => {
    let cancelled = false;
    chatStickersAPI.listFavorites(cacheScope)
      .then((payload) => {
        if (!cancelled) setFavoriteStickers(Array.isArray(payload?.items) ? payload.items : []);
      })
      .catch(() => {
        // Избранное недоступно (офлайн/старый backend) — секция остаётся пустой.
      });
    return () => { cancelled = true; };
  }, [cacheScope]);

  useEffect(() => {
    let cancelled = false;
    const requestEpoch = getStickerPacksEpoch();
    // При тёплом кэше спиннер не показываем — список уже отрисован.
    if (!Array.isArray(peekStickerPacksCache(cacheScope)?.items)) setLoading(true);
    setLoadError('');
    chatStickersAPI.listPacks(cacheScope)
      .then((payload) => {
        if (!cancelled) applyPackPayload(payload, '', requestEpoch);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(getApiError(error, 'Не удалось загрузить наборы стикеров.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [applyPackPayload]);

  useEffect(() => {
    const refreshPacks = () => {
      invalidateStickerPacksCache();
      const requestEpoch = getStickerPacksEpoch();
      chatStickersAPI.listPacks({ ...cacheScope, force: true })
        .then((payload) => applyPackPayload(payload, '', requestEpoch))
        .catch(() => {});
    };
    window.addEventListener('chat-sticker-packs-changed', refreshPacks);
    return () => window.removeEventListener('chat-sticker-packs-changed', refreshPacks);
  }, [applyPackPayload]);

  useEffect(() => {
    if (!importOpen) return;
    const frame = window.requestAnimationFrame(() => sourceInputRef.current?.focus?.());
    return () => window.cancelAnimationFrame(frame);
  }, [importOpen]);

  // Избранное идёт первым источником, наборы перезаписывают совпадения —
  // так «недавние» резолвятся даже для стикеров из удалённых наборов.
  const stickersById = useMemo(
    () => new Map(
      [
        ...favoriteStickers.map((sticker) => [String(sticker.id), sticker]),
        ...packs.flatMap((pack) => (pack.stickers || []).map((sticker) => [
          String(sticker.id),
          sticker.pack_short_name ? sticker : { ...sticker, pack_short_name: pack.short_name },
        ])),
      ],
    ),
    [packs, favoriteStickers],
  );
  const recentStickers = useMemo(
    () => recentStickerIds.map((stickerId) => stickersById.get(stickerId)).filter(Boolean),
    [recentStickerIds, stickersById],
  );
  const favoriteStickerIds = useMemo(
    () => new Set(favoriteStickers.map((item) => String(item?.id || ''))),
    [favoriteStickers],
  );
  const stickerSections = useMemo(
    () => [
      { id: 'recent', title: 'Недавние', stickers: recentStickers, recent: true },
      { id: 'favorites', title: 'Избранные', stickers: favoriteStickers, favorites: true },
      ...packs.map((pack) => ({
        ...pack,
        stickers: (pack.stickers || []).map((sticker) => (
          sticker.pack_short_name ? sticker : { ...sticker, pack_short_name: pack.short_name }
        )),
        recent: false,
      })),
    ],
    [packs, recentStickers, favoriteStickers],
  );

  // Поиск по уже загруженным секциям: deferred-запрос не блокирует ввод,
  // индекс пересчитывается только при смене секций — как в Telegram Desktop.
  const [searchQuery, setSearchQuery] = useState(() => persistedStickerSearchQuery);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const stickerSearchIndex = useMemo(() => buildStickerSearchIndex(stickerSections), [stickerSections]);
  const searchResults = useMemo(
    () => searchStickerIndex(stickerSearchIndex, deferredSearchQuery),
    [stickerSearchIndex, deferredSearchQuery],
  );
  const isSearching = Boolean(normalizeStickerSearchQuery(deferredSearchQuery));

  const handleSearchQueryChange = useCallback((event) => {
    const nextQuery = event.target.value;
    persistedStickerSearchQuery = nextQuery;
    setSearchQuery(nextQuery);
  }, []);

  const handleSearchClear = useCallback(() => {
    persistedStickerSearchQuery = '';
    setSearchQuery('');
  }, []);

  const handleSearchKeyDown = useCallback((event) => {
    if (event.key !== 'Escape') return;
    // Escape в поле только чистит запрос и убирает фокус — поповер не
    // должен закрываться, поэтому всплытие до document останавливаем.
    event.preventDefault();
    event.stopPropagation();
    persistedStickerSearchQuery = '';
    setSearchQuery('');
    event.currentTarget.blur();
  }, []);

  // Переключатель «подсказки стикеров при вводе эмодзи» живёт в строке
  // поиска — это единственное место, где он нужен по Telegram-логике.
  const [suggestionsEnabled, setSuggestionsEnabled] = useState(() => readStickerSuggestionsEnabled());
  useEffect(() => {
    const syncSuggestionsSetting = () => setSuggestionsEnabled(readStickerSuggestionsEnabled());
    window.addEventListener(STICKER_SUGGESTIONS_EVENT, syncSuggestionsSetting);
    return () => window.removeEventListener(STICKER_SUGGESTIONS_EVENT, syncSuggestionsSetting);
  }, []);

  const handleToggleSuggestions = useCallback(() => {
    const next = !readStickerSuggestionsEnabled();
    writeStickerSuggestionsEnabled(next);
    setSuggestionsEnabled(next);
  }, []);

  useEffect(() => {
    const validSectionIds = new Set(stickerSections.map((section) => String(section.id)));
    setActiveSectionId((current) => (validSectionIds.has(current) ? current : 'recent'));
  }, [stickerSections]);

  const registerSectionRef = useCallback((sectionId, node) => {
    const normalizedId = String(sectionId || '');
    if (node) sectionRefsRef.current.set(normalizedId, node);
    else sectionRefsRef.current.delete(normalizedId);
  }, []);

  const registerPackTabRef = useCallback((sectionId, node) => {
    const normalizedId = String(sectionId || '');
    if (node) packTabRefsRef.current.set(normalizedId, node);
    else packTabRefsRef.current.delete(normalizedId);
  }, []);

  const handlePackStripWheel = useCallback((event) => {
    const strip = packStripRef.current || event.currentTarget;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;
    if (!rawDelta) return;
    const unit = event.deltaMode === 1
      ? 16
      : (event.deltaMode === 2 ? strip.clientWidth : 1);
    const maxScrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth);
    const nextScrollLeft = Math.max(
      0,
      Math.min(maxScrollLeft, strip.scrollLeft + (rawDelta * unit)),
    );
    if (nextScrollLeft === strip.scrollLeft) return;
    event.preventDefault();
    strip.scrollLeft = nextScrollLeft;
  }, []);

  useEffect(() => {
    const strip = packStripRef.current;
    const activeTab = packTabRefsRef.current.get(String(activeSectionId));
    if (!strip || !activeTab || strip.scrollWidth <= strip.clientWidth) return;
    const edgePadding = 6;
    const visibleStart = strip.scrollLeft;
    const visibleEnd = visibleStart + strip.clientWidth;
    const tabStart = activeTab.offsetLeft;
    const tabEnd = tabStart + activeTab.offsetWidth;
    let nextScrollLeft = visibleStart;

    if (tabStart < visibleStart + edgePadding) {
      nextScrollLeft = Math.max(0, tabStart - edgePadding);
    } else if (tabEnd > visibleEnd - edgePadding) {
      nextScrollLeft = Math.min(
        Math.max(0, strip.scrollWidth - strip.clientWidth),
        tabEnd - strip.clientWidth + edgePadding,
      );
    }
    if (Math.abs(nextScrollLeft - visibleStart) < 1) return;
    if (typeof strip.scrollTo === 'function') {
      strip.scrollTo({ left: nextScrollLeft, behavior: 'smooth' });
    } else {
      strip.scrollLeft = nextScrollLeft;
    }
  }, [activeSectionId]);

  const scrollToSection = useCallback((sectionId) => {
    const normalizedId = String(sectionId || '');
    const scrollRoot = scrollContainerRef.current;
    const sectionNode = sectionRefsRef.current.get(normalizedId);
    setActiveSectionId(normalizedId);
    if (!scrollRoot || !sectionNode) return;
    const nextTop = Math.max(0, sectionNode.offsetTop - 4);
    if (typeof scrollRoot.scrollTo === 'function') {
      scrollRoot.scrollTo({ top: nextTop, behavior: 'smooth' });
    } else {
      scrollRoot.scrollTop = nextTop;
    }
  }, []);

  useEffect(() => {
    const pendingSectionId = pendingScrollSectionRef.current;
    if (!pendingSectionId || !sectionRefsRef.current.has(pendingSectionId)) return undefined;
    pendingScrollSectionRef.current = '';
    const frame = window.requestAnimationFrame(() => scrollToSection(pendingSectionId));
    return () => window.cancelAnimationFrame(frame);
  }, [scrollToSection, stickerSections]);

  useEffect(() => {
    const scrollRoot = scrollContainerRef.current;
    if (!scrollRoot) return undefined;
    const updateActiveSection = () => {
      scrollFrameRef.current = null;
      const marker = scrollRoot.scrollTop + 20;
      let nextSectionId = 'recent';
      stickerSections.forEach((section) => {
        const sectionNode = sectionRefsRef.current.get(String(section.id));
        if (sectionNode && sectionNode.offsetTop <= marker) nextSectionId = String(section.id);
      });
      setActiveSectionId((current) => (current === nextSectionId ? current : nextSectionId));
    };
    const handleScroll = () => {
      persistedStickerScrollTop = scrollRoot.scrollTop;
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = window.requestAnimationFrame(updateActiveSection);
    };
    scrollRoot.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    };
  }, [stickerSections]);

  // Восстановление позиции прокрутки при повторном открытии панели —
  // только если нет отложенного перехода к конкретному набору.
  useEffect(() => {
    const scrollRoot = scrollContainerRef.current;
    if (!scrollRoot || !persistedStickerScrollTop || pendingScrollSectionRef.current) return;
    scrollRoot.scrollTop = persistedStickerScrollTop;
  }, [stickerSections.length]);

  const rememberRecentSticker = useCallback((stickerId) => {
    const normalizedStickerId = String(stickerId || '').trim();
    if (!normalizedStickerId) return;
    setRecentStickerIds((current) => {
      const next = [normalizedStickerId, ...current.filter((item) => item !== normalizedStickerId)]
        .slice(0, RECENT_STICKERS_LIMIT);
      writeRecentStickerIds(recentStorageKey, next);
      scheduleRecentStickersSync(next, recentStorageKey);
      notifyStickerRecentsChanged(recentStorageKey);
      return next;
    });
  }, [recentStorageKey]);

  const forgetRecentSticker = useCallback((stickerId) => {
    const normalizedStickerId = String(stickerId || '').trim();
    if (!normalizedStickerId) return;
    setRecentStickerIds((current) => {
      if (!current.includes(normalizedStickerId)) return current;
      const next = current.filter((item) => item !== normalizedStickerId);
      writeRecentStickerIds(recentStorageKey, next);
      scheduleRecentStickersSync(next, recentStorageKey);
      notifyStickerRecentsChanged(recentStorageKey);
      return next;
    });
  }, [recentStorageKey]);

  const clearRecentStickers = useCallback(() => {
    // Отложенный дебаунс-синк отменяем до немедленного PUT — иначе
    // устаревший список улетел бы на сервер уже после очистки.
    cancelRecentStickersSync(recentStorageKey);
    setRecentStickerIds((current) => {
      if (current.length === 0) return current;
      writeRecentStickerIds(recentStorageKey, []);
      notifyStickerRecentsChanged(recentStorageKey);
      return [];
    });
    chatStickersAPI.pushRecentStickers([]).catch(() => {
      // Локальный список уже пуст — серверный догонит при следующей
      // успешной записи, пользователю показываем только статус.
      setStatusText('Не удалось очистить список недавних стикеров.');
    });
  }, [recentStorageKey]);

  const handleImportSubmit = useCallback(async (event) => {
    event.preventDefault();
    const normalizedSource = String(source || '').trim();
    if (!normalizedSource) {
      setImportError('Вставьте ссылку на набор Telegram.');
      sourceInputRef.current?.focus?.();
      return;
    }
    setImporting(true);
    setImportError('');
    setStatusText('');
    try {
      const payload = await chatStickersAPI.importPack(normalizedSource);
      // importPack уже инвалидировал кэш — захватываем свежую эпоху, чтобы
      // результат импорта мог быть записан как актуальный.
      const postImportEpoch = getStickerPacksEpoch();
      const nextPacks = Array.isArray(payload?.items) ? payload.items : [];
      const importedShortName = normalizedSource.split('/').filter(Boolean).pop()?.split('?')[0] || '';
      const importedPack = nextPacks.find(
        (item) => String(item?.short_name || '').toLowerCase() === importedShortName.toLowerCase(),
      ) || nextPacks[nextPacks.length - 1];
      applyPackPayload(payload, importedPack?.id, postImportEpoch);
      setSource('');
      setImportOpen(false);
      setStatusText(`Набор «${importedPack?.title || 'Telegram'}» добавлен.`);
    } catch (error) {
      setImportError(getApiError(error, 'Не удалось импортировать набор.'));
    } finally {
      setImporting(false);
    }
  }, [applyPackPayload, source]);

  const handleStickerClick = useCallback(async (sticker) => {
    const stickerId = String(sticker?.id || '').trim();
    if (!stickerId || sendingStickerIds[stickerId]) return;
    setSendingStickerIds((current) => (current[stickerId] ? current : { ...current, [stickerId]: true }));
    setStatusText('');
    try {
      const sent = await onSendSticker?.(sticker);
      if (sent === false) {
        setStatusText('Стикер не отправлен.');
      } else {
        rememberRecentSticker(stickerId);
        // После отправки поиск очищается — как в Telegram Desktop.
        persistedStickerSearchQuery = '';
        setSearchQuery('');
      }
    } finally {
      setSendingStickerIds((current) => {
        if (!current[stickerId]) return current;
        const next = { ...current };
        delete next[stickerId];
        return next;
      });
    }
  }, [onSendSticker, rememberRecentSticker, sendingStickerIds]);

  const handleStickerPointerDown = useCallback((event, sticker) => {
    if (sendingStickerIds[String(sticker?.id || '')] || (event.pointerType === 'mouse' && event.button !== 0)) return;
    pointerPressRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scheduleHoldPreview(sticker);
  }, [scheduleHoldPreview, sendingStickerIds]);

  const handleStickerPointerMove = useCallback((event) => {
    const press = pointerPressRef.current;
    if (!press || press.pointerId !== event.pointerId || holdTriggeredRef.current) return;
    const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
    if (distance <= STICKER_PREVIEW_MOVE_TOLERANCE_PX) return;
    pointerPressRef.current = null;
    clearHoldTimer();
  }, [clearHoldTimer]);

  const handleStickerPointerEnd = useCallback((event) => {
    const press = pointerPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    const previewWasOpen = holdTriggeredRef.current;
    pointerPressRef.current = null;
    clearHoldTimer();
    if (previewWasOpen) {
      suppressClickRef.current = true;
      closeHoldPreview();
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, [clearHoldTimer, closeHoldPreview]);

  const handleStickerPointerCancel = useCallback(() => {
    pointerPressRef.current = null;
    clearHoldTimer();
    if (holdTriggeredRef.current) suppressClickRef.current = true;
    closeHoldPreview();
  }, [clearHoldTimer, closeHoldPreview]);

  const handleStickerButtonClick = useCallback((event, sticker) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      suppressClickRef.current = false;
      return;
    }
    void handleStickerClick(sticker);
  }, [handleStickerClick]);

  const closeStickerMenu = useCallback(() => setStickerMenu(null), []);

  // ПКМ и клавиша Menu/Shift+F10 ведут в одно меню. Меню рендерится порталом
  // в body, поэтому работает и в поповере, и в закреплённом доке — даже если
  // сама панель скрылась, пока меню открыто.
  const openStickerMenu = useCallback((event, sticker) => {
    event.preventDefault();
    event.stopPropagation();
    // Отменяем hold-preview: меню и превью не должны висеть одновременно.
    pointerPressRef.current = null;
    keyboardPressRef.current = false;
    clearHoldTimer();
    closeHoldPreview();
    // Клик после contextmenu (touch/pen) не должен отправлять стикер —
    // флаг снимается следующим pointerdown, обычную отправку не ломает.
    suppressClickRef.current = true;
    const { left, top } = getFileActionsAnchorPosition(event);
    setStickerMenu({ sticker, left, top });
  }, [clearHoldTimer, closeHoldPreview]);

  const handleStickerKeyDown = useCallback((event, sticker) => {
    if (isFileActionsKeyboardShortcut(event)) {
      openStickerMenu(event, sticker);
      return;
    }
    if (event.key !== ' ' || event.repeat || keyboardPressRef.current || sendingStickerIds[String(sticker?.id || '')]) return;
    event.preventDefault();
    keyboardPressRef.current = true;
    scheduleHoldPreview(sticker);
  }, [openStickerMenu, scheduleHoldPreview, sendingStickerIds]);

  const handleStickerKeyUp = useCallback((event, sticker) => {
    if (event.key !== ' ' || !keyboardPressRef.current) return;
    event.preventDefault();
    keyboardPressRef.current = false;
    const previewWasOpen = holdTriggeredRef.current;
    const shouldSuppressSend = previewWasOpen || suppressClickRef.current;
    clearHoldTimer();
    if (shouldSuppressSend) {
      suppressClickRef.current = false;
      closeHoldPreview();
      return;
    }
    void handleStickerClick(sticker);
  }, [clearHoldTimer, closeHoldPreview, handleStickerClick]);

  // Избранное обновляется оптимистично; при ошибке — точечный откат,
  // чтобы не затирать параллельные изменения, и сообщение в статус-строку.
  const toggleFavoriteSticker = useCallback(async (sticker) => {
    const stickerId = String(sticker?.id || '').trim();
    if (!stickerId) return;
    setStatusText('');
    if (favoriteStickerIds.has(stickerId)) {
      setFavoriteStickers((current) => current.filter((item) => String(item?.id) !== stickerId));
      try {
        const payload = await chatStickersAPI.removeFavoriteSticker(stickerId);
        if (Array.isArray(payload?.items)) setFavoriteStickers(payload.items);
      } catch (error) {
        setFavoriteStickers((current) => (
          current.some((item) => String(item?.id) === stickerId) ? current : [...current, sticker]
        ));
        setStatusText(getApiError(error, 'Не удалось убрать стикер из избранных.'));
      }
      return;
    }
    setFavoriteStickers((current) => (
      current.some((item) => String(item?.id) === stickerId) ? current : [...current, sticker]
    ));
    try {
      const payload = await chatStickersAPI.addFavoriteSticker(stickerId);
      if (Array.isArray(payload?.items)) setFavoriteStickers(payload.items);
    } catch (error) {
      setFavoriteStickers((current) => current.filter((item) => String(item?.id) !== stickerId));
      setStatusText(getApiError(error, 'Не удалось добавить стикер в избранное.'));
    }
  }, [favoriteStickerIds]);

  const menuStickerId = String(stickerMenu?.sticker?.id || '').trim();
  const menuStickerIsFavorite = Boolean(menuStickerId) && favoriteStickerIds.has(menuStickerId);
  const menuStickerIsRecent = Boolean(menuStickerId) && recentStickerIds.includes(menuStickerId);
  const menuStickerPack = stickerMenu?.sticker?.pack_short_name
    ? packs.find((pack) => String(pack.short_name) === String(stickerMenu.sticker.pack_short_name)) || null
    : null;

  const handleMenuSend = useCallback(() => {
    const sticker = stickerMenu?.sticker;
    closeStickerMenu();
    if (sticker) void handleStickerClick(sticker);
  }, [closeStickerMenu, handleStickerClick, stickerMenu]);

  const handleMenuToggleFavorite = useCallback(() => {
    const sticker = stickerMenu?.sticker;
    closeStickerMenu();
    if (sticker) void toggleFavoriteSticker(sticker);
  }, [closeStickerMenu, stickerMenu, toggleFavoriteSticker]);

  const handleMenuOpenPack = useCallback(() => {
    const packId = menuStickerPack?.id;
    closeStickerMenu();
    if (packId) scrollToSection(packId);
  }, [closeStickerMenu, menuStickerPack, scrollToSection]);

  const handleMenuRemoveRecent = useCallback(() => {
    closeStickerMenu();
    forgetRecentSticker(menuStickerId);
  }, [closeStickerMenu, forgetRecentSticker, menuStickerId]);

  const handleMenuClearRecents = useCallback(() => {
    closeStickerMenu();
    clearRecentStickers();
  }, [closeStickerMenu, clearRecentStickers]);

  const handleManageOpenPack = useCallback((pack) => {
    const packId = String(pack?.id || '').trim();
    setManageOpen(false);
    if (packId) scrollToSection(packId);
  }, [scrollToSection]);

  const handleManageAddPack = useCallback(() => {
    setManageOpen(false);
    setImportError('');
    // Поле получит фокус через эффект на importOpen — как у «+» в ленте.
    setImportOpen(true);
  }, []);

  // Удаление набора: исключение уходит в диалог (он показывает ошибку),
  // поэтому здесь без catch. Ответ {ok} списка не содержит — локальный
  // фильтр + прайм кэша дешевле повторного GET.
  const handleRemovePack = useCallback(async (pack) => {
    const packId = String(pack?.id || '').trim();
    if (!packId) return;
    await chatStickersAPI.removePack(packId);
    const requestEpoch = getStickerPacksEpoch();
    const nextPacks = packs.filter((item) => String(item?.id) !== packId);
    applyPackPayload({ items: nextPacks }, '', requestEpoch);
    setStatusText(`Набор «${pack?.title || 'стикеров'}» удалён.`);
    // Параллельно смонтированные вкладки (поповер + док) подтянут список.
    window.dispatchEvent(new CustomEvent('chat-sticker-packs-changed'));
  }, [applyPackPayload, packs]);

  // Порядок из диалога применяем оптимистично; ответ сервера (полный
  // список в новом порядке) подтверждает, при ошибке — откат.
  const handleReorderPacks = useCallback(async (packIds) => {
    const nextIds = (Array.isArray(packIds) ? packIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (nextIds.length === 0) return;
    const previousPacks = packs;
    const packsById = new Map(previousPacks.map((item) => [String(item?.id), item]));
    setPacks([
      ...nextIds.map((id) => packsById.get(id)).filter(Boolean),
      ...previousPacks.filter((item) => !nextIds.includes(String(item?.id))),
    ]);
    try {
      const payload = await chatStickersAPI.setPackOrder(nextIds);
      applyPackPayload(payload, '', getStickerPacksEpoch());
      window.dispatchEvent(new CustomEvent('chat-sticker-packs-changed'));
    } catch (error) {
      // setPackOrder инвалидирует кэш только после успеха — при отказе
      // серверный порядок не менялся, локальный откат безопасен.
      setPacks(previousPacks);
      setStatusText(getApiError(error, 'Не удалось изменить порядок наборов.'));
      throw error;
    }
  }, [applyPackPayload, packs]);

  // Одна и та же ячейка используется и в обычных секциях, и в результатах
  // поиска — обработчики (клик, hold-preview, контекстное меню) общие.
  const renderStickerButton = (sticker, sectionKey) => (
    <Box
      key={`${sectionKey}-${sticker.id}`}
      component="button"
      type="button"
      aria-label={`Отправить стикер ${sticker.emoji || ''}`.trim()}
      disabled={Boolean(sendingStickerIds[String(sticker.id)])}
      onClick={(event) => handleStickerButtonClick(event, sticker)}
      onPointerDown={(event) => handleStickerPointerDown(event, sticker)}
      onPointerMove={handleStickerPointerMove}
      onPointerUp={handleStickerPointerEnd}
      onPointerCancel={handleStickerPointerCancel}
      onKeyDown={(event) => handleStickerKeyDown(event, sticker)}
      onKeyUp={(event) => handleStickerKeyUp(event, sticker)}
      onContextMenu={(event) => openStickerMenu(event, sticker)}
      sx={{
        position: 'relative',
        aspectRatio: '1 / 1',
        minWidth: 0,
        p: 0.2,
        display: 'grid',
        placeItems: 'center',
        border: 'none',
        borderRadius: 2,
        bgcolor: 'transparent',
        cursor: sendingStickerIds[String(sticker.id)] ? 'wait' : 'pointer',
        touchAction: 'manipulation',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        contentVisibility: 'auto',
        containIntrinsicSize: dense ? '72px 72px' : '80px 80px',
        transition: 'background-color 120ms ease, transform 100ms ease, opacity 120ms ease',
        opacity: sendingStickerIds[String(sticker.id)] ? 0.55 : 1,
        '&:hover': {
          bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.08),
          transform: 'scale(1.05)',
        },
        '&:active': { transform: 'scale(0.96)' },
        '&:focus-visible': {
          outline: `2px solid ${ui.accentText || theme.palette.primary.main}`,
          outlineOffset: 1,
        },
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
          '&:hover': { transform: 'none' },
          '&:active': { transform: 'none' },
        },
      }}
    >
      <ChatStickerThumbnail sticker={sticker} size={dense ? 68 : 76} staticOnly />
      {sendingStickerIds[String(sticker.id)] ? (
        <CircularProgress
          size={22}
          sx={{ position: 'absolute', color: ui.accentText || theme.palette.primary.main }}
          aria-label="Отправка стикера"
        />
      ) : null}
    </Box>
  );

  const accent = ui.accentText || theme.palette.primary.main;
  const border = ui.borderSoft || theme.palette.divider;
  const panelBg = ui.composerBg || ui.panelBg || theme.palette.background.paper;

  if (loading) {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
        <CircularProgress size={24} aria-label="Загрузка наборов стикеров" />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          pt: 0.6,
          pb: 0.4,
        }}
      >
        <TextField
          value={searchQuery}
          onChange={handleSearchQueryChange}
          onKeyDown={handleSearchKeyDown}
          placeholder="Поиск стикеров"
          size="small"
          fullWidth
          autoComplete="off"
          inputProps={{ 'aria-label': 'Поиск стикеров' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start" sx={{ mr: 0.4 }}>
                <SearchRoundedIcon
                  sx={{ fontSize: 18, color: ui.textSecondary || theme.palette.text.secondary }}
                  aria-hidden="true"
                />
              </InputAdornment>
            ),
            endAdornment: searchQuery ? (
              <InputAdornment position="end" sx={{ ml: 0.2 }}>
                <IconButton
                  type="button"
                  aria-label="Очистить поиск стикеров"
                  size="small"
                  onClick={handleSearchClear}
                  sx={{ width: 24, height: 24 }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              minHeight: dense ? 32 : 34,
              borderRadius: '999px',
              fontSize: 13,
              bgcolor: alpha(ui.textSecondary || theme.palette.text.secondary, 0.1),
              '& fieldset': { borderColor: 'transparent' },
              '&:hover fieldset': { borderColor: 'transparent' },
              '&.Mui-focused fieldset': { borderColor: alpha(accent, 0.6) },
            },
            '& .MuiInputBase-input': { py: 0.4 },
          }}
        />
        <Tooltip
          title={suggestionsEnabled
            ? 'Подсказки стикеров при вводе эмодзи: вкл.'
            : 'Подсказки стикеров при вводе эмодзи: выкл.'}
          placement="top"
        >
          <IconButton
            type="button"
            aria-label="Подсказки стикеров при вводе эмодзи"
            aria-pressed={suggestionsEnabled}
            onClick={handleToggleSuggestions}
            sx={{
              width: 32,
              height: 32,
              flexShrink: 0,
              color: suggestionsEnabled ? accent : (ui.textSecondary || theme.palette.text.secondary),
              bgcolor: suggestionsEnabled ? alpha(accent, 0.14) : 'transparent',
              transition: 'background-color 120ms ease, transform 100ms ease',
              '&:hover': { bgcolor: alpha(accent, 0.1) },
              '&:active': { transform: 'scale(0.96)' },
            }}
          >
            <EmojiEmotionsRoundedIcon sx={{ fontSize: 19 }} aria-hidden="true" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Управление наборами стикеров" placement="top">
          <IconButton
            type="button"
            aria-label="Управление наборами стикеров"
            onClick={() => setManageOpen(true)}
            sx={{
              width: 32,
              height: 32,
              flexShrink: 0,
              color: ui.textSecondary || theme.palette.text.secondary,
              transition: 'background-color 120ms ease, transform 100ms ease',
              '&:hover': { bgcolor: alpha(accent, 0.1) },
              '&:active': { transform: 'scale(0.96)' },
            }}
          >
            <SettingsRoundedIcon sx={{ fontSize: 19 }} aria-hidden="true" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {statusText}
      </Box>

      {loadError ? (
        <Alert severity="error" sx={{ m: 1 }}>{loadError}</Alert>
      ) : packs.length === 0 && favoriteStickers.length === 0 ? (
        <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 2, textAlign: 'center' }}>
          <Box>
            <TelegramIcon sx={{ fontSize: 38, color: accent, mb: 0.6 }} aria-hidden="true" />
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: ui.textPrimary || theme.palette.text.primary }}>
              Добавьте первый набор
            </Typography>
            <Typography sx={{ mt: 0.4, fontSize: 12.5, lineHeight: 1.35, color: ui.textSecondary || theme.palette.text.secondary }}>
              Нажмите «+» и вставьте ссылку t.me/addstickers/…
            </Typography>
          </Box>
        </Box>
      ) : (
        <>
          {isSearching ? (
            <Box
              data-testid="chat-sticker-search-results"
              sx={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', px: 0.75, py: 0.6 }}
            >
              {searchResults.length === 0 ? (
                <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 2, textAlign: 'center' }}>
                  <Box>
                    <SearchRoundedIcon
                      sx={{
                        fontSize: 34,
                        color: alpha(ui.textSecondary || theme.palette.text.secondary, 0.6),
                        mb: 0.6,
                      }}
                      aria-hidden="true"
                    />
                    <Typography sx={{ fontSize: 14, fontWeight: 700, color: ui.textPrimary || theme.palette.text.primary }}>
                      Ничего не найдено
                    </Typography>
                    <Typography sx={{ mt: 0.4, fontSize: 12.5, lineHeight: 1.35, color: ui.textSecondary || theme.palette.text.secondary }}>
                      Попробуйте другое слово или эмодзи
                    </Typography>
                  </Box>
                </Box>
              ) : (
                searchResults.map((group) => (
                  <Box key={group.id} component="section" sx={{ pb: 1.2 }}>
                    <Typography
                      sx={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                        px: 0.4,
                        py: 0.55,
                        fontSize: 12,
                        fontWeight: 800,
                        color: ui.textSecondary || theme.palette.text.secondary,
                        bgcolor: panelBg,
                      }}
                    >
                      {group.title}
                    </Typography>
                    <Box
                      role="tabpanel"
                      aria-label={group.title}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${dense ? 5 : 4}, minmax(0, 1fr))`,
                        gap: dense ? 0.3 : 0.4,
                        alignItems: 'start',
                      }}
                    >
                      {group.stickers.map((sticker) => renderStickerButton(sticker, `search-${group.id}`))}
                    </Box>
                  </Box>
                ))
              )}
            </Box>
          ) : null}
          <Box
            ref={scrollContainerRef}
            data-testid="chat-sticker-sections-scroll"
            sx={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              px: 0.75,
              py: 0.6,
              display: isSearching ? 'none' : 'block',
            }}
          >
            {stickerSections.map((section) => (
            <Box
              key={section.id}
              component="section"
              ref={(node) => registerSectionRef(section.id, node)}
              data-sticker-section={section.id}
              sx={{ pb: section.id === stickerSections.at(-1)?.id ? 0.5 : 1.2 }}
            >
              <Typography
                sx={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  px: 0.4,
                  py: 0.55,
                  fontSize: 12,
                  fontWeight: 800,
                  color: ui.textSecondary || theme.palette.text.secondary,
                  bgcolor: panelBg,
                }}
              >
                {section.title}
              </Typography>
              {section.recent && section.stickers.length === 0 ? (
                <Typography
                  sx={{
                    px: 0.5,
                    py: 1,
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    color: alpha(ui.textSecondary || theme.palette.text.secondary, 0.78),
                  }}
                >
                  Отправленные стикеры появятся здесь
                </Typography>
              ) : section.favorites && section.stickers.length === 0 ? (
                <Typography
                  sx={{
                    px: 0.5,
                    py: 1,
                    fontSize: 12.5,
                    lineHeight: 1.35,
                    color: alpha(ui.textSecondary || theme.palette.text.secondary, 0.78),
                  }}
                >
                  Избранные стикеры появятся здесь — добавьте их через контекстное меню
                </Typography>
              ) : (
                <Box
                  role="tabpanel"
                  aria-label={section.title}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${dense ? 5 : 4}, minmax(0, 1fr))`,
                    gap: dense ? 0.3 : 0.4,
                    alignItems: 'start',
                  }}
                >
                  {section.stickers.map((sticker) => renderStickerButton(sticker, section.id))}
                </Box>
              )}
            </Box>
            ))}
          </Box>
        </>
      )}

      {importOpen ? (
        <Box
          component="form"
          onSubmit={handleImportSubmit}
          noValidate
          sx={{ p: 1, display: 'grid', gap: 0.8, borderTop: `1px solid ${border}` }}
        >
          <TextField
            inputRef={sourceInputRef}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setImportError('');
            }}
            label="Ссылка на набор Telegram"
            placeholder="https://t.me/addstickers/PackName"
            size="small"
            fullWidth
            autoComplete="off"
            error={Boolean(importError)}
            helperText={importError || 'Откройте набор в Telegram и скопируйте его ссылку.'}
            inputProps={{ inputMode: 'url', 'aria-describedby': 'telegram-sticker-import-help' }}
            FormHelperTextProps={{ id: 'telegram-sticker-import-help' }}
            sx={{ '& .MuiInputBase-input': { fontSize: 16 } }}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={importing}
            startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <TelegramIcon />}
            sx={{ minHeight: 40, justifySelf: 'end', textTransform: 'none', '&:active': { transform: 'scale(0.96)' } }}
          >
            {importing ? 'Импортируем…' : 'Добавить набор'}
          </Button>
        </Box>
      ) : null}

      <Box
        data-testid="chat-sticker-pack-strip-row"
        sx={{
          minHeight: dense ? 44 : 48,
          display: isSearching ? 'none' : 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          borderTop: `1px solid ${border}`,
        }}
      >
        <Box
          ref={packStripRef}
          role="tablist"
          aria-label="Наборы стикеров"
          onWheel={handlePackStripWheel}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.4,
            overflowX: 'auto',
            overscrollBehaviorInline: 'contain',
            scrollbarWidth: 'none',
            flex: 1,
            minWidth: 0,
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          <Tooltip title="Недавние" placement="top">
            <Box
              ref={(node) => registerPackTabRef('recent', node)}
              component="button"
              type="button"
              role="tab"
              aria-selected={activeSectionId === 'recent'}
              aria-label="Недавние"
              onClick={() => scrollToSection('recent')}
              sx={{
                width: dense ? 38 : 42,
                height: dense ? 38 : 42,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                p: 0.35,
                border: 'none',
                borderRadius: 2,
                color: activeSectionId === 'recent' ? accent : (ui.textSecondary || theme.palette.text.secondary),
                bgcolor: activeSectionId === 'recent' ? alpha(accent, 0.14) : 'transparent',
                cursor: 'pointer',
                transition: 'background-color 120ms ease, color 120ms ease, transform 100ms ease',
                '&:hover': { bgcolor: alpha(accent, 0.1) },
                '&:active': { transform: 'scale(0.96)' },
                '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 1 },
              }}
            >
              <HistoryRoundedIcon sx={{ fontSize: dense ? 23 : 25 }} aria-hidden="true" />
            </Box>
          </Tooltip>
          <Tooltip title="Избранные" placement="top">
            <Box
              ref={(node) => registerPackTabRef('favorites', node)}
              component="button"
              type="button"
              role="tab"
              aria-selected={activeSectionId === 'favorites'}
              aria-label="Избранные"
              onClick={() => scrollToSection('favorites')}
              sx={{
                width: dense ? 38 : 42,
                height: dense ? 38 : 42,
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                p: 0.35,
                border: 'none',
                borderRadius: 2,
                color: activeSectionId === 'favorites' ? accent : (ui.textSecondary || theme.palette.text.secondary),
                bgcolor: activeSectionId === 'favorites' ? alpha(accent, 0.14) : 'transparent',
                cursor: 'pointer',
                transition: 'background-color 120ms ease, color 120ms ease, transform 100ms ease',
                '&:hover': { bgcolor: alpha(accent, 0.1) },
                '&:active': { transform: 'scale(0.96)' },
                '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 1 },
              }}
            >
              <StarRoundedIcon sx={{ fontSize: dense ? 23 : 25 }} aria-hidden="true" />
            </Box>
          </Tooltip>
          {packs.map((pack) => {
            const selected = pack.id === activeSectionId;
            const cover = pack.stickers?.[0];
            return (
              <Tooltip key={pack.id} title={pack.title} placement="top">
                <Box
                  ref={(node) => registerPackTabRef(pack.id, node)}
                  component="button"
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-label={pack.title}
                  onClick={() => scrollToSection(pack.id)}
                  sx={{
                    width: dense ? 38 : 42,
                    height: dense ? 38 : 42,
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    p: 0.35,
                    border: 'none',
                    borderRadius: 2,
                    color: 'inherit',
                    bgcolor: selected ? alpha(accent, 0.14) : 'transparent',
                    cursor: 'pointer',
                    transition: 'background-color 120ms ease, transform 100ms ease',
                    '&:hover': { bgcolor: alpha(accent, 0.1) },
                    '&:active': { transform: 'scale(0.96)' },
                    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 1 },
                  }}
                >
                  {cover ? (
                    <ChatStickerThumbnail sticker={cover} size={dense ? 30 : 34} staticOnly />
                  ) : (
                    <TelegramIcon sx={{ fontSize: 22 }} aria-hidden="true" />
                  )}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
        <Tooltip title={importOpen ? 'Закрыть добавление' : 'Добавить набор из Telegram'}>
          <IconButton
            type="button"
            aria-label={importOpen ? 'Закрыть добавление набора' : 'Добавить набор стикеров из Telegram'}
            onClick={() => {
              setImportOpen((value) => !value);
              setImportError('');
            }}
            sx={{
              width: dense ? 36 : 40,
              height: dense ? 36 : 40,
              flexShrink: 0,
              color: accent,
              bgcolor: alpha(accent, 0.08),
              transition: 'background-color 120ms ease, transform 100ms ease',
              '&:hover': { bgcolor: alpha(accent, 0.14) },
              '&:active': { transform: 'scale(0.96)' },
            }}
          >
            {importOpen ? <CloseRoundedIcon /> : <AddRoundedIcon />}
          </IconButton>
        </Tooltip>
      </Box>

      <Menu
        open={Boolean(stickerMenu)}
        onClose={closeStickerMenu}
        anchorReference="anchorPosition"
        anchorPosition={stickerMenu ? { left: stickerMenu.left, top: stickerMenu.top } : undefined}
        MenuListProps={{ 'aria-label': 'Действия со стикером' }}
        PaperProps={{
          sx: {
            minWidth: 220,
            borderRadius: '10px',
            boxShadow: '0 14px 36px rgba(2, 6, 23, 0.24)',
          },
        }}
      >
        <MenuItem onClick={handleMenuSend} sx={{ minHeight: 40 }}>
          <ListItemIcon><SendRoundedIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Отправить</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleMenuToggleFavorite} sx={{ minHeight: 40 }}>
          <ListItemIcon>
            {menuStickerIsFavorite
              ? <StarRoundedIcon fontSize="small" sx={{ color: 'warning.main' }} />
              : <StarOutlineRoundedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>
            {menuStickerIsFavorite ? 'Удалить из избранных' : 'Добавить в избранное'}
          </ListItemText>
        </MenuItem>
        {menuStickerPack ? (
          <MenuItem onClick={handleMenuOpenPack} sx={{ minHeight: 40 }}>
            <ListItemIcon><StickyNote2RoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Открыть набор</ListItemText>
          </MenuItem>
        ) : null}
        {menuStickerIsRecent ? (
          <MenuItem onClick={handleMenuRemoveRecent} sx={{ minHeight: 40 }}>
            <ListItemIcon><DeleteOutlineRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Убрать из недавних</ListItemText>
          </MenuItem>
        ) : null}
        {menuStickerIsRecent ? (
          <MenuItem onClick={handleMenuClearRecents} sx={{ minHeight: 40 }}>
            <ListItemIcon><DeleteSweepRoundedIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Очистить недавние</ListItemText>
          </MenuItem>
        ) : null}
      </Menu>

      <ChatStickerManageDialog
        open={manageOpen}
        packs={packs}
        theme={theme}
        ui={ui}
        onClose={() => setManageOpen(false)}
        onOpenPack={handleManageOpenPack}
        onRemovePack={handleRemovePack}
        onReorderPacks={handleReorderPacks}
        onAddPack={handleManageAddPack}
      />

      {previewSticker ? (
        <Portal>
          <Box
            data-testid="sticker-hold-preview"
            aria-hidden="true"
            sx={{
              position: 'fixed',
              inset: 0,
              zIndex: theme.zIndex.modal + 10,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
              bgcolor: alpha(theme.palette.common.black, 0.78),
              boxSizing: 'border-box',
              p: 'max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) max(12px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px))',
            }}
          >
            <Box
              data-testid="sticker-hold-preview-frame"
              sx={{
                width: 'min(560px, calc(100vw - 24px), calc(100vh - 112px))',
                maxWidth: '100%',
                display: 'grid',
                justifyItems: 'center',
                gap: 2,
                filter: 'drop-shadow(0 18px 44px rgba(0, 0, 0, 0.42))',
                '@supports (width: 100dvw)': {
                  width: 'min(560px, calc(100dvw - 24px), calc(100dvh - 112px))',
                },
              }}
            >
              <ChatStickerMedia
                src={previewSticker.file_url}
                mimeType={previewSticker.mime_type}
                posterSrc={previewSticker.preview_url}
                emoji={previewSticker.emoji}
                decorative
                autoPlay
                forceAutoPlay
                eager
                size={560}
              />
              <Typography
                variant="body2"
                sx={{
                  color: theme.palette.common.white,
                  bgcolor: alpha(theme.palette.common.black, 0.36),
                  borderRadius: 999,
                  px: 1.5,
                  py: 0.65,
                }}
              >
                Отпустите, чтобы закрыть
              </Typography>
            </Box>
          </Box>
        </Portal>
      ) : null}
    </Box>
  );
});

export default TelegramStickersTab;
