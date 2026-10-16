import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Stack } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import BusinessIcon from '@mui/icons-material/Business';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import MainLayout from '../components/layout/MainLayout';
import PageShell from '../components/layout/PageShell';
import PageTopBar from '../components/layout/PageTopBar';
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
    <MainLayout headerMode="integrated">
      <PageShell>
        <Stack spacing={2}>
          <PageTopBar
            title="Билеты"
            actions={canWrite ? (
              <>
                <Button size="small" startIcon={<AddIcon />} variant="contained" onClick={() => setCreateOpen(true)}>
                  Создать заявку
                </Button>
                <Button size="small" startIcon={<PersonAddIcon />} variant="outlined" onClick={() => setEmployeeOpen(true)}>
                  Сотрудники
                </Button>
                <Button size="small" startIcon={<BusinessIcon />} variant="outlined" onClick={() => setObjectsOpen(true)}>
                  Справочник объектов
                </Button>
              </>
            ) : null}
          />

          {error ? <Alert severity="error">{error}</Alert> : null}

          <TicketRequestList
            key={`list-${refreshKey}`}
            objects={activeObjects}
            canWrite={canWrite}
            onSelectRequest={setSelectedRequestId}
            onRefreshObjects={loadObjects}
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
