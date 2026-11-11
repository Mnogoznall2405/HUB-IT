import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material';
import ClearFormattingRoundedIcon from '@mui/icons-material/FormatClearRounded';
import FormatAlignCenterRoundedIcon from '@mui/icons-material/FormatAlignCenterRounded';
import FormatAlignJustifyRoundedIcon from '@mui/icons-material/FormatAlignJustifyRounded';
import FormatAlignLeftRoundedIcon from '@mui/icons-material/FormatAlignLeftRounded';
import FormatAlignRightRoundedIcon from '@mui/icons-material/FormatAlignRightRounded';
import FormatBoldRoundedIcon from '@mui/icons-material/FormatBoldRounded';
import FormatIndentDecreaseRoundedIcon from '@mui/icons-material/FormatIndentDecreaseRounded';
import FormatIndentIncreaseRoundedIcon from '@mui/icons-material/FormatIndentIncreaseRounded';
import FormatItalicRoundedIcon from '@mui/icons-material/FormatItalicRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRoundedIcon from '@mui/icons-material/FormatListNumberedRounded';
import FormatQuoteRoundedIcon from '@mui/icons-material/FormatQuoteRounded';
import FormatStrikethroughRoundedIcon from '@mui/icons-material/FormatStrikethroughRounded';
import FormatUnderlinedRoundedIcon from '@mui/icons-material/FormatUnderlinedRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import RedoRoundedIcon from '@mui/icons-material/RedoRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';

const getEditor = (editorRef) => editorRef.current?.getEditor?.();

const getRange = (editor) => editor?.getSelection?.(true) || {
  index: Math.max(0, (editor?.getLength?.() || 1) - 1),
  length: 0,
};

const TEXT_SIZE_LABELS = {
  small: 'Мелкий',
  '': 'Средний',
  large: 'Крупный',
  huge: 'Очень крупный',
};

const ALIGNMENT_ICONS = {
  center: FormatAlignCenterRoundedIcon,
  right: FormatAlignRightRoundedIcon,
  justify: FormatAlignJustifyRoundedIcon,
};

const toolbarSelectSx = {
  height: 36,
  color: 'text.primary',
  bgcolor: 'action.hover',
  '& .MuiSelect-select': {
    display: 'flex',
    alignItems: 'center',
    gap: 0.75,
  },
  '& .MuiSelect-icon': {
    color: 'text.secondary',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: 'divider',
  },
  '&:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: 'text.secondary',
  },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: 'primary.main',
  },
  '&.Mui-focused': {
    boxShadow: '0 0 0 2px',
    boxShadowColor: 'primary.main',
  },
};

const colorControlSx = {
  width: 36,
  height: 36,
  display: 'grid',
  placeItems: 'center',
  color: 'text.primary',
  cursor: 'pointer',
  borderRadius: 1,
  '&:hover': { bgcolor: 'action.hover' },
  '&:focus-within': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 2,
  },
};

function FormatButton({ label, pressed, onClick, children }) {
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        aria-pressed={pressed === undefined ? undefined : Boolean(pressed)}
        onClick={onClick}
        sx={{
          width: 36,
          height: 36,
          borderRadius: '8px',
          color: pressed ? 'primary.contrastText' : 'text.secondary',
          bgcolor: pressed ? 'primary.main' : 'transparent',
          '&:hover': { bgcolor: pressed ? 'primary.dark' : 'action.hover' },
          '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
        }}
      >
        {children}
      </IconButton>
    </Tooltip>
  );
}

