import { Suspense, lazy, memo, useCallback, useEffect, useState } from 'react';
import { Box, CircularProgress, Tab, Tabs } from '@mui/material';
import { alpha } from '@mui/material/styles';
import InsertEmoticonRoundedIcon from '@mui/icons-material/InsertEmoticonRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import TelegramStickersTab from './TelegramStickersTab';
import { ChatPerfProbe } from './ChatPerfProbe';
import { ensureEmojiSpriteStyles, getSpriteAwareEmojiUrl } from '../../lib/chat/emojiSpriteAtlas';

// Issue #89: эмодзи панели рисуются sprite-атласом (листы /emoji-atlas/*.png)
// вместо ~180 отдельных PNG на холодное открытие. Стили инжектятся при оценке
// этого lazy-модуля — гарантированно до монтирования picker'а.
ensureEmojiSpriteStyles();

const getChatEmojiPickerUrl = (unified) => getSpriteAwareEmojiUrl(unified);

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'));
// memo на lazy-пикере: при ре-рендере панели (переключение вкладок,
// keep-alive toggle) тяжёлая сетка эмодзи не перерендеривается — пропы
// стабильны (модульные константы + useCallback ниже).
const MemoEmojiPicker = memo(LazyEmojiPicker);
const EMOJI_PREVIEW_CONFIG = { showPreview: false };
const EMOJI_CATEGORIES = [
  { category: 'suggested', name: 'Недавние' },
  { category: 'smileys_people', name: 'Смайлы и люди' },
  { category: 'animals_nature', name: 'Животные' },
  { category: 'food_drink', name: 'Еда' },
  { category: 'travel_places', name: 'Путешествия' },
  { category: 'activities', name: 'Активности' },
  { category: 'objects', name: 'Объекты' },
  { category: 'symbols', name: 'Символы' },
  { category: 'flags', name: 'Флаги' },
];

const TELEGRAM_CHAT_FONT_FAMILY = [
  '"SF Pro Text"',
  '"SF Pro Display"',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'Roboto',
  'Helvetica',
  'Arial',
  'sans-serif',
].join(', ');

const PANEL_HEIGHT = 320;
const TAB_BAR_HEIGHT = 42;

// Активная вкладка переживает размонтирование панели (preview ↔ pinned ↔
// повторное открытие), как в Telegram Desktop.
const persistedPanelState = { activeTab: 0 };

/* ─── Tab panel wrapper ─── */
// Вкладка монтируется при первой активации и дальше скрывается стилем:
// переключение не платит за remount emoji-picker-react/сетки стикеров
// (~250–300 мс по замерам) и сохраняет их внутренний скролл и поиск.
function TabPanel({ value, index, children, fillAvailableHeight = false, forceMounted = false }) {
  const [wasActive, setWasActive] = useState(value === index);
  useEffect(() => {
    if (value === index && !wasActive) setWasActive(true);
  }, [index, value, wasActive]);
  if (!wasActive && !forceMounted) return null;
  return (
    <Box sx={{
      height: fillAvailableHeight ? 'auto' : PANEL_HEIGHT - TAB_BAR_HEIGHT,
      flex: fillAvailableHeight ? 1 : undefined,
      minHeight: 0,
      overflow: 'hidden',
      display: value === index ? undefined : 'none',
    }}>
      {children}
    </Box>
  );
}

/* ─── Stickers tab ─── */
const StickersTab = memo(function StickersTab({ theme, ui, onSendSticker, dense = false, currentUserId = null, visible = true }) {
  return (
    <TelegramStickersTab
      theme={theme}
      ui={ui}
      onSendSticker={onSendSticker}
      dense={dense}
      currentUserId={currentUserId}
      visible={visible}
    />
  );
});

