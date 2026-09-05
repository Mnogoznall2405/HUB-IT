import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import {
  CaptureUpdateAction,
  Excalidraw,
  getSceneVersion,
  reconcileElements,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

import hubTaskCanvasAPI from '../../../api/hubTaskCanvas';
import { createTaskCanvasSocket } from '../../../lib/taskCanvasSocket';

const AUTOSAVE_DELAY_MS = 700;
const MAX_SAVE_ATTEMPTS = 5;
const SAVE_CONFLICT_RETRY_DELAY_MS = 1_500;
const REALTIME_SCENE_DELAY_MS = 100;
const REALTIME_SCENE_MAX_DELAY_MS = 1_500;
const REALTIME_SCENE_BYTES_PER_SECOND = 24 * 64 * 1024;
const CURSOR_BROADCAST_INTERVAL_MS = 60;
const PERSISTED_APP_STATE_KEYS = [
  'viewBackgroundColor',
  'gridSize',
  'gridStep',
  'gridModeEnabled',
  'zenModeEnabled',
];

function durableAppState(appState) {
  const result = {};
  PERSISTED_APP_STATE_KEYS.forEach((key) => {
    if (appState?.[key] !== undefined) result[key] = appState[key];
  });
  return result;
}

function durableScene(elements, appState, files) {
  return {
    elements: Array.from(elements || []),
    appState: durableAppState(appState),
    files: files && typeof files === 'object' ? { ...files } : {},
  };
}

function sceneSignature(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  let version = 0;
  try {
    version = getSceneVersion(elements);
  } catch {
    version = elements.reduce((sum, item) => sum + Number(item?.version || 0), 0);
  }
  const appState = durableAppState(scene?.appState || {});
  const fileIds = Object.keys(scene?.files || {}).sort();
  const elementFingerprint = elements.map((element) => [
    String(element?.id || ''),
    Number(element?.version || 0),
    Number(element?.versionNonce || 0),
    element?.isDeleted ? 1 : 0,
  ].join(':')).join(',');
  return `${version}|${elements.length}|${elementFingerprint}|${JSON.stringify(appState)}|${fileIds.join(',')}`;
}

function realtimeSceneDelay(scene) {
  try {
    const approximateBytes = JSON.stringify(scene || {}).length;
    return Math.min(
      REALTIME_SCENE_MAX_DELAY_MS,
      Math.max(REALTIME_SCENE_DELAY_MS, Math.ceil(
        (approximateBytes / REALTIME_SCENE_BYTES_PER_SECOND) * 1000,
      )),
    );
  } catch {
    return REALTIME_SCENE_DELAY_MS;
  }
}

function fallbackReconcileElements(localElements, remoteElements) {
  const elementsById = new Map();
  Array.from(remoteElements || []).forEach((element) => {
    if (element?.id) elementsById.set(element.id, element);
  });
  Array.from(localElements || []).forEach((element) => {
    if (!element?.id) return;
    const remote = elementsById.get(element.id);
    if (!remote || Number(element.version || 0) >= Number(remote.version || 0)) {
      elementsById.set(element.id, element);
    }
  });
  return Array.from(elementsById.values());
}

function reconcileScenes(localScene, remoteScene, excalidrawApi) {
  const localElements = Array.from(localScene?.elements || []);
  const remoteElements = Array.from(remoteScene?.elements || []);
  let elements;
  try {
    elements = reconcileElements(
      localElements,
      remoteElements,
      excalidrawApi?.getAppState?.() || {},
    );
  } catch {
    elements = fallbackReconcileElements(localElements, remoteElements);
  }
  return {
    elements,
    appState: {
      ...durableAppState(remoteScene?.appState || {}),
      ...durableAppState(localScene?.appState || {}),
    },
    files: {
      ...(remoteScene?.files || {}),
      ...(localScene?.files || {}),
    },
  };
}

function errorMessage(error, fallback) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (detail && typeof detail === 'object' && String(detail.message || '').trim()) {
    return String(detail.message).trim();
  }
  return error?.message || fallback;
}

