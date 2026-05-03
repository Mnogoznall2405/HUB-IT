import { useCallback, useEffect, useMemo, useState } from 'react';

import { databaseAPI } from '../../api/database';
import { normalizeDbId } from './databaseRecordModel';

export function useDatabaseSelection({ notifyDatabaseError } = {}) {
  const [dbName, setDbName] = useState('');
  const [databases, setDatabases] = useState([]);
  const [currentDb, setCurrentDb] = useState(null);

  const loadDbName = useCallback(async ({ isMounted = () => true } = {}) => {
    let dbId = normalizeDbId(localStorage.getItem('selected_database'));
    try {
      const data = await databaseAPI.getCurrentDatabase();
      const currentDbId = normalizeDbId(data?.id || data?.database_id || '');
      if (currentDbId) {
        dbId = currentDbId;
        if (isMounted()) {
          setCurrentDb({
            id: currentDbId,
            name: data?.name || data?.database || data?.database_name || '',
          });
        }
      }
    } catch (error) {
      console.error('Error loading db:', error);
    }

    if (dbId) {
      localStorage.setItem('selected_database', dbId);
    }

    if (isMounted()) {
      setDbName(dbId);
    }
  }, []);

  const loadDatabases = useCallback(async ({ isMounted = () => true } = {}) => {
    try {
      const data = await databaseAPI.getAvailableDatabases();
      if (isMounted()) {
        setDatabases(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading databases:', error);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const isMounted = () => mounted;

    void loadDbName({ isMounted });
    void loadDatabases({ isMounted });

    const handleDatabaseChanged = () => {
      if (!mounted) return;
      setDbName(normalizeDbId(localStorage.getItem('selected_database') || ''));
      void loadDbName({ isMounted });
    };

    window.addEventListener('database-changed', handleDatabaseChanged);

    return () => {
      mounted = false;
      window.removeEventListener('database-changed', handleDatabaseChanged);
    };
  }, [loadDatabases, loadDbName]);

  const selectedDatabaseName = useMemo(() => {
    const selectedDbId = normalizeDbId(dbName || currentDb?.id || '');
    const selectedDb = databases.find((db) => normalizeDbId(db.id) === selectedDbId);
    const name = String(selectedDb?.name || currentDb?.name || '').trim();
    return name || 'База';
  }, [currentDb?.id, currentDb?.name, databases, dbName]);

  const handleDatabaseSelectChange = useCallback(async (event) => {
    const newDbId = normalizeDbId(event.target.value);
    const selectedDb = databases.find((db) => normalizeDbId(db.id) === newDbId);
    const previousDbId = normalizeDbId(dbName || currentDb?.id || localStorage.getItem('selected_database') || '');
    if (!newDbId || newDbId === previousDbId) return;

    try {
      const result = await databaseAPI.switchDatabase(newDbId);
      const selectedId = normalizeDbId(result?.database?.id || selectedDb?.id || newDbId);
      setDbName(selectedId);
      setCurrentDb({
        id: selectedId,
        name: selectedDb?.name || result?.database?.name || '',
      });
      localStorage.setItem('selected_database', selectedId);
      window.dispatchEvent(new CustomEvent('database-changed', { detail: { databaseId: selectedId } }));
    } catch (error) {
      console.error('Error switching database:', error);
      notifyDatabaseError?.(error?.response?.data?.detail || 'Ошибка при переключении базы данных.');
      setDbName(previousDbId);
    }
  }, [currentDb?.id, databases, dbName, notifyDatabaseError]);

  return {
    dbName,
    databases,
    currentDb,
    selectedDatabaseName,
    handleDatabaseSelectChange,
  };
}

export default useDatabaseSelection;
