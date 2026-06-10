import { Fragment } from 'react';
import { Box } from '@mui/material';
import { escapeRegExp, normalizeText } from './addressBookUtils';

export default function HighlightText({ value, query }) {
  const text = normalizeText(value);
  const terms = normalizeText(query)
    .split(/\s+/)
    .map(escapeRegExp)
    .filter(Boolean);
  if (!text || terms.length === 0) return text;

  const expression = new RegExp(`(${terms.join('|')})`, 'ig');
  const parts = text.split(expression).filter((part) => part !== '');
  return (
    <>
      {parts.map((part, index) => (
        terms.some((term) => new RegExp(`^${term}$`, 'i').test(part)) ? (
          <Box
            key={`${part}-${index}`}
            component="mark"
            sx={{
              px: 0.25,
              borderRadius: 0.5,
              bgcolor: 'warning.light',
              color: 'warning.contrastText',
            }}
          >
            {part}
          </Box>
        ) : (
          <Fragment key={`${part}-${index}`}>{part}</Fragment>
        )
      ))}
    </>
  );
}
