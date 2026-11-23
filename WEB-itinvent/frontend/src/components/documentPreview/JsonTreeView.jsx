import { memo, useState } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';

const primitiveSx = (theme) => ({
  string: { color: theme.palette.mode === 'dark' ? '#98c379' : '#22863a' },
  number: { color: theme.palette.mode === 'dark' ? '#d19a66' : '#005cc5' },
  boolean: { color: theme.palette.mode === 'dark' ? '#56b6c2' : '#d73a49' },
  null: { color: theme.palette.mode === 'dark' ? '#c678dd' : '#6f42c1' },
});

const primitiveType = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const primitiveLabel = (value) => {
  if (value === null) return 'null';
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
};

function JsonNode({ name, value, depth, defaultDepth, colors }) {
  const [open, setOpen] = useState(depth < defaultDepth);
  const type = primitiveType(value);
  const isExpandable = type === 'object' || type === 'array';

  if (!isExpandable) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'baseline', pl: `${depth * 16 + 22}px`, py: '1px', minWidth: 0 }}>
        {name !== undefined ? (
          <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.84rem', color: 'text.secondary', mr: 0.75, flexShrink: 0 }}>
            {JSON.stringify(name)}:
          </Typography>
        ) : null}
        <Typography
          component="span"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.84rem',
            color: colors[type]?.color || 'text.primary',
            overflowWrap: 'anywhere',
            whiteSpace: 'pre-wrap',
          }}
        >
          {primitiveLabel(value)}
        </Typography>
      </Box>
    );
  }

  const entries = type === 'array'
    ? value.map((item, index) => [index, item])
    : Object.entries(value);
  const summary = type === 'array' ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          pl: `${depth * 16}px`,
          py: '1px',
          cursor: 'pointer',
          borderRadius: '4px',
          '&:hover': { bgcolor: (theme) => alpha(theme.palette.text.primary, 0.05) },
        }}
        onClick={() => setOpen((current) => !current)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((current) => !current);
          }
        }}
        aria-expanded={open}
      >
        <IconButton size="small" aria-label={open ? 'Свернуть' : 'Развернуть'} sx={{ width: 18, height: 18, mr: 0.25, p: 0 }}>
          {open
            ? <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
            : <KeyboardArrowRightRoundedIcon sx={{ fontSize: 16 }} />}
        </IconButton>
        {name !== undefined ? (
          <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.84rem', color: 'text.secondary', mr: 0.75 }}>
            {JSON.stringify(name)}:
          </Typography>
        ) : null}
        <Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.84rem', color: 'text.secondary' }}>
          {open ? (type === 'array' ? '[' : '{') : summary}
        </Typography>
      </Box>
      {open ? (
        <Box>
          {entries.map(([key, item]) => (
            <JsonNode key={key} name={key} value={item} depth={depth + 1} defaultDepth={defaultDepth} colors={colors} />
          ))}
          <Typography
            component="div"
            sx={{ pl: `${depth * 16 + 22}px`, fontFamily: 'monospace', fontSize: '0.84rem', color: 'text.secondary' }}
          >
            {type === 'array' ? ']' : '}'}
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
}

function JsonTreeView({ data, defaultDepth = 1 }) {
  const theme = useTheme();
  const colors = primitiveSx(theme);
  return (
    <Box data-testid="json-tree-view" sx={{ fontFamily: 'monospace' }}>
      <JsonNode value={data} depth={0} defaultDepth={defaultDepth} colors={colors} />
    </Box>
  );
}

export default memo(JsonTreeView);
