import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, InputBase, Tab, Tabs, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import InsertEmoticonRoundedIcon from '@mui/icons-material/InsertEmoticonRounded';
import GifBoxRoundedIcon from '@mui/icons-material/GifBoxRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';

const LazyEmojiPicker = lazy(() => import('emoji-picker-react'));

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

/* ─── Built-in sticker packs ─── */
const STICKER_PACKS = [
  {
    id: 'smileys',
    name: 'Смайлы',
    icon: '😀',
    stickers: [
      '😀', '😃', '😄', '😁', '😆', '🥹', '😅', '🤣', '😂', '🙂', '😉', '😊',
      '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋', '😛', '😜',
      '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🫡', '🤐', '🤨', '😐', '😑',
      '😶', '🫥', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴',
      '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳',
      '🥸', '😎', '🤓', '🧐', '😕', '🫤', '😟', '🙁', '😮', '😯', '😲', '😳',
      '🥺', '🥹', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
      '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀',
      '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖',
    ],
  },
  {
    id: 'gestures',
    name: 'Жесты',
    icon: '👍',
    stickers: [
      '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '🫷', '🫸', '👌',
      '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕',
      '👇', '☝️', '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶',
      '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶',
    ],
  },
  {
    id: 'hearts',
    name: 'Сердца',
    icon: '❤️',
    stickers: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '🫀', '💋',
      '💌', '🥰', '😍', '😘', '😻', '💑', '👩‍❤️‍👨', '👨‍❤️‍👨', '👩‍❤️‍👩', '💏',
    ],
  },
  {
    id: 'animals',
    name: 'Животные',
    icon: '🐱',
    stickers: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁',
      '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤',
      '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋',
      '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍',
    ],
  },
  {
    id: 'food',
    name: 'Еда',
    icon: '🍕',
    stickers: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒',
      '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🫑', '🌶️', '🌽',
      '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🍞', '🥖', '🧀', '🍕', '🍔',
      '🍟', '🌭', '🍿', '🧂', '🥚', '🍳', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖',
    ],
  },
];

/* ─── GIF search via GIPHY ─── */
const GIPHY_API_KEY = 'jmrWbIIOpKlLIAVDHVyVvjhEJSJ3nNZC'; // GIPHY API key

/* ─── Tab panel wrapper ─── */
function TabPanel({ value, index, children }) {
  if (value !== index) return null;
  return (
    <Box sx={{ height: PANEL_HEIGHT - TAB_BAR_HEIGHT, overflow: 'hidden' }}>
      {children}
    </Box>
  );
}

