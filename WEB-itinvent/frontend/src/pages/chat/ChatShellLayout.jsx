import { Box } from '@mui/material';
import MainLayout from '../../components/layout/MainLayout';
import PageShell from '../../components/layout/PageShell';

export default function ChatShellLayout({
  children,
  headerMode = 'default',
  pageTitle,
  mobileBottomNavMode = 'auto',
  mobileBottomNavTransitionMs,
  contentMode = 'default',
  pageShellSx,
  embedded = false,
}) {
  if (embedded) {
    return (
      <Box
        data-testid="chat-embedded-surface"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          ...pageShellSx,
        }}
      >
        {children}
      </Box>
    );
  }
  return (
    <MainLayout
      headerMode={headerMode}
      pageTitle={pageTitle}
      mobileBottomNavMode={mobileBottomNavMode}
      mobileBottomNavTransitionMs={mobileBottomNavTransitionMs}
      contentMode={contentMode}
    >
      <PageShell fullHeight sx={pageShellSx}>
        {children}
      </PageShell>
    </MainLayout>
  );
}
