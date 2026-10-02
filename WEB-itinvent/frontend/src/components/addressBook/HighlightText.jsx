import { Fragment, memo, useMemo } from 'react';
import { Box } from '@mui/material';
import { escapeRegExp, normalizeText } from './addressBookUtils';

// A22: the split/match expression is shared by every row for the same query —
// cache it so typing a character rebuilds it once instead of per row.
const expressionCache = new Map();
const EXPRESSION_CACHE_LIMIT = 8;

const buildTerms = (query) => (
  normalizeText(query)
    .split(/\s+/)
    .map(escapeRegExp)
    .filter(Boolean)
);

const getExpression = (query) => {
  const key = normalizeText(query);
  let entry = expressionCache.get(key);
  if (!entry) {
    const terms = buildTerms(query);
    entry = {
      terms,
      expression: terms.length ? new RegExp(`(${terms.join('|')})`, 'ig') : null,
      exact: terms.length ? new RegExp(`^(${terms.join('|')})$`, 'i') : null,
    };
    if (expressionCache.size >= EXPRESSION_CACHE_LIMIT) {
      expressionCache.clear();
    }
    expressionCache.set(key, entry);
  }
  return entry;
};

function HighlightText({ value, query }) {
  const text = normalizeText(value);
  const { terms, expression, exact } = useMemo(
    () => getExpression(query),
    [query],
  );
  if (!text || terms.length === 0 || !expression) return text;

  const parts = text.split(expression).filter((part) => part !== '');
  return (
    <>
      {parts.map((part, index) => (
        exact.test(part) ? (
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

export default memo(HighlightText);
