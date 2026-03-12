import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { buildOfficeUiTokens } from '../../theme/officeUiTokens';

function MarkdownRenderer({ value, compact = false }) {
  const theme = useTheme();
  const ui = useMemo(() => buildOfficeUiTokens(theme), [theme]);
  const text = String(value || '').trim();
  if (!text) return null;

  return (
    <Box
      sx={{
        '& p': { my: compact ? 0.5 : 1 },
        '& ul, & ol': { pl: 2.5, my: compact ? 0.5 : 1 },
        '& li': { my: 0.2 },
        '& h1, & h2, & h3, & h4': { mt: compact ? 0.8 : 1.2, mb: 0.6 },
        '& pre': {
          p: 1,
          borderRadius: 1,
          overflowX: 'auto',
          bgcolor: ui.panelBg,
          border: '1px solid',
          borderColor: ui.borderSoft,
        },
        '& code': {
          px: 0.4,
          borderRadius: 0.5,
          bgcolor: ui.actionBg,
          fontFamily: 'monospace',
        },
        '& table': { width: '100%', borderCollapse: 'collapse', my: 1 },
        '& th, & td': {
          border: '1px solid',
          borderColor: ui.borderSoft,
          px: 1,
          py: 0.5,
          textAlign: 'left',
        },
        '& blockquote': {
          m: 0,
          pl: 1.5,
          borderLeft: '3px solid',
          borderColor: ui.borderSoft,
          color: 'text.secondary',
        },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {text}
      </ReactMarkdown>
    </Box>
  );
}

export default MarkdownRenderer;