/* ─── Stickers tab ─── */
function StickersTab({ theme, ui, onSendSticker }) {
  const [activePack, setActivePack] = useState(0);
  const pack = STICKER_PACKS[activePack];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Pack selector */}
      <Box
        sx={{
          display: 'flex',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: `1px solid ${ui.borderSoft || theme.palette.divider}`,
          overflowX: 'auto',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {STICKER_PACKS.map((p, idx) => (
          <Box
            key={p.id}
            component="button"
            type="button"
            onClick={() => setActivePack(idx)}
            sx={{
              fontSize: 22,
              lineHeight: 1,
              p: '4px 8px',
              border: 'none',
              borderRadius: 2,
              cursor: 'pointer',
              bgcolor: idx === activePack
                ? alpha(ui.accentText || theme.palette.primary.main, 0.15)
                : 'transparent',
              transition: 'background-color 120ms ease',
              '&:hover': { bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.1) },
              flexShrink: 0,
            }}
          >
            {p.icon}
          </Box>
        ))}
      </Box>

      {/* Sticker grid */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          px: 0.5,
          py: 0.5,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 0.25,
          alignContent: 'start',
          WebkitOverflowScrolling: 'touch',
          '&::-webkit-scrollbar': { width: 0 },
        }}
      >
        {pack.stickers.map((sticker, idx) => (
          <Box
            key={`${pack.id}-${idx}`}
            component="button"
            type="button"
            onClick={() => onSendSticker?.(sticker)}
            sx={{
              fontSize: 36,
              lineHeight: 1,
              p: 0.5,
              border: 'none',
              bgcolor: 'transparent',
              borderRadius: 2,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              aspectRatio: '1 / 1',
              transition: 'transform 80ms ease, background-color 80ms ease',
              '&:active': { transform: 'scale(0.85)' },
              '&:hover': { bgcolor: alpha(ui.accentText || theme.palette.primary.main, 0.08) },
            }}
          >
            {sticker}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/* ─── GIF tab ─── */
function GifTab({ theme, ui, onSendGif }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [featured, setFeatured] = useState([]);
  const debounceRef = useRef(null);

  // Load trending GIFs on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=30&rating=g`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setFeatured((data.data || []).map(mapGiphyResult));
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const searchGifs = useCallback((q) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=30&rating=g`)
      .then((res) => res.json())
      .then((data) => {
        setResults((data.data || []).map(mapGiphyResult));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleQueryChange = useCallback((event) => {
    const value = event.target.value;
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchGifs(value), 400);
  }, [searchGifs]);

  const displayGifs = query.trim() ? results : featured;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Search */}
      <Box sx={{ px: 1, py: 0.75 }}>
        <InputBase
          fullWidth
          placeholder="Поиск GIF..."
          value={query}
          onChange={handleQueryChange}
          startAdornment={<SearchRoundedIcon sx={{ fontSize: 18, mr: 0.5, color: ui.textSecondary || theme.palette.text.secondary }} />}
          sx={{
            bgcolor: alpha(theme.palette.mode === 'dark' ? '#fff' : '#000', 0.06),
            borderRadius: 2.5,
            px: 1.2,
            py: 0.4,
            fontSize: 14,
            fontFamily: TELEGRAM_CHAT_FONT_FAMILY,
            color: theme.palette.text.primary,
          }}
        />
      </Box>

      {/* GIF masonry grid */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          px: 0.5,
          pb: 0.5,
          WebkitOverflowScrolling: 'touch',
          '&::-webkit-scrollbar': { width: 0 },
        }}
      >
        {loading && displayGifs.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : displayGifs.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography sx={{ color: ui.textSecondary, fontSize: 13 }}>
              {query.trim() ? 'Ничего не найдено' : 'Загрузка GIF...'}
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              columnCount: 2,
              columnGap: '4px',
            }}
          >
            {displayGifs.map((gif) => (
              <Box
                key={gif.id}
                component="button"
                type="button"
                onClick={() => onSendGif?.(gif)}
                sx={{
                  display: 'block',
                  width: '100%',
                  border: 'none',
                  bgcolor: 'transparent',
                  p: 0,
                  mb: '4px',
                  cursor: 'pointer',
                  borderRadius: 2,
                  overflow: 'hidden',
                  breakInside: 'avoid',
                  '&:active': { opacity: 0.7 },
                }}
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title || 'GIF'}
                  loading="lazy"
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                    borderRadius: 8,
                  }}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
      <Box sx={{ textAlign: 'center', py: 0.25 }}>
        <Typography sx={{ fontSize: 9, color: alpha(ui.textSecondary || theme.palette.text.secondary, 0.5) }}>
          Powered by GIPHY
        </Typography>
      </Box>
    </Box>
  );
}

function mapGiphyResult(item) {
  const fixed = item?.images?.fixed_width;
  const original = item?.images?.original;
  return {
    id: item.id,
    title: item.title || '',
    previewUrl: fixed?.url || original?.url || '',
    fullUrl: original?.url || fixed?.url || '',
    width: Number(original?.width || fixed?.width || 200),
    height: Number(original?.height || fixed?.height || 200),
  };
}

/* ─── Main panel component ─── */
const ChatEmojiPanel = memo(function ChatEmojiPanel({
  open,
  theme,
  ui,
  onInsertEmoji,
  onSendSticker,
  onSendGif,
  onClose,
}) {
  const [activeTab, setActiveTab] = useState(0);

  if (!open) return null;

  const panelBg = ui.composerBg || ui.panelBg || theme.palette.background.paper;

  return (
    <Box
      sx={{
        width: '100%',
        height: PANEL_HEIGHT,
        bgcolor: panelBg,
        borderTop: `1px solid ${ui.borderSoft || theme.palette.divider}`,
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
        <Tab icon={<InsertEmoticonRoundedIcon sx={{ fontSize: 20 }} />} iconPosition="start" label="Emoji" />
        <Tab icon={<StickyNote2RoundedIcon sx={{ fontSize: 20 }} />} iconPosition="start" label="Стикеры" />
        <Tab icon={<GifBoxRoundedIcon sx={{ fontSize: 20 }} />} iconPosition="start" label="GIF" />
      </Tabs>

      {/* Emoji tab */}
      <TabPanel value={activeTab} index={0}>
        <Suspense
          fallback={
            <Box sx={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
              <CircularProgress size={24} />
            </Box>
          }
        >
          <LazyEmojiPicker
            onEmojiClick={(emojiData) => onInsertEmoji?.(emojiData?.emoji || '')}
            autoFocusSearch={false}
            searchPlaceholder="Поиск"
            skinTonesDisabled
            previewConfig={{ showPreview: false }}
            emojiStyle="native"
            suggestedEmojisMode="recent"
            lazyLoadEmojis
            width="100%"
            height={PANEL_HEIGHT - TAB_BAR_HEIGHT}
            theme={theme.palette.mode === 'dark' ? 'dark' : 'light'}
            categories={[
              { category: 'suggested', name: 'Недавние' },
              { category: 'smileys_people', name: 'Смайлы и люди' },
              { category: 'animals_nature', name: 'Животные' },
              { category: 'food_drink', name: 'Еда' },
              { category: 'travel_places', name: 'Путешествия' },
              { category: 'activities', name: 'Активности' },
              { category: 'objects', name: 'Объекты' },
              { category: 'symbols', name: 'Символы' },
              { category: 'flags', name: 'Флаги' },
            ]}
          />
        </Suspense>
      </TabPanel>

      {/* Stickers tab */}
      <TabPanel value={activeTab} index={1}>
        <StickersTab theme={theme} ui={ui} onSendSticker={onSendSticker} />
      </TabPanel>

      {/* GIF tab */}
      <TabPanel value={activeTab} index={2}>
        <GifTab theme={theme} ui={ui} onSendGif={onSendGif} />
      </TabPanel>
    </Box>
  );
});

export default ChatEmojiPanel;
