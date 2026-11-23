import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import ListAltRoundedIcon from '@mui/icons-material/ListAltRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import { extractMarkdownHeadings, safeMarkdownUrlTransform } from '../../lib/textPreview';
import CodeMirrorTextViewer, { useCopyText, usePreviewFullscreen } from './CodeMirrorTextViewer';

export const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'mark'],
  protocols: {
    ...(defaultSchema.protocols || {}),
    href: ['http', 'https', 'mailto', 'tel'],
    src: ['http', 'https'],
  },
};

export const MARKDOWN_REHYPE_PLUGINS = [
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeSlug,
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
];
export const MARKDOWN_REMARK_PLUGINS = [remarkGfm];

const flattenText = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  if (node?.props?.children !== undefined) return flattenText(node.props.children);
  return '';
};

function CodeBlock({ node: _node, children, ...props }) {
  const { copied, copy } = useCopyText();
  void _node;
  const child = Array.isArray(children) ? children[0] : children;
  const codeClassName = String(child?.props?.className || '');
  const language = (codeClassName.match(/language-([\w+-]+)/) || [])[1] || '';
  const codeText = flattenText(child?.props?.children).replace(/\n$/, '');
  return (
    <Box
      component="pre"
      {...props}
      sx={{ position: 'relative' }}
      data-code-language={language || undefined}
    >
      <Tooltip title={copied ? 'Скопировано' : 'Копировать код'}>
        <IconButton
          size="small"
          aria-label="Копировать код"
          onClick={() => copy(codeText)}
          sx={{
            position: 'absolute',
            top: 6,
            right: 6,
            width: 26,
            height: 26,
            borderRadius: '6px',
            color: copied ? 'success.main' : 'text.secondary',
            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.85),
            border: '1px solid',
            borderColor: 'divider',
            '&:hover': { bgcolor: 'background.paper' },
          }}
        >
          {copied ? <CheckRoundedIcon sx={{ fontSize: 15 }} /> : <ContentCopyRoundedIcon sx={{ fontSize: 15 }} />}
        </IconButton>
      </Tooltip>
      {children}
    </Box>
  );
}

