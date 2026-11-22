import { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress } from '@mui/material';
import { loadDocsApi } from '../myFiles/useMyFilesEditorSession';

let officeViewSeq = 0;

/**
 * Compact read-only document surface: mounts the ONLYOFFICE DocEditor in
 * view mode (embedded/Common Viewer) from a server-issued viewer config.
 */
export default function OfficeViewFrame({ config, publicPath, onError }) {
  const hostRef = useRef(null);
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const fatalNotified = useRef(false);
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const notifyFatal = (message) => {
    setPhase('error');
    setError(message);
    if (!fatalNotified.current) {
      fatalNotified.current = true;
      errorRef.current?.(message);
    }
  };

  useEffect(() => {
    if (!config || !publicPath) {
      setPhase('error');
      setError('Нет конфигурации просмотра.');
      return undefined;
    }
    let disposed = false;
    let editor = null;
    setPhase('loading');
    setError('');
    const target = document.createElement('div');
    target.id = `office-view-${++officeViewSeq}`;
    hostRef.current?.replaceChildren(target);

    loadDocsApi(publicPath)
      .then(() => {
        if (disposed || !hostRef.current) return;
        editor = new window.DocsAPI.DocEditor(target.id, {
          ...config,
          width: '100%',
          height: '100%',
          events: {
            onDocumentReady: () => {
              if (!disposed) setPhase('ready');
            },
            onError: () => {
              if (!disposed) {
                notifyFatal('Не удалось открыть документ в просмотрщике.');
              }
            },
          },
        });
      })
      .catch(() => {
        if (!disposed) {
          notifyFatal('Сервер редактора документов недоступен');
        }
      });

    return () => {
      disposed = true;
      try {
        editor?.destroyEditor?.();
      } catch {
        // The SDK may already have torn down the frame.
      }
      editor = null;
    };
  }, [config, publicPath]);

  return (
    <Box
      sx={{
        minHeight: 0,
        flex: 1,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {phase === 'loading' ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1,
          }}
        >
          <CircularProgress size={36} />
        </Box>
      ) : null}
      {error ? (
        <Alert severity="warning" sx={{ m: { xs: 1.25, sm: 2 }, position: 'relative', zIndex: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Box
        ref={hostRef}
        sx={{
          flex: 1,
          minHeight: 0,
          opacity: phase === 'ready' ? 1 : 0.001,
          '& iframe': { border: 0 },
        }}
      />
    </Box>
  );
}
