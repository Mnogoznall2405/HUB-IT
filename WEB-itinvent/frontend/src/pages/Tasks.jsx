import {
  Alert,
  Box,
  IconButton,
  LinearProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import TasksMobileNavigationContainer from '../components/hub/tasks/containers/TasksMobileNavigationContainer';
import { getAppShellMobileFabBottomOffset } from '../theme/officeUiTokens';
import useTasksPageController from './tasks/useTasksPageController';
import { TasksPageProvider, useTasksCreateSlice, useTasksDetailSlice, useTasksFiltersSlice, useTasksListSlice, useTasksUiSlice } from './tasks/TasksPageContext';
import TasksListLayout from './tasks/TasksListLayout';
import TasksDetailPanel from './tasks/TasksDetailPanel';
import TasksDialogsLayer from './tasks/TasksDialogsLayer';

function TasksPageContent() {
  const ui = useTasksUiSlice();
  const list = useTasksListSlice();
  const detail = useTasksDetailSlice();
  const filters = useTasksFiltersSlice();
  const create = useTasksCreateSlice();

  return (
    <MainLayout
      mobileBottomNavMode={ui.isMobile && (detail.detailsOpen || create.createOpen) ? 'hidden' : 'auto'}
      contentMode={ui.isMobile ? 'edge-to-edge-mobile' : 'default'}
    >
      <PageShell fullHeight sx={{ bgcolor: ui.ui.pageBg }}>
        <Box
          sx={{
            px: { xs: 0, md: 1.25 },
            py: { xs: 0, md: 1 },
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
            boxSizing: 'border-box',
          }}
        >
          {list.loading && <LinearProgress sx={{ mb: 1.2, borderRadius: 999 }} />}
          {list.error ? (
            <Alert severity="error" sx={{ mb: 1.2, borderRadius: '12px' }} onClose={() => list.setError('')}>
              {list.error}
            </Alert>
          ) : null}

          {detail.detailsOpen ? <TasksDetailPanel /> : <TasksListLayout />}
        </Box>

        {filters.mobileNavigationDrawerProps ? (
          <TasksMobileNavigationContainer {...filters.mobileNavigationDrawerProps} />
        ) : null}

        <TasksDialogsLayer />

        {ui.isMobile && filters.canCreateTasks && !detail.detailsOpen && !create.createOpen ? (
          <IconButton
            data-testid="tasks-create-fab"
            aria-label="Создать задачу"
            onClick={() => create.setCreateOpen(true)}
            sx={{
              position: 'fixed',
              right: 16,
              bottom: getAppShellMobileFabBottomOffset(),
              width: 58,
              height: 58,
              borderRadius: '999px',
              bgcolor: ui.theme.palette.primary.main,
              color: ui.theme.palette.primary.contrastText,
              boxShadow: '0 18px 40px rgba(37, 99, 235, 0.28)',
              zIndex: 14,
              '&:hover': { bgcolor: ui.theme.palette.primary.dark },
            }}
          >
            <AddIcon sx={{ fontSize: 28 }} />
          </IconButton>
        ) : null}
      </PageShell>
    </MainLayout>
  );
}

function Tasks() {
  const controller = useTasksPageController();
  return (
    <TasksPageProvider controller={controller}>
      <TasksPageContent />
    </TasksPageProvider>
  );
}

export default Tasks;
