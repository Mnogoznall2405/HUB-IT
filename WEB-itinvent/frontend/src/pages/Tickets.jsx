import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Tab, Tabs, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import RefreshIcon from '@mui/icons-material/Refresh';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import TicketDashboard from '../components/tickets/TicketDashboard';
import TicketEmployeeCard from '../components/tickets/TicketEmployeeCard';
import TicketFinancialOps from '../components/tickets/TicketFinancialOps';
import TicketImportWizard from '../components/tickets/TicketImportWizard';
import TicketKanban from '../components/tickets/TicketKanban';
import TicketLossReport from '../components/tickets/TicketLossReport';
import TicketNotifications from '../components/tickets/TicketNotifications';
import TicketObjectManager from '../components/tickets/TicketObjectManager';
import TicketRequestCard from '../components/tickets/TicketRequestCard';
import TicketRequestCreateDialog from '../components/tickets/TicketRequestCreateDialog';
import TicketRequestList from '../components/tickets/TicketRequestList';
import { useAuth } from '../contexts/AuthContext';
import { ticketsAPI } from '../api/tickets';
import { getErrorMessage } from '../components/tickets/ticketUi';

const TAB_KEYS = ['list', 'kanban', 'dashboard', 'reports', 'import', 'manage', 'rules'];

export default function Tickets() {
  const { user, hasPermission } = useAuth();
  const [tab, setTab] = useState(0);
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [objects, setObjects] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const canWrite = hasPermission('tickets.write');
  const isAdmin = String(user?.role || '').trim().toLowerCase() === 'admin';

  const loadObjects = useCallback(async () => {
    setError('');
    try {
      const data = await ticketsAPI.listObjects({ include_inactive: true });
      setObjects(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadObjects();
  }, [loadObjects, refreshKey]);

  const activeObjects = useMemo(() => objects.filter((item) => item.is_active !== false), [objects]);

  const requestChanged = () => setRefreshKey((value) => value + 1);

  const handleCreated = (request) => {
    setCreateOpen(false);
    setSelectedRequestId(request?.id || null);
    setTab(0);
    requestChanged();
  };

  return (
    <MainLayout>
      <PageShell>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
            <Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <ConfirmationNumberIcon color="primary" />
                <Typography variant="h4" sx={{ fontWeight: 700 }}>Билеты / Логистика</Typography>
              </Stack>
              <Typography color="text.secondary">Заявки, билеты, потери, импорт и SLA по объектам</Typography>
            </Box>
            <Stack direction="row" spacing={1} justifyContent={{ xs: 'stretch', md: 'flex-end' }}>
              {canWrite ? (
                <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
                  Создать заявку
                </Button>
              ) : null}
              <Button startIcon={<RefreshIcon />} onClick={requestChanged}>Обновить</Button>
            </Stack>
          </Stack>

          {error ? <Alert severity="error">{error}</Alert> : null}
          <TicketNotifications canWrite={canWrite} isAdmin={isAdmin} showPending showRules={false} />

          <Paper sx={{ borderRadius: 1, overflow: 'visible' }}>
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            >
              <Tab label="Список" />
              <Tab label="Канбан" />
              <Tab label="Дашборд" />
              <Tab label="Отчёты" />
              <Tab label="Импорт" />
              <Tab label="Справочники" />
              <Tab label="Правила SLA" />
            </Tabs>
            <Box sx={{ p: 2 }}>
              {TAB_KEYS[tab] === 'list' ? (
                <Stack spacing={2}>
                  <TicketRequestList
                    key={`list-${refreshKey}`}
                    objects={activeObjects}
                    canWrite={canWrite}
                    onSelectRequest={setSelectedRequestId}
                  />
                  <TicketRequestCard
                    requestId={selectedRequestId}
                    canWrite={canWrite}
                    onChanged={requestChanged}
                  />
                </Stack>
              ) : null}
              {TAB_KEYS[tab] === 'kanban' ? (
                <Stack spacing={2}>
                  <TicketKanban
                    key={`kanban-${refreshKey}`}
                    objects={activeObjects}
                    canWrite={canWrite}
                    onSelectRequest={(id) => {
                      setSelectedRequestId(id);
                      setTab(0);
                    }}
                    onChanged={requestChanged}
                  />
                </Stack>
              ) : null}
              {TAB_KEYS[tab] === 'dashboard' ? (
                <TicketDashboard
                  key={`dashboard-${refreshKey}`}
                  onFilterObject={() => setTab(0)}
                />
              ) : null}
              {TAB_KEYS[tab] === 'reports' ? (
                <Stack spacing={3}>
                  <TicketLossReport objects={activeObjects} canWrite={canWrite} />
                  <TicketFinancialOps objects={activeObjects} canWrite={canWrite} />
                </Stack>
              ) : null}
              {TAB_KEYS[tab] === 'import' ? (
                <TicketImportWizard objects={activeObjects} canWrite={canWrite} />
              ) : null}
              {TAB_KEYS[tab] === 'manage' ? (
                <Stack spacing={3}>
                  <TicketObjectManager
                    objects={objects}
                    canWrite={canWrite}
                    isAdmin={isAdmin}
                    onChanged={loadObjects}
                  />
                  <TicketEmployeeCard canWrite={canWrite} />
                </Stack>
              ) : null}
              {TAB_KEYS[tab] === 'rules' ? (
                <TicketNotifications canWrite={canWrite} isAdmin={isAdmin} showPending={false} showRules />
              ) : null}
            </Box>
          </Paper>
        </Stack>
        <TicketRequestCreateDialog
          open={createOpen}
          objects={activeObjects}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      </PageShell>
    </MainLayout>
  );
}