export default function TaskCanvasWorkspace({ task, theme }) {
  const taskId = String(task?.id || '').trim();
  const [canvas, setCanvas] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveState, setSaveState] = useState('idle');
  const [saveError, setSaveError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [realtimeStatus, setRealtimeStatus] = useState('disconnected');
  const [collaboratorCount, setCollaboratorCount] = useState(0);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);

  const workspaceRef = useRef(null);
  const fullscreenButtonRef = useRef(null);
  const nativeFullscreenActiveRef = useRef(false);
  const revisionRef = useRef(0);
  const pendingSceneRef = useRef(null);
  const lastPersistedSignatureRef = useRef('');
  const saveTimerRef = useRef(null);
  const savingRef = useRef(false);
  const savePendingRef = useRef(null);
  const canEditRef = useRef(false);
  const excalidrawApiRef = useRef(null);
  const realtimeSocketRef = useRef(null);
  const realtimeEventHandlerRef = useRef(() => {});
  const collaboratorsRef = useRef(new Map());
  const applyingRemoteRef = useRef(false);
  const programmaticSceneSignaturesRef = useRef(new Set());
  const realtimeSceneTimerRef = useRef(null);
  const pendingRealtimeSceneRef = useRef(null);
  const lastRealtimeSignatureRef = useRef('');
  const lastCursorBroadcastAtRef = useRef(Number.NEGATIVE_INFINITY);
  const ownConnectionIdRef = useRef('');

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const clearRealtimeSceneTimer = useCallback(() => {
    if (realtimeSceneTimerRef.current) {
      window.clearTimeout(realtimeSceneTimerRef.current);
      realtimeSceneTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    clearSaveTimer();
    pendingSceneRef.current = null;
    revisionRef.current = 0;
    lastPersistedSignatureRef.current = '';
    programmaticSceneSignaturesRef.current = new Set();
    lastRealtimeSignatureRef.current = '';
    pendingRealtimeSceneRef.current = null;
    collaboratorsRef.current = new Map();
    ownConnectionIdRef.current = '';
    canEditRef.current = false;
    setCollaboratorCount(0);
    setRealtimeStatus('disconnected');
    setCanvas(null);
    setLoading(true);
    setLoadError('');
    setSaveError('');
    setSaveState('idle');

    hubTaskCanvasAPI.getTaskCanvas(taskId, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const scene = durableScene(
          payload?.scene?.elements,
          payload?.scene?.appState,
          payload?.scene?.files,
        );
        revisionRef.current = Number(payload?.revision || 0);
        canEditRef.current = Boolean(payload?.can_edit);
        lastPersistedSignatureRef.current = sceneSignature(scene);
        setCanvas({ ...payload, scene });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadError(errorMessage(error, 'Не удалось загрузить доску задачи.'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
      clearSaveTimer();
      clearRealtimeSceneTimer();
    };
  }, [clearRealtimeSceneTimer, clearSaveTimer, reloadNonce, taskId]);

  const savePending = useCallback(async () => {
    const scene = pendingSceneRef.current;
    if (!scene || !canvas?.can_edit || savingRef.current) return;

    clearSaveTimer();
    pendingSceneRef.current = null;
    savingRef.current = true;
    let saveSucceeded = false;
    setSaveState('saving');
    setSaveError('');
    let sceneToSave = scene;
    let conflictMerged = false;
    let retryConflictAutomatically = false;
    try {
      let response;
      for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
        try {
          response = await hubTaskCanvasAPI.saveTaskCanvas(taskId, {
            revision: revisionRef.current,
            scene: sceneToSave,
          });
          break;
        } catch (error) {
          if (error?.response?.status !== 409 || attempt === MAX_SAVE_ATTEMPTS - 1) {
            throw error;
          }
        }

        const latest = await hubTaskCanvasAPI.getTaskCanvas(taskId);
        sceneToSave = reconcileScenes(
          pendingSceneRef.current || sceneToSave,
          latest?.scene || {},
          excalidrawApiRef.current,
        );
        pendingSceneRef.current = null;
        revisionRef.current = Number(latest?.revision || 0);
        conflictMerged = true;
        const programmaticSignatures = programmaticSceneSignaturesRef.current;
        programmaticSignatures.add(sceneSignature(sceneToSave));
        if (programmaticSignatures.size > 20) {
          programmaticSignatures.delete(programmaticSignatures.values().next().value);
        }
        applyingRemoteRef.current = true;
        const fileItems = Object.values(sceneToSave.files || {});
        if (fileItems.length) excalidrawApiRef.current?.addFiles?.(fileItems);
        excalidrawApiRef.current?.updateScene?.({
          elements: sceneToSave.elements,
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        queueMicrotask(() => {
          applyingRemoteRef.current = false;
        });
      }
      revisionRef.current = Number(response?.revision || revisionRef.current);
      saveSucceeded = true;
      lastPersistedSignatureRef.current = sceneSignature(sceneToSave);
      setCanvas((previous) => (previous ? { ...previous, ...response, scene: sceneToSave } : previous));
      setSaveState(pendingSceneRef.current ? 'dirty' : 'saved');
      if (conflictMerged) {
        realtimeSocketRef.current?.sendScene(sceneToSave, { baseRevision: revisionRef.current });
      }
    } catch (error) {
      if (!pendingSceneRef.current) pendingSceneRef.current = sceneToSave;
      if (error?.response?.status === 409) {
        retryConflictAutomatically = true;
        setSaveState('error');
        setSaveError('Не удалось синхронизировать изменения. Повторяем автоматически…');
      } else {
        setSaveState('error');
        setSaveError(errorMessage(error, 'Не удалось сохранить доску.'));
      }
    } finally {
      savingRef.current = false;
      if (saveSucceeded && pendingSceneRef.current) {
        saveTimerRef.current = window.setTimeout(
          () => void savePendingRef.current?.(),
          AUTOSAVE_DELAY_MS,
        );
      } else if (retryConflictAutomatically && pendingSceneRef.current) {
        saveTimerRef.current = window.setTimeout(
          () => void savePendingRef.current?.(),
          SAVE_CONFLICT_RETRY_DELAY_MS,
        );
      }
    }
  }, [canvas?.can_edit, clearSaveTimer, taskId]);

  useEffect(() => {
    savePendingRef.current = savePending;
  }, [savePending]);

  useEffect(() => {
    canEditRef.current = Boolean(canvas?.can_edit);
  }, [canvas?.can_edit]);

  useEffect(() => () => {
    const scene = pendingSceneRef.current;
    if (!scene || !canEditRef.current || savingRef.current) return;
    pendingSceneRef.current = null;
    void hubTaskCanvasAPI.saveTaskCanvas(taskId, {
      revision: revisionRef.current,
      scene,
    }).catch(() => {});
  }, [taskId]);

  useEffect(() => {
    const warnAboutUnsavedChanges = (event) => {
      if (!pendingSceneRef.current && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnAboutUnsavedChanges);
    return () => window.removeEventListener('beforeunload', warnAboutUnsavedChanges);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === workspaceRef.current;
      const wasActive = nativeFullscreenActiveRef.current;
      nativeFullscreenActiveRef.current = active;
      setNativeFullscreen(active);
      if (wasActive && !active) {
        queueMicrotask(() => fullscreenButtonRef.current?.focus());
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!fallbackFullscreen) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const inertedSiblings = [];
    let branch = workspaceRef.current;
    while (branch?.parentElement) {
      const parent = branch.parentElement;
      Array.from(parent.children).forEach((sibling) => {
        if (sibling !== branch && !sibling.hasAttribute('inert')) {
          sibling.setAttribute('inert', '');
          inertedSiblings.push(sibling);
        }
      });
      branch = parent;
      if (parent === document.body) break;
    }
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFallbackFullscreen(false);
      queueMicrotask(() => fullscreenButtonRef.current?.focus());
    };
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      inertedSiblings.forEach((element) => element.removeAttribute('inert'));
    };
  }, [fallbackFullscreen]);

  const commitCollaborators = useCallback((update) => {
    const next = new Map(collaboratorsRef.current);
    update(next);
    collaboratorsRef.current = next;
    setCollaboratorCount(next.size);
    excalidrawApiRef.current?.updateScene?.({
      collaborators: next,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, []);

  const queueDurableSave = useCallback((scene) => {
    if (!scene || !canEditRef.current) return;
    pendingSceneRef.current = scene;
    setSaveState('dirty');
    setSaveError('');
    clearSaveTimer();
    saveTimerRef.current = window.setTimeout(
      () => void savePendingRef.current?.(),
      AUTOSAVE_DELAY_MS,
    );
  }, [clearSaveTimer]);

  const currentEditorScene = useCallback(() => {
    if (pendingSceneRef.current) return pendingSceneRef.current;
    const api = excalidrawApiRef.current;
    if (api) {
      return durableScene(
        api.getSceneElementsIncludingDeleted?.() || [],
        api.getAppState?.() || {},
        api.getFiles?.() || {},
      );
    }
    return canvas?.scene || null;
  }, [canvas?.scene]);

  const applyRemoteScene = useCallback((remoteScene) => {
    const api = excalidrawApiRef.current;
    const hadLocalPendingScene = Boolean(pendingSceneRef.current);
    const localScene = currentEditorScene();
    if (!api || !localScene || !remoteScene) return;
    const merged = reconcileScenes(localScene, remoteScene, api);
    const mergedSignature = sceneSignature(merged);
    if (mergedSignature === sceneSignature(localScene)) return;
    const fileItems = Object.values(remoteScene?.files || {});
    const programmaticSignatures = programmaticSceneSignaturesRef.current;
    programmaticSignatures.add(mergedSignature);
    if (programmaticSignatures.size > 20) {
      programmaticSignatures.delete(programmaticSignatures.values().next().value);
    }
    applyingRemoteRef.current = true;
    if (fileItems.length) api.addFiles?.(fileItems);
    api.updateScene({
      elements: merged.elements,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    queueMicrotask(() => {
      applyingRemoteRef.current = false;
    });
    if (hadLocalPendingScene) {
      queueDurableSave(merged);
    } else {
      lastPersistedSignatureRef.current = mergedSignature;
      setCanvas((previous) => (previous ? { ...previous, scene: merged } : previous));
    }
  }, [currentEditorScene, queueDurableSave]);

  const queueRealtimeScene = useCallback((scene) => {
    if (!scene) return;
    pendingRealtimeSceneRef.current = scene;
    if (realtimeSceneTimerRef.current) return;
    realtimeSceneTimerRef.current = window.setTimeout(() => {
      realtimeSceneTimerRef.current = null;
      const nextScene = pendingRealtimeSceneRef.current;
      pendingRealtimeSceneRef.current = null;
      const signature = sceneSignature(nextScene);
      if (!nextScene || signature === lastRealtimeSignatureRef.current) return;
      if (realtimeSocketRef.current?.sendScene(nextScene, { baseRevision: revisionRef.current })) {
        lastRealtimeSignatureRef.current = signature;
      }
    }, realtimeSceneDelay(scene));
  }, []);

  realtimeEventHandlerRef.current = (envelope) => {
    const eventType = String(envelope?.type || '').trim();
    const payload = envelope?.payload || {};
    const connectionId = String(payload?.connection_id || '').trim();
    if (eventType === 'task_canvas.connected') {
      ownConnectionIdRef.current = connectionId;
      revisionRef.current = Math.max(revisionRef.current, Number(payload?.revision || 0));
      canEditRef.current = Boolean(payload?.can_edit);
      setCanvas((previous) => (previous ? { ...previous, can_edit: Boolean(payload?.can_edit) } : previous));
      commitCollaborators((next) => {
        if (connectionId) next.set(connectionId, { ...(payload?.collaborator || {}), isCurrentUser: true });
      });
      applyRemoteScene(payload?.scene);
      return;
    }
    if (eventType === 'task_canvas.presence.joined' || eventType === 'task_canvas.cursor') {
      commitCollaborators((next) => {
        if (!connectionId) return;
        const previous = next.get(connectionId) || {};
        next.set(connectionId, {
          ...previous,
          ...(payload?.collaborator || {}),
          ...(eventType === 'task_canvas.cursor' ? {
            pointer: payload?.pointer,
            button: payload?.button,
          } : {}),
          isCurrentUser: connectionId === ownConnectionIdRef.current,
        });
      });
      return;
    }
    if (eventType === 'task_canvas.presence.left') {
      commitCollaborators((next) => {
        if (connectionId) next.delete(connectionId);
      });
      return;
    }
    if (eventType === 'task_canvas.sync.requested') {
      const scene = currentEditorScene();
      if (scene) {
        realtimeSocketRef.current?.sendScene(scene, {
          baseRevision: revisionRef.current,
          targetConnectionId: payload?.target_connection_id,
        });
      }
      return;
    }
    if (eventType === 'task_canvas.scene.updated') {
      const targetConnectionId = String(payload?.target_connection_id || '').trim();
      if (targetConnectionId && targetConnectionId !== ownConnectionIdRef.current) return;
      commitCollaborators((next) => {
        if (connectionId) {
          next.set(connectionId, {
            ...(next.get(connectionId) || {}),
            ...(payload?.collaborator || {}),
            isCurrentUser: false,
          });
        }
      });
      applyRemoteScene(payload?.scene);
      return;
    }
    if (eventType === 'task_canvas.error') {
      const code = String(payload?.code || '').trim();
      if (code === 'forbidden') {
        setCanvas((previous) => (previous ? { ...previous, can_edit: false } : previous));
      }
      if (code !== 'rate_limited') {
        setSaveError(String(payload?.detail || 'Ошибка совместной работы с доской.'));
      }
    }
  };

  const canvasReady = Boolean(canvas);
  useEffect(() => {
    if (!canvasReady || !taskId) return undefined;
    const socket = createTaskCanvasSocket({
      taskId,
      onEvent: (envelope) => realtimeEventHandlerRef.current(envelope),
      onStatus: (status) => {
        if (realtimeSocketRef.current !== socket) return;
        setRealtimeStatus(status);
        if (status === 'disconnected' || status === 'unauthorized') {
          commitCollaborators((next) => next.clear());
        }
      },
    });
    realtimeSocketRef.current = socket;
    socket.connect();
    return () => {
      clearRealtimeSceneTimer();
      if (realtimeSocketRef.current === socket) realtimeSocketRef.current = null;
      socket.close();
      ownConnectionIdRef.current = '';
      collaboratorsRef.current = new Map();
    };
  }, [canvasReady, clearRealtimeSceneTimer, commitCollaborators, taskId]);

  const initialData = useMemo(() => {
    if (!canvas) return null;
    return {
      elements: canvas.scene.elements,
      appState: canvas.scene.appState,
      files: canvas.scene.files,
      scrollToContent: true,
    };
  }, [canvas]);

  const handleChange = useCallback((elements, appState, files) => {
    if (!canvas?.can_edit) return;
    const scene = durableScene(elements, appState, files);
    const signature = sceneSignature(scene);
    if (programmaticSceneSignaturesRef.current.delete(signature)) {
      return;
    }
    if (signature === lastPersistedSignatureRef.current) return;
    queueDurableSave(scene);
    if (!applyingRemoteRef.current) queueRealtimeScene(scene);
  }, [canvas?.can_edit, queueDurableSave, queueRealtimeScene]);

  const handleExcalidrawApi = useCallback((api) => {
    excalidrawApiRef.current = api;
    if (api && collaboratorsRef.current.size > 0) {
      api.updateScene({
        collaborators: new Map(collaboratorsRef.current),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  }, []);

  const handlePointerUpdate = useCallback((payload) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if ((now - lastCursorBroadcastAtRef.current) < CURSOR_BROADCAST_INTERVAL_MS) return;
    lastCursorBroadcastAtRef.current = now;
    realtimeSocketRef.current?.sendCursor({
      pointer: payload?.pointer,
      button: payload?.button,
    });
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const workspace = workspaceRef.current;
    if (!workspace) return;

    if (document.fullscreenElement === workspace) {
      try {
        await document.exitFullscreen?.();
      } catch {
        nativeFullscreenActiveRef.current = false;
        setNativeFullscreen(false);
      }
      return;
    }

    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      queueMicrotask(() => fullscreenButtonRef.current?.focus());
      return;
    }

    if (typeof workspace.requestFullscreen === 'function') {
      try {
        await workspace.requestFullscreen();
        const active = document.fullscreenElement === workspace;
        nativeFullscreenActiveRef.current = active;
        setNativeFullscreen(active);
        if (active) return;
      } catch {
        // Use the viewport overlay below when Fullscreen API is unavailable or denied.
      }
    }
    setFallbackFullscreen(true);
  }, [fallbackFullscreen]);

  const readOnly = !canvas?.can_edit;
  const isFullscreen = nativeFullscreen || fallbackFullscreen;
  const statusLabel = saveState === 'saving'
    ? 'Сохранение…'
    : saveState === 'dirty'
      ? 'Есть несохранённые изменения'
      : saveState === 'saved'
        ? 'Изменения сохранены'
        : readOnly
          ? 'Только просмотр'
          : 'Автосохранение включено';
  const realtimeLabel = realtimeStatus === 'connected'
    ? `На доске: ${Math.max(1, collaboratorCount)}`
    : realtimeStatus === 'reconnecting'
      ? 'Совместная работа: переподключение…'
      : realtimeStatus === 'connecting'
        ? 'Совместная работа: подключение…'
        : realtimeStatus === 'unauthorized'
          ? 'Совместная работа недоступна'
          : 'Совместная работа офлайн';

  if (loading) {
    return (
      <Stack sx={{ flex: 1, minHeight: 0 }} alignItems="center" justifyContent="center" spacing={1.5}>
        <CircularProgress size={30} />
        <Typography variant="body2">Загрузка доски…</Typography>
      </Stack>
    );
  }

  if (loadError || !canvas || !initialData) {
    return (
      <Alert
        severity="error"
        action={(
          <Button color="inherit" size="small" onClick={() => setReloadNonce((value) => value + 1)}>
            Повторить
          </Button>
        )}
      >
        {loadError || 'Доска задачи недоступна.'}
      </Alert>
    );
  }

  return (
    <Stack
      ref={workspaceRef}
      spacing={0.75}
      data-testid="task-canvas-workspace"
      data-fullscreen={String(isFullscreen)}
      role={fallbackFullscreen ? 'dialog' : undefined}
      aria-modal={fallbackFullscreen ? 'true' : undefined}
      aria-label={fallbackFullscreen ? 'Доска задачи на весь экран' : undefined}
      sx={{
        flex: 1,
        minHeight: 0,
        height: isFullscreen ? '100dvh' : '100%',
        width: isFullscreen ? '100vw' : 'auto',
        overflow: 'hidden',
        position: isFullscreen ? 'fixed' : 'relative',
        inset: isFullscreen ? 0 : 'auto',
        zIndex: isFullscreen ? theme.zIndex.modal : 'auto',
        boxSizing: 'border-box',
        bgcolor: isFullscreen ? theme.palette.background.default : 'transparent',
        overscrollBehavior: isFullscreen ? 'contain' : 'auto',
        ...(isFullscreen ? {
          paddingBlockStart: 'max(8px, env(safe-area-inset-top))',
          paddingBlockEnd: 'max(8px, env(safe-area-inset-bottom))',
          paddingInlineStart: 'max(8px, env(safe-area-inset-left))',
          paddingInlineEnd: 'max(8px, env(safe-area-inset-right))',
        } : {}),
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        justifyContent="space-between"
        sx={{ minHeight: 40, flexShrink: 0 }}
      >
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            role="status"
            aria-live="polite"
            noWrap
            sx={{ minWidth: 0 }}
          >
            {statusLabel}
          </Typography>
          <Typography
            data-testid="task-canvas-realtime-status"
            variant="caption"
            color={realtimeStatus === 'connected' ? 'success.main' : 'text.secondary'}
            noWrap
          >
            {realtimeLabel}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
          {canvas.can_edit && (
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveRoundedIcon />}
              disabled={saveState === 'saving' || !pendingSceneRef.current}
              onClick={() => void savePending()}
              sx={{ minHeight: 40, textTransform: 'none', fontWeight: 700, boxShadow: 'none' }}
            >
              {saveState === 'error' ? 'Повторить сохранение' : 'Сохранить'}
            </Button>
          )}
          <Tooltip title={isFullscreen ? 'Вернуть доску в карточку' : 'Развернуть доску на весь экран'}>
            <IconButton
              ref={fullscreenButtonRef}
              size="small"
              aria-label={isFullscreen ? 'Вернуть доску в карточку' : 'Развернуть доску на весь экран'}
              aria-pressed={isFullscreen}
              onClick={() => void toggleFullscreen()}
              sx={{
                width: 40,
                height: 40,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
              }}
            >
              {isFullscreen
                ? <CloseFullscreenRoundedIcon fontSize="small" />
                : <OpenInFullRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>

      {readOnly && (
        <Alert severity="info" sx={{ flexShrink: 0 }}>
          {String(task?.status || '').toLowerCase() === 'done'
            ? 'Задача закрыта — доска доступна только для просмотра.'
            : 'У вас есть доступ к просмотру этой доски без редактирования.'}
        </Alert>
      )}
      {saveError && (
        <Alert severity="error" sx={{ flexShrink: 0 }}>
          {saveError}
        </Alert>
      )}

      <Box
        data-testid="task-canvas-surface"
        aria-label="Доска задачи"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '14px',
          bgcolor: theme.palette.background.paper,
          '& .excalidraw': { borderRadius: 'inherit' },
        }}
      >
        <Excalidraw
          initialData={initialData}
          onChange={handleChange}
          excalidrawAPI={handleExcalidrawApi}
          isCollaborating={realtimeStatus === 'connected'}
          onPointerUpdate={handlePointerUpdate}
          viewModeEnabled={readOnly}
          langCode="ru-RU"
          theme={theme.palette.mode}
          name={String(task?.title || 'Доска задачи')}
          UIOptions={{
            canvasActions: {
              loadScene: false,
              saveToActiveFile: false,
            },
          }}
        />
      </Box>
    </Stack>
  );
}
