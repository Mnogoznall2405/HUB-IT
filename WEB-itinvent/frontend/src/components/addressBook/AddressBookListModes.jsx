import { Button, Stack } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';

// P1/P2/P3: favorites and recents are list modes now, not a chip strip.
// The row renders nothing when both code sets are empty (zero height).
export default function AddressBookListModes({
  mode = 'all',
  favoritesCount = 0,
  recentsCount = 0,
  onChange,
  onClearRecent,
}) {
  if (favoritesCount <= 0 && recentsCount <= 0) return null;

  const segments = [
    { key: 'all', label: 'Все', testId: 'address-book-mode-all' },
    ...(favoritesCount > 0 ? [{
      key: 'favorites',
      label: `Избранные (${favoritesCount})`,
      testId: 'address-book-mode-favorites',
      icon: <StarIcon sx={{ fontSize: 15 }} />,
    }] : []),
    ...(recentsCount > 0 ? [{
      key: 'recent',
      label: `Недавние (${recentsCount})`,
      testId: 'address-book-mode-recent',
    }] : []),
  ];

  return (
    <Stack
      direction="row"
      spacing={0.5}
      useFlexGap
      flexWrap="wrap"
      alignItems="center"
      role="group"
      aria-label="Показать"
      sx={{ flexShrink: 0 }}
      data-testid="address-book-list-modes"
    >
      {segments.map((segment) => {
        const active = mode === segment.key;
        return (
          <Button
            key={segment.key}
            size="small"
            variant={active ? 'contained' : 'outlined'}
            color={active ? 'primary' : 'inherit'}
            startIcon={segment.icon || null}
            aria-pressed={active}
            onClick={() => onChange?.(segment.key)}
            data-testid={segment.testId}
            sx={{
              minHeight: { xs: 44, sm: 36 },
              '@media (pointer: coarse)': { minHeight: 44 },
              // Density tokens shrink small buttons to 28px on desktop; the
              // mode switcher is a navigation control and keeps 36px.
              '&.MuiButton-sizeSmall': {
                minHeight: { xs: 44, sm: 36 },
                '@media (pointer: coarse)': { minHeight: 44 },
              },
              px: 1.25,
              textTransform: 'none',
              fontSize: '0.8125rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {segment.label}
          </Button>
        );
      })}
      {mode === 'recent' ? (
        <Button
          size="small"
          onClick={onClearRecent}
          sx={{
            ml: 'auto',
            minHeight: { xs: 44, sm: 32 },
            '@media (pointer: coarse)': { minHeight: 44 },
            '&.MuiButton-sizeSmall': {
              minHeight: { xs: 44, sm: 32 },
              '@media (pointer: coarse)': { minHeight: 44 },
            },
            textTransform: 'none',
            fontSize: '0.75rem',
          }}
          data-testid="address-book-clear-recent"
        >
          Очистить недавние
        </Button>
      ) : null}
    </Stack>
  );
}
