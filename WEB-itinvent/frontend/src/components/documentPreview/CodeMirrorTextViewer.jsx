import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import CodeMirror from '@uiw/react-codemirror';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { LanguageDescription } from '@codemirror/language';
import { languages as legacyLanguages } from '@codemirror/language-data';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  search,
  setSearchQuery,
} from '@codemirror/search';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown as markdownLanguage } from '@codemirror/lang-markdown';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import VerticalAlignCenterRoundedIcon from '@mui/icons-material/VerticalAlignCenterRounded';
import WrapTextRoundedIcon from '@mui/icons-material/WrapTextRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded';
import { getTextFileExtension } from '../../lib/textPreview';
import JsonTreeView from './JsonTreeView';

const FAST_LANGUAGE_FACTORIES = {
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true }),
  json: () => json(),
  python: () => python(),
  sql: () => sql(),
  xml: () => xml(),
  yaml: () => yaml(),
  css: () => css(),
  html: () => html(),
  markdown: () => markdownLanguage(),
};

const FONT_SIZE_MIN = 0.7;
const FONT_SIZE_MAX = 1.8;
const FONT_SIZE_STEP = 0.1;
const MATCH_COUNT_LIMIT = 5000;
const SEARCH_DEBOUNCE_MS = 250;

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const countMatches = (state, query, limit = MATCH_COUNT_LIMIT) => {
  if (!query || !query.valid) return { count: 0, limited: false };
  const cursor = query.getCursor(state);
  let count = 0;
  let current = cursor.next();
  while (!current.done && count < limit) {
    count += 1;
    current = cursor.next();
  }
  return { count, limited: !current.done };
};

const matchIndexAround = (state, query, position, maxScan = MATCH_COUNT_LIMIT) => {
  if (!query || !query.valid) return 0;
  const cursor = query.getCursor(state);
  let index = 0;
  let scanned = 0;
  let current = cursor.next();
  while (!current.done && scanned < maxScan) {
    scanned += 1;
    if (current.value.from <= position && position <= current.value.to) return scanned;
    if (current.value.from > position) return 0;
    index = scanned;
    current = cursor.next();
  }
  return 0;
};

export function usePreviewFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [fullscreen]);
  const containerSx = useMemo(() => (fullscreen
    ? {
      position: 'fixed',
      inset: 0,
      zIndex: (theme) => theme.zIndex.tooltip + 10,
      bgcolor: 'background.paper',
    }
    : {}), [fullscreen]);
  return { fullscreen, setFullscreen, containerSx };
}

export function useCopyText() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(0);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(String(text ?? ''));
      setCopied(true);
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, []);
  return { copied, copy };
}

const compactIconButtonSx = {
  width: 30,
  height: 30,
  borderRadius: '7px',
};