const buildComponents = () => ({
  a({ node: _node, href, children, ...props }) {
    void _node;
    const external = /^https?:\/\//i.test(String(href || ''));
    return (
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...props}
      >
        {children}
      </a>
    );
  },
  pre: CodeBlock,
  table({ node: _node, ...props }) {
    void _node;
    return (
      <Box
        data-testid="markdown-table-scroll"
        sx={{
          position: 'relative',
          maxWidth: '100%',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
          borderRadius: '8px',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Box component="table" {...props} />
      </Box>
    );
  },
});

const hljsSx = (isDark) => ({
  '& .hljs': { color: isDark ? '#abb2bf' : '#24292e' },
  '& .hljs-comment, & .hljs-quote': { color: isDark ? '#7f848e' : '#6a737d', fontStyle: 'italic' },
  '& .hljs-keyword, & .hljs-selector-tag, & .hljs-tag': { color: isDark ? '#c678dd' : '#d73a49' },
  '& .hljs-string, & .hljs-regexp, & .hljs-addition': { color: isDark ? '#98c379' : '#032f62' },
  '& .hljs-number, & .hljs-literal': { color: isDark ? '#d19a66' : '#005cc5' },
  '& .hljs-title, & .hljs-name, & .hljs-section': { color: isDark ? '#61afef' : '#6f42c1' },
  '& .hljs-attr, & .hljs-attribute, & .hljs-variable, & .hljs-built_in': { color: isDark ? '#e5c07b' : '#e36209' },
  '& .hljs-deletion': { color: isDark ? '#e06c75' : '#b31d28' },
  '& .hljs-meta, & .hljs-symbol, & .hljs-link': { color: isDark ? '#56b6c2' : '#005cc5' },
});

export default function MarkdownFileViewer({
  value = '',
  fileName = '',
  encoding = '',
  truncated = false,
}) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const isWide = useMediaQuery(theme.breakpoints.up('md'));
  const scrollRef = useRef(null);
  const [mode, setMode] = useState('preview');
  const [tocOpen, setTocOpen] = useState(false);
  const [tocPinned, setTocPinned] = useState(false);
  const { fullscreen, setFullscreen, containerSx } = usePreviewFullscreen();
  const { copied, copy } = useCopyText();

  const headings = useMemo(() => extractMarkdownHeadings(value), [value]);
  const components = useMemo(buildComponents, []);

  useEffect(() => {
    if (headings.length >= 3 && isWide && !tocPinned) {
      setTocOpen(true);
      setTocPinned(true);
    }
  }, [headings.length, isWide, tocPinned]);

  const scrollToHeading = useCallback((slug) => {
    const container = scrollRef.current;
    const target = container?.querySelector(`#${CSS.escape(slug)}`)
      || document.getElementById(slug);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (!isWide) setTocOpen(false);
  }, [isWide]);

  const lineCount = useMemo(() => {
    if (!value) return 0;
    let count = 1;
    for (let i = 0; i < value.length; i += 1) {
      if (value.charCodeAt(i) === 10) count += 1;
    }
    return count;
  }, [value]);

  const tocList = (
    <List dense disablePadding sx={{ py: 0.5 }} aria-label="Содержание документа">
      {headings.map((heading, index) => (
        <ListItemButton
          key={`${heading.slug}-${index}`}
          onClick={() => scrollToHeading(heading.slug)}
          sx={{
            pl: 1 + (heading.level - 1) * 1.5,
            py: 0.35,
            borderRadius: '6px',
            mx: 0.5,
          }}
        >
          <ListItemText
            primary={heading.text}
            primaryTypographyProps={{
              variant: 'body2',
              noWrap: true,
              sx: { fontSize: '0.8rem', fontWeight: heading.level <= 2 ? 700 : 400 },
            }}
          />
        </ListItemButton>
      ))}
    </List>
  );

  const tocAside = headings.length ? (
    isWide ? (
      <Box
        component="nav"
        aria-label="Содержание"
        sx={{
          width: 240,
          flexShrink: 0,
          borderLeft: '1px solid',
          borderColor: 'divider',
          overflowY: 'auto',
          display: tocOpen ? 'block' : 'none',
          bgcolor: alpha(theme.palette.background.default, isDark ? 0.4 : 0.5),
        }}
      >
        <Typography variant="caption" sx={{ display: 'block', px: 1.5, pt: 1, pb: 0.5, fontWeight: 800, color: 'text.secondary' }}>
          СОДЕРЖАНИЕ
        </Typography>
        {tocList}
      </Box>
    ) : (
      <Drawer
        anchor="right"
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        PaperProps={{ sx: { width: 'min(78vw, 300px)', p: 1 } }}
      >
        <Typography variant="caption" sx={{ display: 'block', px: 1, pt: 0.5, pb: 0.5, fontWeight: 800, color: 'text.secondary' }}>
          СОДЕРЖАНИЕ
        </Typography>
        {tocList}
      </Drawer>
    )
  ) : null;

  return (
    <Box
      data-testid="markdown-file-viewer"
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
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode}
          onChange={(_event, next) => { if (next) setMode(next); }}
          sx={{ '& .MuiToggleButton-root': { px: 1.4, py: 0.2, textTransform: 'none', fontSize: '0.75rem' } }}
        >
          <ToggleButton value="preview">Просмотр</ToggleButton>
          <ToggleButton value="source">Исходник</ToggleButton>
        </ToggleButtonGroup>
        <Tooltip title={headings.length ? 'Содержание' : 'В документе нет заголовков'}>
          <span>
            <IconButton
              onClick={() => setTocOpen((current) => !current)}
              disabled={!headings.length}
              aria-label="Содержание документа"
              aria-pressed={tocOpen}
              sx={{ width: 30, height: 30, borderRadius: '7px', color: tocOpen ? 'primary.main' : 'text.secondary' }}
            >
              <ListAltRoundedIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Divider orientation="vertical" flexItem sx={{ mx: 0.25 }} />
        <Tooltip title={copied ? 'Скопировано' : 'Копировать исходник'}>
          <IconButton
            onClick={() => copy(value)}
            aria-label="Копировать исходник"
            sx={{ width: 30, height: 30, borderRadius: '7px', color: copied ? 'success.main' : 'text.secondary' }}
          >
            <ContentCopyRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={fullscreen ? 'Выйти из полноэкранного режима (Esc)' : 'На весь экран'}>
          <IconButton
            onClick={() => setFullscreen((current) => !current)}
            aria-label={fullscreen ? 'Выйти из полноэкранного режима' : 'На весь экран'}
            sx={{ width: 30, height: 30, borderRadius: '7px' }}
          >
            {fullscreen ? <FullscreenExitRoundedIcon fontSize="small" /> : <FullscreenRoundedIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
      </Stack>

      {truncated ? (
        <Alert severity="info" sx={{ borderRadius: 0, py: 0.25 }} icon={false}>
          Показана первая часть файла (до 8 МБ). Скачайте оригинал, чтобы открыть его целиком.
        </Alert>
      ) : null}

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {mode === 'source' ? (
          <CodeMirrorTextViewer
            value={value}
            fileName={fileName}
            language="markdown"
            encoding={encoding}
            truncated={false}
            hideToolbar
            showJsonTreeToggle={false}
          />
        ) : (
          <Box
            ref={scrollRef}
            data-testid="markdown-preview-scroll"
            sx={{
              flex: 1,
              minWidth: 0,
              overflowY: 'auto',
              px: { xs: 1.5, sm: 3, md: 4 },
              py: { xs: 1.5, sm: 2.5 },
              color: 'text.primary',
              fontSize: '0.95rem',
              lineHeight: 1.65,
              overflowWrap: 'break-word',
              '& > *:first-of-type': { mt: 0 },
              '& p': { my: 1 },
              '& ul, & ol': { pl: 2.6, my: 1 },
              '& ul': { listStyleType: 'disc' },
              '& ol': { listStyleType: 'decimal' },
              '& ul ul': { listStyleType: 'circle' },
              '& li': { my: 0.25, display: 'list-item' },
              '& li.task-list-item': { listStyleType: 'none', ml: -2.2 },
              '& li.task-list-item input[type="checkbox"]': { mr: 0.8, verticalAlign: '-0.1em' },
              '& h1, & h2, & h3, & h4, & h5, & h6': {
                mt: 2.2,
                mb: 0.9,
                lineHeight: 1.3,
                scrollMarginTop: 12,
                fontWeight: 700,
                letterSpacing: '-0.01em',
              },
              '& h1': { fontSize: '1.7rem', pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' },
              '& h2': { fontSize: '1.4rem', pb: 0.4, borderBottom: '1px solid', borderColor: 'divider' },
              '& h3': { fontSize: '1.2rem' },
              '& h4': { fontSize: '1.05rem' },
              '& h5': { fontSize: '0.95rem' },
              '& h6': { fontSize: '0.9rem', color: 'text.secondary' },
              '& pre': {
                p: 1.5,
                pr: 5,
                my: 1.2,
                borderRadius: '8px',
                overflowX: 'auto',
                bgcolor: isDark ? alpha('#0d1117', 0.9) : '#f6f8fa',
                border: '1px solid',
                borderColor: 'divider',
                fontSize: '0.84rem',
                lineHeight: 1.55,
              },
              '& pre code': {
                p: 0,
                bgcolor: 'transparent',
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace',
              },
              '& code': {
                px: 0.5,
                py: 0.15,
                borderRadius: '5px',
                bgcolor: alpha(theme.palette.text.primary, isDark ? 0.12 : 0.07),
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace',
                fontSize: '0.85em',
              },
              '& table': {
                borderCollapse: 'collapse',
                width: '100%',
                my: 0,
                fontSize: '0.88rem',
              },
              '& th, & td': {
                border: '1px solid',
                borderColor: 'divider',
                px: 1.2,
                py: 0.7,
                textAlign: 'left',
                verticalAlign: 'top',
              },
              '& th': {
                fontWeight: 800,
                bgcolor: alpha(theme.palette.text.primary, isDark ? 0.06 : 0.04),
              },
              '& blockquote': {
                m: 0,
                my: 1,
                pl: 1.6,
                py: 0.2,
                borderLeft: '4px solid',
                borderColor: 'divider',
                color: 'text.secondary',
                bgcolor: alpha(theme.palette.text.primary, isDark ? 0.04 : 0.025),
                borderRadius: '0 8px 8px 0',
              },
              '& hr': {
                border: 'none',
                borderTop: '2px solid',
                borderColor: 'divider',
                my: 2.5,
              },
              '& a': {
                color: 'primary.main',
                textDecoration: 'underline',
                textUnderlineOffset: '0.15em',
                wordBreak: 'break-word',
                '&:hover': { opacity: 0.85 },
              },
              '& img': {
                maxWidth: '100%',
                height: 'auto',
                borderRadius: '8px',
              },
              '& del': { opacity: 0.75 },
              ...hljsSx(isDark),
            }}
          >
            <ReactMarkdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
              components={components}
              urlTransform={safeMarkdownUrlTransform}
            >
              {value}
            </ReactMarkdown>
          </Box>
        )}
        {mode === 'preview' ? tocAside : null}
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
        <Typography variant="caption" color="text.secondary">MARKDOWN</Typography>
        <Typography variant="caption" color="text.secondary">
          {lineCount.toLocaleString('ru-RU')} строк
        </Typography>
        {encoding ? (
          <Typography variant="caption" color="text.secondary">{encoding}</Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" color="text.secondary">Только чтение</Typography>
      </Stack>
    </Box>
  );
}
