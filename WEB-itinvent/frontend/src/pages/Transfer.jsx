import { Box, Typography } from '@mui/material';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';

function Transfer() {
  return (
    <MainLayout>
      <PageShell>
        <Box>
          <Typography variant="h4" gutterBottom>
            Перемещение оборудования
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Страница в разработке.
          </Typography>
        </Box>
      </PageShell>
    </MainLayout>
  );
}

export default Transfer;
