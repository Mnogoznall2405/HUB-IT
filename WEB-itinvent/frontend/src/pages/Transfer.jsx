import { Box, Typography } from '@mui/material';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';

function Transfer() {
  return (
    <MainLayout headerMode="integrated">
      <PageShell>
        <Box>
          <PageTopBar title="Перемещение оборудования" />
          <Typography variant="body1" color="text.secondary">
            Страница в разработке.
          </Typography>
        </Box>
      </PageShell>
    </MainLayout>
  );
}

export default Transfer;