/* ─── Main panel component ─── */
const ChatEmojiPanel = memo(function ChatEmojiPanel({
  open,
  theme,
  ui,
  onInsertEmoji,
  onSendSticker,
  onClose,
  desktopDocked = false,
  currentUserId = null,
  // Видимость keep-alive обёртки: док/поповер держат панель смонтированной
  // под display:none — скрытая вкладка стикеров не должна делать запросов.
  visible = true,
}) {
  const [activeTab, setActiveTabState] = useState(() => persistedPanelState.activeTab);
  const setActiveTab = useCallback((value) => {
    persistedPanelState.activeTab = value;
    setActiveTabState(value);
  }, []);
  const handleEmojiClick = useCallback(
    (emojiData) => onInsertEmoji?.(emojiData?.emoji || ''),
    [onInsertEmoji],
  );

  // Прогрев скрытой вкладки в idle-время: первое переключение
  // «Эмодзи ↔ Стикеры» встречает уже смонтированную сетку. Картинки
  // стикеров при этом не грузятся — display:none не пересекается с IO.
  const [warmHiddenTabs, setWarmHiddenTabs] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const schedule = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 1500));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const id = schedule(() => setWarmHiddenTabs(true), { timeout: 3000 });
    return () => cancel.call(window, id);
  }, [open]);

  if (!open) return null;

  const panelBg = ui.composerBg || ui.panelBg || theme.palette.background.paper;

  return (
    <ChatPerfProbe id="chat-emoji-panel">
    <Box
      data-testid="chat-emoji-panel"
      className="chat-emoji-sprite-scope"
      data-layout={desktopDocked ? 'desktop-docked' : 'compact'}
      sx={{
        width: '100%',
        height: desktopDocked ? '100%' : PANEL_HEIGHT,
        minHeight: 0,
        bgcolor: panelBg,
        borderTop: desktopDocked ? 'none' : `1px solid ${ui.borderSoft || theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        '& .EmojiPickerReact': {
          '--epr-bg-color': panelBg,
          '--epr-category-label-bg-color': panelBg,
          '--epr-hover-bg-color': alpha(ui.accentText || theme.palette.primary.main, 0.1),
          '--epr-search-bg-color': alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', 0.06),
          '--epr-text-color': ui.textPrimary || theme.palette.text.primary,
          '--epr-search-input-bg-color': alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', 0.06),
          '--epr-search-border-color': ui.borderSoft || theme.palette.divider,
          '--epr-category-icon-active-color': ui.accentText || theme.palette.primary.main,
          '--epr-highlight-color': ui.accentText || theme.palette.primary.main,
          '--epr-header-padding': '6px 8px',
          '--epr-category-navigation-button-size': '22px',
          '--epr-search-input-height': '32px',
          '--epr-search-input-padding': '0 8px',
          '--epr-emoji-size': '28px',
          '--epr-emoji-padding': '4px',
          '--epr-category-label-height': '26px',
          border: 'none',
          borderRadius: 0,
          // The picker capitalizes every word of a category label ("Смайлы И Люди")
          '& .epr-emoji-category-label': {
            textTransform: 'none !important',
          },
          // Hide built-in category navigation — we use our own Tabs
          '& .epr-category-nav': {
            display: 'none !important',
          },
          '& .epr-header-overlay': {
            padding: '4px 8px !important',
          },
          // Hide skin tone circle button
          '& .epr-skin-tones, & .epr-btn.epr-active': {
            display: 'none !important',
          },
          // Hide search adornment icon overlap
          '& .epr-icn-search': {
            display: 'none !important',
          },
        },
      }}
    >
      {/* Tab bar */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="fullWidth"
        sx={{
          minHeight: TAB_BAR_HEIGHT,
          '& .MuiTab-root': {
            minHeight: TAB_BAR_HEIGHT,
            textTransform: 'none',
            fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
            fontSize: 13,
            fontWeight: 700,
            color: ui.textSecondary || theme.palette.text.secondary,
            py: 0,
          },
          '& .Mui-selected': {
            color: `${ui.accentText || theme.palette.primary.main} !important`,
          },
          '& .MuiTabs-indicator': {
            bgcolor: ui.accentText || theme.palette.primary.main,
            height: 2.5,
            borderRadius: 2,
          },
        }}
      >
        <Tab icon={desktopDocked ? undefined : <InsertEmoticonRoundedIcon sx={{ fontSize: 20 }} />} iconPosition="start" label="Эмодзи" />
        <Tab icon={desktopDocked ? undefined : <StickyNote2RoundedIcon sx={{ fontSize: 20 }} />} iconPosition="start" label="Стикеры" />
      </Tabs>

      {/* Emoji tab */}
      <TabPanel value={activeTab} index={0} fillAvailableHeight={desktopDocked} forceMounted={warmHiddenTabs}>
        <Suspense
          fallback={
            <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          }
        >
          <MemoEmojiPicker
            onEmojiClick={handleEmojiClick}
            autoFocusSearch={false}
            searchPlaceholder="Поиск"
            skinTonesDisabled
            previewConfig={EMOJI_PREVIEW_CONFIG}
            // R48: Apple images served by us; the picker would otherwise load them from a CDN.
            emojiStyle="apple"
            getEmojiUrl={getChatEmojiPickerUrl}
            suggestedEmojisMode="recent"
            lazyLoadEmojis
            width="100%"
            height={desktopDocked ? '100%' : PANEL_HEIGHT - TAB_BAR_HEIGHT}
            theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
            categories={EMOJI_CATEGORIES}
          />
        </Suspense>
      </TabPanel>

      {/* Stickers tab */}
      <TabPanel value={activeTab} index={1} fillAvailableHeight={desktopDocked} forceMounted={warmHiddenTabs}>
        <StickersTab
          theme={theme}
          ui={ui}
          onSendSticker={onSendSticker}
          dense={desktopDocked}
          currentUserId={currentUserId}
          visible={visible && activeTab === 1}
        />
      </TabPanel>
    </Box>
    </ChatPerfProbe>
  );
});

export default ChatEmojiPanel;
