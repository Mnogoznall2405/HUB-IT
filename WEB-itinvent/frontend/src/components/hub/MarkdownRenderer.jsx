import { Box } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

function MarkdownRenderer({ value, compact = false, variant = 'default' }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const text = String(value || '').trim();
  const isChat = String(variant || '').trim() === 'chat';
  const showCompactFade = compact && text.length > 180;
  if (!text) return null;

  const markdownComponents = isChat ? {
    table({ node: _node, ...props }) {
      void _node;
      return (
        <Box
          data-testid="markdown-table-scroll"
          sx={{
            position: 'relative',
            maxWidth: '100%',
            my: 0.8,
            overflowX: 'auto',
            overflowY: 'hidden',
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorX: 'contain',
            scrollbarWidth: 'thin',
            borderRadius: '12px',
            border: '1px solid',
            borderColor: alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.14 : 0.22),
            bgcolor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.12 : 0.04),
            '&::after': {
              content: '""',
              position: 'sticky',
              right: 0,
              top: 0,
              display: 'block',
              float: 'right',
              width: 22,
              height: '100%',
              minHeight: 42,
              mt: '-100%',
              pointerEvents: 'none',
              background: `linear-gradient(90deg, ${alpha(theme.palette.background.paper, 0)} 0%, ${alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.18 : 0.26)} 100%)`,
            },
          }}
        >
          <Box component="table" {...props} />
        </Box>
      );
    },
  } : undefined;

  return (
    <Box
      data-markdown-variant={isChat ? 'chat' : undefined}
      sx={{
        position: 'relative',
        color: isChat ? 'inherit' : compact ? ui.mutedText : 'text.primary',
        fontSize: isChat ? '1em' : compact ? '0.84rem' : '0.95rem',
        lineHeight: isChat ? 1.38 : compact ? 1.55 : 1.68,
        overflowWrap: isChat ? 'break-word' : 'anywhere',
        maxHeight: compact ? 188 : 'none',
        overflow: compact ? 'hidden' : 'visible',
        pr: compact ? 0.25 : 0,
        '& > *:first-of-type': { mt: 0 },
        '& > *:last-child': { mb: 0 },
        '& p': { my: isChat ? 0.55 : compact ? 0.4 : 1 },
        '& ul, & ol': { pl: compact ? 2.2 : 2.5, my: isChat ? 0.55 : compact ? 0.45 : 1 },
        '& li': { my: compact ? 0.12 : 0.2 },
        '& h1, & h2, & h3, & h4': {
          mt: isChat ? 0.75 : compact ? 0.65 : 1.2,
          mb: isChat ? 0.45 : compact ? 0.35 : 0.6,
          lineHeight: compact ? 1.25 : 1.3,
        },
        '& h1': { fontSize: isChat ? '1.18em' : compact ? '1rem' : '1.4rem' },
        '& h2': { fontSize: isChat ? '1.1em' : compact ? '0.95rem' : '1.2rem' },
        '& h3': { fontSize: isChat ? '1.04em' : compact ? '0.9rem' : '1.05rem' },
        '& h4': { fontSize: isChat ? '1em' : compact ? '0.86rem' : '1rem' },
        '& pre': {
          p: compact ? 0.8 : 1,
          borderRadius: compact ? '10px' : 1,
          overflowX: 'auto',
          bgcolor: ui.panelBg,
          border: '1px solid',
          borderColor: ui.borderSoft,
          fontSize: compact ? '0.74rem' : '0.85rem',
        },
        '& code': {
          px: compact ? 0.3 : 0.4,
          py: compact ? 0.05 : 0,
          borderRadius: 0.5,
          bgcolor: ui.actionBg,
          fontFamily: 'monospace',
          fontSize: compact ? '0.78rem' : '0.84rem',
        },
        '& pre code': {
          px: 0,
          py: 0,
          bgcolor: 'transparent',
        },
        '& table': {
          width: isChat ? 'max-content' : '100%',
          minWidth: isChat ? 'max(560px, 100%)' : undefined,
          maxWidth: isChat ? 'none' : undefined,
          borderCollapse: 'collapse',
          my: isChat ? 0 : compact ? 0.7 : 1,
          fontSize: isChat ? '0.88em' : compact ? '0.78rem' : '0.9rem',
        },
        '& th, & td': {
          border: '1px solid',
          borderColor: isChat ? alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.16 : 0.28) : ui.borderSoft,
          px: isChat ? 1 : compact ? 0.7 : 1,
          py: isChat ? 0.65 : compact ? 0.35 : 0.5,
          textAlign: 'left',
          verticalAlign: 'top',
          whiteSpace: 'normal',
          wordBreak: 'normal',
          overflowWrap: 'break-word',
          minWidth: isChat ? 112 : undefined,
        },
        '& th': {
          fontWeight: 800,
          bgcolor: isChat ? alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.08 : 0.18) : undefined,
        },
        '& blockquote': {
          m: 0,
          pl: compact ? 1.1 : 1.5,
          borderLeft: '3px solid',
          borderColor: ui.borderSoft,
          color: ui.mutedText,
        },
        ...(showCompactFade ? {
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 'auto 0 0 0',
            height: 34,
            pointerEvents: 'none',
            background: `linear-gradient(180deg, ${alpha(ui.panelSolid, 0)} 0%, ${alpha(ui.panelSolid, 0.86)} 72%, ${ui.panelSolid} 100%)`,
          },
        } : {}),
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </Box>
  );
}

export default MarkdownRenderer;