export default function MailComposeToolbar({ editorRef, mobile = false }) {
  const [formats, setFormats] = useState({});
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('https://');

  useEffect(() => {
    const editor = getEditor(editorRef);
    if (!editor || typeof editor.on !== 'function') return undefined;
    const update = (range) => setFormats(range ? (editor.getFormat?.(range) || {}) : {});
    const onSelectionChange = (range) => update(range);
    const onTextChange = () => update(editor.getSelection?.());
    editor.on('selection-change', onSelectionChange);
    editor.on('text-change', onTextChange);
    update(editor.getSelection?.());
    return () => {
      editor.off('selection-change', onSelectionChange);
      editor.off('text-change', onTextChange);
    };
  }, [editorRef]);

  const toggle = (format, explicitValue) => {
    const editor = getEditor(editorRef);
    if (!editor) return;
    editor.focus();
    const range = getRange(editor);
    const current = editor.getFormat?.(range) || {};
    editor.format(format, explicitValue === undefined ? !current[format] : explicitValue, 'user');
  };

  const run = (action) => {
    action(getEditor(editorRef));
    setMoreAnchor(null);
  };

  const applyLink = () => {
    const editor = getEditor(editorRef);
    if (!editor) return;
    const value = String(linkValue || '').trim();
    editor.focus();
    editor.format('link', value || false, 'user');
    setLinkOpen(false);
  };

  const mainButtons = (
    <>
      <FormatButton label="Жирный" pressed={Boolean(formats.bold)} onClick={() => toggle('bold')}>
        <FormatBoldRoundedIcon fontSize="small" />
      </FormatButton>
      <FormatButton label="Курсив" pressed={Boolean(formats.italic)} onClick={() => toggle('italic')}>
        <FormatItalicRoundedIcon fontSize="small" />
      </FormatButton>
      <FormatButton label="Подчёркивание" pressed={Boolean(formats.underline)} onClick={() => toggle('underline')}>
        <FormatUnderlinedRoundedIcon fontSize="small" />
      </FormatButton>
      <FormatButton label="Зачёркивание" pressed={Boolean(formats.strike)} onClick={() => toggle('strike')}>
        <FormatStrikethroughRoundedIcon fontSize="small" />
      </FormatButton>
      <FormatButton label="Маркированный список" pressed={formats.list === 'bullet'} onClick={() => toggle('list', formats.list === 'bullet' ? false : 'bullet')}>
        <FormatListBulletedRoundedIcon fontSize="small" />
      </FormatButton>
      <FormatButton label="Нумерованный список" pressed={formats.list === 'ordered'} onClick={() => toggle('list', formats.list === 'ordered' ? false : 'ordered')}>
        <FormatListNumberedRoundedIcon fontSize="small" />
      </FormatButton>
    </>
  );

  return (
    <Stack spacing={0.75} sx={{ px: 0.25, pb: 0.7 }}>
      <Stack
        direction="row"
        spacing={0.35}
        alignItems="center"
        useFlexGap
        flexWrap={mobile ? 'nowrap' : 'wrap'}
        sx={{ overflowX: mobile ? 'auto' : 'visible', pb: mobile ? 0.25 : 0 }}
      >
        {mainButtons}

        <Select
          size="small"
          aria-label="Стиль абзаца"
          displayEmpty
          value={formats.header || ''}
          onChange={(event) => toggle('header', event.target.value || false)}
          renderValue={(value) => (value ? `Абзац: заголовок ${value}` : 'Абзац: обычный')}
          sx={{ ...toolbarSelectSx, minWidth: 138, fontSize: '0.82rem' }}
        >
          <MenuItem value="">Обычный текст</MenuItem>
          <MenuItem value={1}>Заголовок 1</MenuItem>
          <MenuItem value={2}>Заголовок 2</MenuItem>
          <MenuItem value={3}>Заголовок 3</MenuItem>
        </Select>

        <Select
          size="small"
          aria-label="Размер текста"
          displayEmpty
          value={formats.size || ''}
          onChange={(event) => toggle('size', event.target.value || false)}
          renderValue={(value) => `Размер: ${(TEXT_SIZE_LABELS[value] || TEXT_SIZE_LABELS['']).toLocaleLowerCase('ru-RU')}`}
          sx={{ ...toolbarSelectSx, minWidth: 132, fontSize: '0.82rem' }}
        >
          <MenuItem value="small">Мелкий</MenuItem>
          <MenuItem value="">Средний</MenuItem>
          <MenuItem value="large">Крупный</MenuItem>
          <MenuItem value="huge">Очень крупный</MenuItem>
        </Select>

        <Tooltip title="Цвет текста">
          <Box component="label" sx={colorControlSx}>
            <Box component="span" aria-hidden sx={{ fontWeight: 800, color: 'text.primary', borderBottom: '3px solid', borderBottomColor: formats.color || 'text.primary' }}>A</Box>
            <input
              aria-label="Цвет текста"
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(formats.color || '') ? formats.color : '#000000'}
              onChange={(event) => toggle('color', event.target.value)}
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            />
          </Box>
        </Tooltip>

        <Tooltip title="Цвет фона текста">
          <Box component="label" sx={colorControlSx}>
            <Box component="span" aria-hidden sx={{ fontWeight: 800, color: 'text.primary', borderBottom: '5px solid', borderBottomColor: formats.background || '#fff59d' }}>A</Box>
            <input
              aria-label="Цвет фона текста"
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(formats.background || '') ? formats.background : '#fff59d'}
              onChange={(event) => toggle('background', event.target.value)}
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
            />
          </Box>
        </Tooltip>

        {!mobile ? (
          <>
            <FormatButton label="Отменить" onClick={() => run((editor) => editor?.history?.undo?.())}>
              <UndoRoundedIcon fontSize="small" />
            </FormatButton>
            <FormatButton label="Повторить" onClick={() => run((editor) => editor?.history?.redo?.())}>
              <RedoRoundedIcon fontSize="small" />
            </FormatButton>
            <FormatButton label="Цитата" pressed={Boolean(formats.blockquote)} onClick={() => toggle('blockquote')}>
              <FormatQuoteRoundedIcon fontSize="small" />
            </FormatButton>
            <FormatButton label="Уменьшить отступ" onClick={() => run((editor) => editor?.format('indent', '-1', 'user'))}>
              <FormatIndentDecreaseRoundedIcon fontSize="small" />
            </FormatButton>
            <FormatButton label="Увеличить отступ" onClick={() => run((editor) => editor?.format('indent', '+1', 'user'))}>
              <FormatIndentIncreaseRoundedIcon fontSize="small" />
            </FormatButton>
            <Select
              size="small"
              aria-label="Выравнивание"
              displayEmpty
              value={formats.align || ''}
              onChange={(event) => toggle('align', event.target.value || false)}
              renderValue={(value) => {
                const AlignmentIcon = ALIGNMENT_ICONS[value] || FormatAlignLeftRoundedIcon;
                return <AlignmentIcon aria-hidden fontSize="small" />;
              }}
              sx={{ ...toolbarSelectSx, width: 72 }}
            >
              <MenuItem value="">Слева</MenuItem>
              <MenuItem value="center">По центру</MenuItem>
              <MenuItem value="right">Справа</MenuItem>
              <MenuItem value="justify">По ширине</MenuItem>
            </Select>
            <FormatButton label="Добавить ссылку" pressed={Boolean(formats.link)} onClick={() => setLinkOpen((value) => !value)}>
              <LinkRoundedIcon fontSize="small" />
            </FormatButton>
            <FormatButton label="Очистить форматирование" onClick={() => run((editor) => {
              const range = getRange(editor);
              editor?.removeFormat?.(range.index, range.length || 1, 'user');
            })}>
              <ClearFormattingRoundedIcon fontSize="small" />
            </FormatButton>
          </>
        ) : (
          <FormatButton label="Ещё команды" onClick={(event) => setMoreAnchor(event.currentTarget)}>
            <MoreHorizRoundedIcon fontSize="small" />
          </FormatButton>
        )}
      </Stack>

      {linkOpen ? (
        <Stack direction="row" spacing={0.75} alignItems="center">
          <TextField
            size="small"
            fullWidth
            autoFocus
            label="Адрес ссылки"
            value={linkValue}
            onChange={(event) => setLinkValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                applyLink();
              }
            }}
          />
          <Button onClick={applyLink}>Применить</Button>
          <Button onClick={() => toggle('link', false)}>Удалить</Button>
        </Stack>
      ) : null}

      <Menu open={Boolean(moreAnchor)} anchorEl={moreAnchor} onClose={() => setMoreAnchor(null)}>
        <MenuItem onClick={() => run((editor) => editor?.history?.undo?.())}><UndoRoundedIcon fontSize="small" sx={{ mr: 1 }} />Отменить</MenuItem>
        <MenuItem onClick={() => run((editor) => editor?.history?.redo?.())}><RedoRoundedIcon fontSize="small" sx={{ mr: 1 }} />Повторить</MenuItem>
        <MenuItem onClick={() => { toggle('blockquote'); setMoreAnchor(null); }}><FormatQuoteRoundedIcon fontSize="small" sx={{ mr: 1 }} />Цитата</MenuItem>
        <MenuItem onClick={() => run((editor) => editor?.format('indent', '-1', 'user'))}><FormatIndentDecreaseRoundedIcon fontSize="small" sx={{ mr: 1 }} />Уменьшить отступ</MenuItem>
        <MenuItem onClick={() => run((editor) => editor?.format('indent', '+1', 'user'))}><FormatIndentIncreaseRoundedIcon fontSize="small" sx={{ mr: 1 }} />Увеличить отступ</MenuItem>
        <MenuItem onClick={() => { toggle('align', false); setMoreAnchor(null); }}><FormatAlignLeftRoundedIcon fontSize="small" sx={{ mr: 1 }} />Выровнять слева</MenuItem>
        <MenuItem onClick={() => { toggle('align', 'center'); setMoreAnchor(null); }}>По центру</MenuItem>
        <MenuItem onClick={() => { toggle('align', 'right'); setMoreAnchor(null); }}>Выровнять справа</MenuItem>
        <MenuItem onClick={() => { toggle('align', 'justify'); setMoreAnchor(null); }}>По ширине</MenuItem>
        <MenuItem onClick={() => { setLinkOpen(true); setMoreAnchor(null); }}><LinkRoundedIcon fontSize="small" sx={{ mr: 1 }} />Добавить ссылку</MenuItem>
        <MenuItem onClick={() => run((editor) => {
          const range = getRange(editor);
          editor?.removeFormat?.(range.index, range.length || 1, 'user');
        })}><ClearFormattingRoundedIcon fontSize="small" sx={{ mr: 1 }} />Очистить форматирование</MenuItem>
      </Menu>
    </Stack>
  );
}
