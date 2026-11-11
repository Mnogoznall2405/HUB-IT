import { Box, Skeleton, Stack } from '@mui/material';

export default function TasksViewModeSkeleton({ cards = 4, cardHeight = 118 } = {}) {
  return (
    <Box data-testid="tasks-view-mode-skeleton" sx={{ p: { xs: 0.5, md: 1 } }}>
      <Stack spacing={1}>
        {Array.from({ length: cards }, (_, index) => (
          <Skeleton
            key={index}
            variant="rounded"
            height={cardHeight}
            sx={{ borderRadius: '14px' }}
          />
        ))}
      </Stack>
    </Box>
  );
}