export default function CodeMirrorTextViewer({
  value = '',
  fileName = '',
  language = '',
  encoding = '',
  truncated = false,
  hideToolbar = false,
  showJsonTreeToggle = true,
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const viewRef = useRef(null);
  const searchInputRef = useRef(null);
  const gotoInputRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchMeta, setSearchMeta] = useState({ count: 0, limited: false, active: 0 });
  const [wrap, setWrap] = useState(false);
  const [fontScale, setFontScale] = useState(1);
  const [gotoValue, setGotoValue] = useState('');
  const [gotoError, setGotoError] = useState(false);
  const [jsonMode, setJsonMode] = useState('text');
  const [resolvedLanguage, setResolvedLanguage] = useState(null);
  const { fullscreen, setFullscreen, containerSx } = usePreviewFullscreen();
  const { copied, copy } = useCopyText();

  const extension = getTextFileExtension(fileName);
  const isJson = language === 'json';

  const jsonParsed = useMemo(() => {
    if (!isJson) return { ok: false, value: null, error: '' };
    try {
      return { ok: true, value: JSON.parse(value), error: '' };
    } catch (error) {
      return { ok: false, value: null, error: String(error?.message || 'JSON повреждён') };
    }
  }, [isJson, value]);

  // Fast-path languages resolve synchronously; the remaining text formats
  // lazily load a legacy StreamLanguage mode via @codemirror/language-data.
  useEffect(() => {
    let cancelled = false;
    const factory = FAST_LANGUAGE_FACTORIES[language];
    if (factory) {
      setResolvedLanguage(factory());
      return undefined;
    }
    const description = extension
      ? LanguageDescription.matchLanguageName(legacyLanguages, extension)
      : null;
    if (!description) {
      setResolvedLanguage(null);
      return undefined;
    }
    Promise.resolve(description.load())
      .then((support) => {
        if (!cancelled) setResolvedLanguage(support);
      })
      .catch(() => {
        if (!cancelled) setResolvedLanguage(null);
      });
    return () => { cancelled = true; };
  }, [language, extension]);

  const applySearch = useCallback((rawText) => {
    const view = viewRef.current;
    if (!view) return;
    const text = String(rawText || '');
    if (!text) {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
      setSearchMeta({ count: 0, limited: false, active: 0 });
      return;
    }
    const query = new SearchQuery({ search: escapeRegExp(text), caseSensitive: false, literal: true });
    view.dispatch({ effects: setSearchQuery.of(query) });
    findNext(view);
    const meta = countMatches(view.state, getSearchQuery(view.state));
    const active = matchIndexAround(view.state, getSearchQuery(view.state), view.state.selection.main.from);
    setSearchMeta({ ...meta, active: active || (meta.count ? 1 : 0) });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => applySearch(searchText), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchText, applySearch]);

  const stepSearch = useCallback((direction) => {
    const view = viewRef.current;
    if (!view || !searchText) return;
    const moved = direction > 0 ? findNext(view) : findPrevious(view);
    const meta = countMatches(view.state, getSearchQuery(view.state));
    const active = moved
      ? matchIndexAround(view.state, getSearchQuery(view.state), view.state.selection.main.from)
      : 0;
    setSearchMeta({ ...meta, active: active || 0 });
  }, [searchText]);

  const goToLine = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const target = Number.parseInt(gotoValue, 10);
    if (!Number.isFinite(target) || target < 1 || target > view.state.doc.lines) {
      setGotoError(true);
      return;
    }
    setGotoError(false);
    const line = view.state.doc.line(target);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }, [gotoValue]);

  const extensions = useMemo(() => {
    const list = [
      search({ top: true }),
      Prec.highest(keymap.of([
        {
          key: 'Mod-f',
          run: () => {
            setSearchOpen(true);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
            return true;
          },
        },
        {
          key: 'F3',
          run: () => { stepSearch(1); return true; },
        },
        {
          key: 'Shift-F3',
          run: () => { stepSearch(-1); return true; },
        },
        {
          key: 'Mod-g',
          run: () => {
            setSearchOpen(true);
            window.setTimeout(() => gotoInputRef.current?.focus(), 0);
            return true;
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            setSearchOpen(false);
            setSearchText('');
            view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
            closeSearchPanel(view);
            return true;
          },
        },
      ])),
      EditorView.theme({
        '.cm-scroller': { fontSize: `${fontScale}em` },
      }),
    ];
    if (wrap) list.push(EditorView.lineWrapping);
    if (resolvedLanguage) list.push(resolvedLanguage);
    return list;
    // stepSearch identity changes only when searchText changes; the keymap is
    // rebuilt then, which keeps F3 behaviour consistent with the live query.
  }, [wrap, resolvedLanguage, fontScale, stepSearch]);

  const lineCount = useMemo(() => {
    if (!value) return 0;
    let count = 1;
    for (let i = 0; i < value.length; i += 1) {
      if (value.charCodeAt(i) === 10) count += 1;
    }
    return count;
  }, [value]);

  const sizeLabel = useMemo(() => {
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${bytes} Б`;
  }, [value]);

  const languageLabel = language || extension || 'text';
  const showEditor = jsonMode === 'text' || !isJson || !jsonParsed.ok;

  return (
    <Box
      data-testid="codemirror-text-viewer"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        ...containerSx,
      }}
    >
      {hideToolbar ? null : (
        <Stack
          direction="row"
          spacing={0.5}
          alignItems="center"
          sx={{
            px: { xs: 0.75, sm: 1.25 },
            py: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: alpha(theme.palette.background.default, isDark ? 0.55 : 0.75),
            flexWrap: 'wrap',
            rowGap: 0.5,
          }}
        >
          {isJson && showJsonTreeToggle ? (
            <ToggleButtonGroup
              size="small"
              exclusive
              value={jsonParsed.ok ? jsonMode : 'text'}
              onChange={(_event, next) => { if (next) setJsonMode(next); }}
              sx={{ '& .MuiToggleButton-root': { px: 1.2, py: 0.2, textTransform: 'none', fontSize: '0.75rem' } }}
            >
              <ToggleButton value="text">Текст</ToggleButton>
              <ToggleButton value="tree" disabled={!jsonParsed.ok}>Дерево</ToggleButton>
            </ToggleButtonGroup>
          ) : null}
          <Tooltip title={wrap ? 'Отключить перенос строк' : 'Переносить длинные строки'}>
            <IconButton
              onClick={() => setWrap((current) => !current)}
              aria-label="Перенос строк"
              aria-pressed={wrap}
              sx={{ ...compactIconButtonSx, color: wrap ? 'primary.main' : 'text.secondary' }}
            >
              <WrapTextRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Найти (Ctrl+F)">
            <IconButton
              onClick={() => {
                setSearchOpen((current) => {
                  if (current) {
                    setSearchText('');
                    const view = viewRef.current;
                    if (view) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
                  }
                  return !current;
                });
              }}
              aria-label="Поиск по файлу"
              aria-pressed={searchOpen}
              sx={{ ...compactIconButtonSx, color: searchOpen ? 'primary.main' : 'text.secondary' }}
            >
              <SearchRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
          <Tooltip title="Уменьшить текст">
            <span>
              <IconButton
                onClick={() => setFontScale((current) => Math.max(FONT_SIZE_MIN, +(current - FONT_SIZE_STEP).toFixed(2)))}
                disabled={fontScale <= FONT_SIZE_MIN}
                aria-label="Уменьшить текст"
                sx={compactIconButtonSx}
              >
                <ZoomOutRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Увеличить текст">
            <span>
              <IconButton
                onClick={() => setFontScale((current) => Math.min(FONT_SIZE_MAX, +(current + FONT_SIZE_STEP).toFixed(2)))}
                disabled={fontScale >= FONT_SIZE_MAX}
                aria-label="Увеличить текст"
                sx={compactIconButtonSx}
              >
                <ZoomInRoundedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
          <Tooltip title={copied ? 'Скопировано' : 'Копировать всё'}>
            <IconButton
              onClick={() => copy(value)}
              aria-label="Копировать весь текст"
              sx={{ ...compactIconButtonSx, color: copied ? 'success.main' : 'text.secondary' }}
            >
              <ContentCopyRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={fullscreen ? 'Выйти из полноэкранного режима (Esc)' : 'На весь экран'}>
            <IconButton
              onClick={() => setFullscreen((current) => !current)}
              aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
              sx={compactIconButtonSx}
            >
              {fullscreen ? <FullscreenExitRoundedIcon fontSize="small" /> : <FullscreenRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      )}

      {searchOpen && !hideToolbar ? (
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={0.75}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          sx={{
            px: { xs: 0.75, sm: 1.25 },
            py: 0.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: alpha(theme.palette.background.default, isDark ? 0.35 : 0.55),
          }}
        >
          <TextField
            size="small"
            inputRef={searchInputRef}
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') stepSearch(event.shiftKey ? -1 : 1);
              if (event.key === 'Escape') {
                setSearchOpen(false);
                setSearchText('');
                const view = viewRef.current;
                if (view) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
              }
            }}
            placeholder="Найти в файле…"
            inputProps={{ 'aria-label': 'Найти в файле' }}
            sx={{ flex: 1, minWidth: 0, '& .MuiInputBase-root': { height: 32, fontSize: '0.85rem' } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                </InputAdornment>
              ),
            }}
          />
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 64, textAlign: 'center' }}>
              {searchText
                ? `${searchMeta.active || 0}/${searchMeta.limited ? `${searchMeta.count}+` : searchMeta.count}`
                : '—'}
            </Typography>
            <Tooltip title="Предыдущее совпадение (Shift+Enter)">
              <span>
                <IconButton onClick={() => stepSearch(-1)} disabled={!searchMeta.count} aria-label="Предыдущее совпадение" sx={compactIconButtonSx}>
                  <KeyboardArrowUpRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Следующее совпадение (Enter)">
              <span>
                <IconButton onClick={() => stepSearch(1)} disabled={!searchMeta.count} aria-label="Следующее совпадение" sx={compactIconButtonSx}>
                  <KeyboardArrowDownRoundedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <TextField
              size="small"
              inputRef={gotoInputRef}
              value={gotoValue}
              error={gotoError}
              onChange={(event) => {
                setGotoValue(event.target.value.replace(/[^0-9]/g, ''));
                setGotoError(false);
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') goToLine(); }}
              placeholder="Строка"
              inputProps={{ 'aria-label': 'Перейти к строке' }}
              sx={{ width: 90, '& .MuiInputBase-root': { height: 32, fontSize: '0.85rem' } }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <VerticalAlignCenterRoundedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                  </InputAdornment>
                ),
              }}
            />
            <Tooltip title="Закрыть поиск">
              <IconButton
                onClick={() => {
                  setSearchOpen(false);
                  setSearchText('');
                  const view = viewRef.current;
                  if (view) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });
                }}
                aria-label="Закрыть поиск"
                sx={compactIconButtonSx}
              >
                <CloseRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      ) : null}

      {truncated ? (
        <Alert severity="info" sx={{ borderRadius: 0, py: 0.25 }} icon={false}>
          Показана первая часть файла (до 8 МБ). Скачайте оригинал, чтобы открыть его целиком.
        </Alert>
      ) : null}
      {isJson && !jsonParsed.ok ? (
        <Alert severity="warning" sx={{ borderRadius: 0, py: 0.25 }} icon={false}>
          JSON повреждён ({jsonParsed.error}) — показан как текст.
        </Alert>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        {showEditor ? (
          <CodeMirror
            value={value}
            height="100%"
            theme={isDark ? oneDark : 'light'}
            editable={false}
            readOnly
            basicSetup={{
              lineNumbers: true,
              highlightActiveLine: true,
              highlightActiveLineGutter: true,
              foldGutter: true,
              searchKeymap: false,
              autocompletion: false,
              completionKeymap: false,
              lintKeymap: false,
              tabSize: 4,
            }}
            extensions={extensions}
            onCreateEditor={(view) => { viewRef.current = view; }}
            style={{ height: '100%' }}
          />
        ) : (
          <Box sx={{ height: '100%', overflow: 'auto', p: { xs: 1, sm: 1.5 } }}>
            <JsonTreeView data={jsonParsed.value} defaultDepth={1} />
          </Box>
        )}
      </Box>

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{
          px: { xs: 1, sm: 1.5 },
          py: 0.4,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: alpha(theme.palette.background.default, isDark ? 0.55 : 0.75),
          flexWrap: 'wrap',
          rowGap: 0.25,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {languageLabel.toUpperCase()}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {lineCount.toLocaleString('ru-RU')} строк
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {sizeLabel}
        </Typography>
        {encoding ? (
          <Typography variant="caption" color="text.secondary">
            {encoding}
          </Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Только чтение
        </Typography>
      </Stack>
    </Box>
  );
}
