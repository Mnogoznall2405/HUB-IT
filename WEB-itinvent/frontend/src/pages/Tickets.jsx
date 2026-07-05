import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BusinessIcon from '@mui/icons-material/Business';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import RefreshIcon from '@mui/icons-material/Refresh';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import TicketEmployeeCard from '../components/tickets/TicketEmployeeCard';
import TicketObjectManager from '../components/tickets/TicketObjectManager';
import TicketRequestCard from '../components/tickets/TicketRequestCard';
import TicketRequestCreateDialog from '../components/tickets/TicketRequestCreateDialog';
import TicketRequestList from '../components/tickets/TicketRequestList';
import { useAuth } from '../contexts/AuthContext';
import { ticketsAPI } from '../api/tickets';
import { getErrorMessage } from '../components/tickets/ticketUi';

export default function Tickets() {
  const { user, hasPermission } = useAuth();
  const [selectedRequestId, setSelectedRequestId] = useState(null);
  const [objects, setObjects] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [employeeOpen, setEmployeeOpen] = useState(false);
  const [objectsOpen, setObjectsOpen] = useState(false);

  const canWrite = hasPermission('tickets.write');
  const canReadPersonal = hasPermission('tickets.personal_data.read');
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
                <Typography variant="h4" sx={{ fontWeight: 700 }}>Билеты</Typography>
              </Stack>
              <Typography color="text.secondary">Список заявок, сотрудники и справочник объектов</Typography>
            </Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent={{ xs: 'stretch', md: 'flex-end' }}>
              {canWrite ? (
                <>
                  <Button startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
                    Создать заявку
                  </Button>
                  <Button startIcon={<PersonAddIcon />} variant="outlined" onClick={() => setEmployeeOpen(true)}>
                    Добавить сотрудника
                  </Button>
                  <Button startIcon={<BusinessIcon />} variant="outlined" onClick={() => setObjectsOpen(true)}>
                    Справочник объектов
                  </Button>
                </>
              ) : null}
              <Button startIcon={<RefreshIcon />} onClick={requestChanged}>Обновить</Button>
            </Stack>
          </Stack>

          {error ? <Alert severity="error">{error}</Alert> : null}

          <TicketRequestList
            key={`list-${refreshKey}`}
            objects={activeObjects}
            canWrite={canWrite}
            onSelectRequest={setSelectedRequestId}
          />

          <TicketRequestCard
            requestId={selectedRequestId}
            canWrite={canWrite}
            onClose={() => setSelectedRequestId(null)}
            onChanged={requestChanged}
          />
        </Stack>

        <TicketRequestCreateDialog
          open={createOpen}
          objects={activeObjects}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />

        <TicketEmployeeCard
          open={employeeOpen}
          onClose={() => setEmployeeOpen(false)}
          canWrite={canWrite}
          canReadPersonal={canReadPersonal}
          onChanged={requestChanged}
        />

        <TicketObjectManager
          open={objectsOpen}
          onClose={() => setObjectsOpen(false)}
          objects={objects}
          canWrite={canWrite}
          isAdmin={isAdmin}
          onChanged={loadObjects}
        />
      </PageShell>
    </MainLayout>
  );
}
