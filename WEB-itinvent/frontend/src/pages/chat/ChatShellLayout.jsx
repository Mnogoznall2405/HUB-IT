import MainLayout from '../../components/layout/MainLayout';
import PageShell from '../../components/layout/PageShell';

export default function ChatShellLayout({
  children,
  headerMode = 'default',
  mobileBottomNavMode = 'auto',
  mobileBottomNavTransitionMs,
  contentMode = 'default',
  pageShellSx,
}) {
  return (
    <MainLayout
      headerMode={headerMode}
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
