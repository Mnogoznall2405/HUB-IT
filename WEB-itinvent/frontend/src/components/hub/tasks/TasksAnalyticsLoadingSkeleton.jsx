import { Box, Grid, Skeleton, Stack } from '@mui/material';

export function TasksAnalyticsChartsSkeleton() {
  return (
    <>
      <Grid item xs={12} lg={4}>
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: '16px' }} />
      </Grid>
      <Grid item xs={12} lg={8}>
        <Skeleton variant="rounded" height={320} sx={{ borderRadius: '16px' }} />
      </Grid>
      <Grid item xs={12} lg={6}>
        <Skeleton variant="rounded" height={360} sx={{ borderRadius: '16px' }} />
      </Grid>
      <Grid item xs={12} lg={6}>
        <Skeleton variant="rounded" height={360} sx={{ borderRadius: '16px' }} />
      </Grid>
    </>
  );
}

export default function TasksAnalyticsLoadingSkeleton() {
  return (
    <Box data-testid="tasks-analytics-loading" sx={{ p: 0.5 }}>
      <Stack spacing={1.2}>
        <Skeleton variant="rounded" height={72} sx={{ borderRadius: '15px' }} />
        <Grid container spacing={1}>
          {[0, 1, 2, 3, 4, 5].map((item) => (
            <Grid item xs={6} xl={2} key={item}>
              <Skeleton variant="rounded" height={88} sx={{ borderRadius: '12px' }} />
            </Grid>
          ))}
        </Grid>
        <Grid container spacing={1.2}>
          <TasksAnalyticsChartsSkeleton />
        </Grid>
      </Stack>
    </Box>
  );
}
