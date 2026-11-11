import { memo, useCallback, useEffect, useRef } from 'react';
import { Box, Button, IconButton, Stack } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CheckIcon from '@mui/icons-material/Check';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import { hideMobileScrollbarSx } from '../../../pages/tasks/taskFormatters';
import { editorHtmlToMarkdown, focusRichEditor, markdownToEditorHtml } from '../../../pages/tasks/taskRichText';

const MobileCreateDescriptionEditor = memo(function MobileCreateDescriptionEditor({
  initialValue = '',
  onDraftChange,
  onDone,
  onAddFiles,
  resetKey = '',
  ui,
  theme,
}) {
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = markdownToEditorHtml(initialValue);
    onDraftChange?.(editorHtmlToMarkdown(editor.innerHTML));
    window.requestAnimationFrame(() => focusRichEditor(editor));
  }, [initialValue, onDraftChange, resetKey]);

  const syncDraft = useCallback(() => {
    const editor = editorRef.current;
    onDraftChange?.(editorHtmlToMarkdown(editor?.innerHTML || ''));
  }, [onDraftChange]);

  const handleFormat = useCallback((type) => {
    const commandByType = {
      bold: 'bold',
      italic: 'italic',
      strike: 'strikeThrough',
      bullet: 'insertUnorderedList',
      numbered: 'insertOrderedList',
      mention: 'insertText',
    };
    const command = commandByType[type];
    if (!command || typeof document === 'undefined' || typeof document.execCommand !== 'function') return;
    focusRichEditor(editorRef.current);
    document.execCommand(command, false, type === 'mention' ? '@' : null);
    syncDraft();
  }, [syncDraft]);

  const handleOpenFiles = useCallback(() => {
    syncDraft();
    fileInputRef.current?.click();
  }, [syncDraft]);

  const handleFileChange = useCallback((event) => {
    syncDraft();
    onAddFiles?.(event.target.files);
    event.target.value = '';
    window.requestAnimationFrame(() => {
      focusRichEditor(editorRef.current);
    });
  }, [onAddFiles, syncDraft]);

  const toolbarItems = [
    { key: 'bold', label: 'Жирный', icon: <FormatBoldIcon /> },
    { key: 'italic', label: 'Курсив', icon: <FormatItalicIcon /> },
    { key: 'strike', label: 'Зачеркнуть', icon: <StrikethroughSIcon /> },
    { key: 'bullet', label: 'Список', icon: <FormatListBulletedIcon /> },
    { key: 'numbered', label: 'Нумерация', icon: <FormatListNumberedIcon /> },
    { key: 'mention', label: 'Упоминание', icon: <AlternateEmailIcon /> },
  ];

  return (
    <Stack spacing={0} sx={{ height: '100%', minHeight: 0 }}>
      <Box
        ref={editorRef}
        component="div"
        contentEditable
        suppressContentEditableWarning
        data-testid="create-description-mobile-input"
        aria-label="Описание задачи"
        role="textbox"
        tabIndex={0}
        data-placeholder="Опишите задачу, детали и ожидаемый результат"
        onInput={syncDraft}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          outline: 'none',
          color: ui.text,
          fontSize: '1.02rem',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          ...hideMobileScrollbarSx,
          '&:empty::before': {
            content: 'attr(data-placeholder)',
            color: ui.mutedText,
            opacity: 0.75,
            pointerEvents: 'none',
          },
          '& ul, & ol': { pl: 2.2, my: 0.65 },
          '& li': { my: 0.25 },
          '& b, & strong': { fontWeight: 900 },
          '& i, & em': { fontStyle: 'italic' },
        }}
      />

      <Box
        sx={{
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 0.55,
          pt: 0.9,
          pb: 'calc(0.35rem + env(safe-area-inset-bottom, 0px))',
          borderTop: '1px solid',
          borderColor: alpha(ui.borderSoft, 0.75),
        }}
      >
        <Box
          data-testid="create-description-toolbar-scroll"
          sx={{
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            ...hideMobileScrollbarSx,
          }}
        >
          <Stack direction="row" alignItems="center" spacing={0.25} sx={{ minWidth: 'max-content' }}>
            {toolbarItems.map((item) => (
              <IconButton
                key={item.key}
                size="small"
                data-testid={`create-description-format-${item.key}`}
                aria-label={item.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleFormat(item.key)}
                sx={{ width: 32, height: 32, color: ui.mutedText, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: 19 } }}
              >
                {item.icon}
              </IconButton>
            ))}
            <IconButton
              size="small"
              data-testid="create-description-open-files"
              aria-label="Прикрепить файл"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleOpenFiles}
              sx={{ width: 32, height: 32, color: ui.mutedText, flexShrink: 0, '& .MuiSvgIcon-root': { fontSize: 19 } }}
            >
              <AttachFileIcon />
            </IconButton>
            <input
              ref={fileInputRef}
              data-testid="create-description-file-input"
              type="file"
              hidden
              multiple
              onChange={handleFileChange}
            />
          </Stack>
        </Box>
        <Button
          variant="contained"
          data-testid="create-description-mobile-done"
          onClick={onDone}
          aria-label="Готово"
          sx={{
            minWidth: 44,
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: '14px',
            px: 0,
            boxShadow: 'none',
            bgcolor: theme.palette.primary.main,
            '&:hover': { bgcolor: theme.palette.primary.dark || theme.palette.primary.main },
          }}
        >
          <CheckIcon />
        </Button>
      </Box>
    </Stack>
  );
});

export default MobileCreateDescriptionEditor;
