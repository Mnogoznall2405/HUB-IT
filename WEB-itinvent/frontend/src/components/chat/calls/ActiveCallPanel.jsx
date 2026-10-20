import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CallEndRoundedIcon from '@mui/icons-material/CallEndRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import DragIndicatorRoundedIcon from '@mui/icons-material/DragIndicatorRounded';
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded';
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded';
import MicOffRoundedIcon from '@mui/icons-material/MicOffRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import ScreenShareRoundedIcon from '@mui/icons-material/ScreenShareRounded';
import StopScreenShareRoundedIcon from '@mui/icons-material/StopScreenShareRounded';
import VideocamOffRoundedIcon from '@mui/icons-material/VideocamOffRounded';
import VideocamRoundedIcon from '@mui/icons-material/VideocamRounded';
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded';

import { forceAppHardReload } from '../../../lib/routeChunkRecovery';
import CallDeviceMenu from './CallDeviceMenu';
import { useChatCalls } from './ChatCallsContext';
import { ParticipantTile, SelfPip } from './CallParticipantTile';
import {
  canUseFullscreen,
  canUsePictureInPicture,
  enterPanelFullscreen,
  exitPanelFullscreen,
  isPanelFullscreen,
  resolveMainTileKey,
  SPOTLIGHT_AUTO,
  SPOTLIGHT_GRID,
  useFloatingPanelDrag,
} from './callPanelLayout';
import {
  buildMediaDetail,
  describeMediaFailure,
  formatCallDuration,
  sanitizeDisplayName,
} from './callsModel';

const PANEL_BG = '#12161c';

function useTick(active) {
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

function useCallStatusText(session) {
  const call = session?.call;
  const connectedSinceRef = useRef(0);
  const live = Boolean(call) && call.status === 'active' && session.phase === 'connected';
  if (live && !connectedSinceRef.current) connectedSinceRef.current = Date.now();
  if (!live && session?.phase !== 'reconnecting') connectedSinceRef.current = 0;
  useTick(live);

  if (!session) return '';
  if (session.phase === 'error') return session.error || 'Ошибка звонка';
  if (session.phase === 'starting') return 'Подготовка…';
  if (session.phase === 'connecting') return 'Подключение…';
  if (session.phase === 'reconnecting') return 'Переподключение…';
  if (call?.status === 'ringing') return session.role === 'caller' ? 'Вызываем…' : 'Подключение…';
  const answeredAt = call?.answered_at ? Date.parse(call.answered_at) : NaN;
  const startedAt = Number.isFinite(answeredAt) ? answeredAt : connectedSinceRef.current;
  return startedAt ? formatCallDuration(Date.now() - startedAt) : 'Подключено';
}

function ControlButton({ title, onClick, active = true, danger = false, warning = false, disabled = false, testId, container, children }) {
  return (
    <Tooltip title={title} PopperProps={container ? { container } : undefined}>
      <span>
        <IconButton
          aria-label={title}
          aria-pressed={danger ? undefined : active}
          onClick={onClick}
          disabled={disabled}
          data-testid={testId}
          sx={{
            width: 48,
            height: 48,
            color: '#fff',
            bgcolor: danger ? '#d32f2f' : (warning ? '#b26a00' : (active ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.32)')),
            '&:hover': { bgcolor: danger ? '#b71c1c' : (warning ? '#8a5300' : 'rgba(255,255,255,0.26)') },
            '&.Mui-disabled': { color: 'rgba(255,255,255,0.35)' },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

export default function ActiveCallPanel() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const finePointer = useMediaQuery('(pointer: fine)');
  const {
    session,
    roomSnapshot,
    selfUserId,
    endCall,
    closeSession,
    controls,
  } = useChatCalls();
  // mini: a compact bar; floating: the draggable panel; expanded: the whole window.
  const [mode, setMode] = useState('floating');
  const [choice, setChoice] = useState(SPOTLIGHT_AUTO);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef(null);
  const seenShareKeysRef = useRef(new Set());
  const statusText = useCallStatusText(session);

  const callId = session?.call?.id || '';
  const hasSession = Boolean(session);
  const failed = session?.phase === 'error';
  const viewMode = failed && mode === 'mini' ? 'floating' : mode;
  const fillViewport = isMobile || viewMode === 'expanded' || isFullscreen;
  // The panel node exists only while a session is shown: the drag/clamp effect must re-run then.
  const dragActive = hasSession && viewMode === 'floating' && !isMobile && !isFullscreen;
  const { position: floatPosition, dragHandlers } = useFloatingPanelDrag({
    panelRef,
    active: dragActive,
    enabled: dragActive && finePointer,
  });
  const fullscreenSupported = canUseFullscreen();
  const pipSupported = canUsePictureInPicture();

  // A new call starts with the default layout.
  useEffect(() => {
    seenShareKeysRef.current = new Set();
    setMode('floating');
    setChoice(SPOTLIGHT_AUTO);
  }, [callId]);

  useEffect(() => {
    if (!hasSession) exitPanelFullscreen();
  }, [hasSession]);

  useEffect(() => () => exitPanelFullscreen(), []);

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(isPanelFullscreen(panelRef.current));
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  // Esc only leaves the expanded window; it never ends the call. An open MUI
  // Modal or Menu stops the event itself, so it does not get here.
  useEffect(() => {
    if (viewMode !== 'expanded' || !hasSession) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.fullscreenElement) return;
      setMode('floating');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [viewMode, hasSession]);

  const callParticipants = session?.call?.participants;
  const tiles = useMemo(() => {
    const names = new Map((callParticipants || []).map((item) => [item.user_id, item.display_name]));
    const live = roomSnapshot?.participants || [];
    const liveIdentities = new Set(live.map((item) => String(item.identity)));
    const result = [];
    const resolveName = (participant) => {
      if (participant.isLocal) return 'Вы';
      return sanitizeDisplayName(participant.name || names.get(String(participant.identity)), 'Участник');
    };
    live.forEach((participant) => {
      const name = resolveName(participant);
      if (participant.screenTrack) {
        result.push({
          key: `${participant.identity}:screen`,
          name: `${name} · экран`,
          videoTrack: participant.screenTrack,
          contain: true,
          speaking: false,
          micOff: false,
          muted: true,
          selectable: true,
          remote: !participant.isLocal,
          isRemoteShare: !participant.isLocal,
        });
      }
      result.push({
        key: `${participant.identity}:camera`,
        name,
        videoTrack: participant.cameraTrack,
        mirror: participant.isLocal,
        speaking: participant.isSpeaking,
        micOff: !participant.micEnabled,
        muted: participant.isLocal,
        testId: participant.isLocal ? 'chat-call-tile-local' : 'chat-call-tile-remote',
        selectable: true,
        remote: !participant.isLocal,
        isLocalCamera: participant.isLocal,
      });
    });
    (callParticipants || []).forEach((item) => {
      if (item.user_id === selfUserId || liveIdentities.has(item.user_id)) return;
      if (item.state !== 'invited') return;
      result.push({
        key: `${item.user_id}:pending`,
        name: sanitizeDisplayName(item.display_name, 'Участник'),
        pendingLabel: 'вызываем',
        speaking: false,
        micOff: false,
        muted: true,
        testId: 'chat-call-tile-pending',
        selectable: false,
        remote: false,
      });
    });
    return result;
  }, [roomSnapshot, callParticipants, selfUserId]);

  // A remote screen share that appears is spotlighted; the user can pick another tile.
  const shareSig = tiles.filter((tile) => tile.isRemoteShare).map((tile) => tile.key).join('|');
  useEffect(() => {
    const keys = shareSig ? shareSig.split('|') : [];
    const seen = seenShareKeysRef.current;
    const hasNew = keys.some((key) => !seen.has(key));
    seenShareKeysRef.current = new Set(keys);
    if (hasNew) setChoice(SPOTLIGHT_AUTO);
  }, [shareSig, callId]);

  const shareKeys = shareSig ? shareSig.split('|') : [];
  const shareKey = shareKeys.length ? shareKeys[shareKeys.length - 1] : null;
  const tileKeys = new Set(tiles.map((tile) => tile.key));
  const mainKey = resolveMainTileKey(choice, tileKeys, shareKey);
  const mainTile = mainKey ? tiles.find((tile) => tile.key === mainKey) || null : null;
  const localCameraTile = tiles.find((tile) => tile.isLocalCamera) || null;
  // The local camera is a PiP over the spotlight only when it has video;
  // otherwise it stays in the strip as an avatar.
  const selfPipTile = mainTile && localCameraTile?.videoTrack && localCameraTile.key !== mainTile.key
    ? localCameraTile
    : null;
  const stripTiles = mainTile
    ? tiles.filter((tile) => tile.key !== mainTile.key && tile.key !== selfPipTile?.key)
    : [];

  const pinTile = useCallback((key) => setChoice({ mode: 'pinned', key }), []);
  const showGrid = useCallback(() => setChoice(SPOTLIGHT_GRID), []);
  const enterFullscreen = useCallback(() => {
    enterPanelFullscreen(panelRef.current).catch(() => setMode('expanded'));
  }, []);

  const handleTileSelect = (tile) => {
    if (mainKey === tile.key) showGrid();
    else pinTile(tile.key);
  };
  const handleTileDoubleClick = (tile) => {
    pinTile(tile.key);
    enterFullscreen();
  };
  const handleTileFullscreen = (tile) => {
    if (isFullscreen) {
      exitPanelFullscreen();
      return;
    }
    pinTile(tile.key);
    enterFullscreen();
  };

  const renderTile = (tile, variant) => (
    <ParticipantTile
      key={tile.key}
      variant={variant}
      name={tile.name}
      videoTrack={tile.videoTrack}
      mirror={tile.mirror}
      contain={tile.contain}
      speaking={tile.speaking}
      micOff={tile.micOff}
      pendingLabel={tile.pendingLabel}
      muted={tile.muted}
      testId={tile.testId}
      selectLabel={variant === 'main'
        ? 'Показать сетку участников'
        : `Сделать главным: ${tile.name}`}
      onSelect={tile.selectable ? () => handleTileSelect(tile) : undefined}
      onDoubleClick={tile.selectable ? () => handleTileDoubleClick(tile) : undefined}
      onFullscreen={fullscreenSupported && tile.selectable ? () => handleTileFullscreen(tile) : undefined}
      fullscreenActive={isFullscreen}
      canPictureInPicture={pipSupported && tile.remote}
    />
  );

  if (!session) return null;

  const title = (() => {
    const others = (callParticipants || [])
      .filter((item) => item.user_id !== selfUserId)
      .map((item) => sanitizeDisplayName(item.display_name, ''))
      .filter(Boolean);
    if (others.length) return others.slice(0, 2).join(', ') + (others.length > 2 ? ` +${others.length - 2}` : '');
    return session.media === 'video' ? 'Видеозвонок' : 'Аудиозвонок';
  })();

  const busy = session.phase === 'starting' || session.phase === 'connecting';
  const micOn = roomSnapshot?.micEnabled ?? false;
  const micIssue = roomSnapshot?.micIssue || null;
  const noMic = Boolean(micIssue) && !micOn;
  const micTitle = noMic
    ? 'Нет микрофона. Нажмите, чтобы подключить'
    : (micOn ? 'Выключить микрофон' : 'Включить микрофон');
  const cameraOn = roomSnapshot?.cameraEnabled ?? false;
  const screenOn = roomSnapshot?.screenEnabled ?? false;
  const canShareScreen = !isMobile
    && typeof navigator !== 'undefined'
    && Boolean(navigator.mediaDevices?.getDisplayMedia);
  const controlsDisabled = !roomSnapshot || failed;
  // Tooltips and the device menu render inside the panel only in fullscreen,
  // where elements outside the fullscreen element are not shown.
  const portalContainer = isFullscreen ? (panelRef.current || undefined) : undefined;

  const handleEnd = () => (failed ? closeSession() : endCall());
  const minimize = () => {
    exitPanelFullscreen();
    setMode('mini');
  };

  const statusLine = (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      {busy || session.phase === 'reconnecting' ? <CircularProgress size={12} sx={{ color: '#fff' }} /> : null}
      <Typography
        data-testid="chat-call-status"
        noWrap
        sx={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)', fontVariantNumeric: 'tabular-nums' }}
      >
        {statusText}
      </Typography>
    </Stack>
  );

  if (viewMode === 'mini') {
    return (
      <Paper
        elevation={8}
        role="region"
        aria-label="Идёт звонок"
        data-testid="chat-call-panel-mini"
        sx={{
          position: 'fixed',
          zIndex: 1250,
          right: 12,
          bottom: 'calc(12px + env(safe-area-inset-bottom))',
          left: { xs: 12, sm: 'auto' },
          width: { sm: 340 },
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          py: 0.75,
          borderRadius: 3,
          bgcolor: PANEL_BG,
          color: '#fff',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{title}</Typography>
          {statusLine}
        </Box>
        <ControlButton
          title={micTitle}
          active={micOn}
          warning={noMic}
          disabled={controlsDisabled}
          onClick={controls.toggleMicrophone}
        >
          {micOn ? <MicRoundedIcon /> : <MicOffRoundedIcon />}
        </ControlButton>
        <ControlButton title="Развернуть" onClick={() => setMode('floating')}>
          <OpenInFullRoundedIcon />
        </ControlButton>
        <ControlButton title="Завершить звонок" danger onClick={handleEnd} testId="chat-call-end-mini">
          <CallEndRoundedIcon />
        </ControlButton>
      </Paper>
    );
  }

  const expanded = viewMode === 'expanded';
  const dragEnabled = dragActive && finePointer;
  const floatingAnchor = floatPosition && !fillViewport
    ? { left: floatPosition.left, top: floatPosition.top, right: 'auto', bottom: 'auto' }
    : { right: 16, bottom: 16 };

  return (
    <Paper
      ref={panelRef}
      elevation={12}
      role="region"
      aria-label="Идёт звонок"
      data-testid="chat-call-panel"
      data-call-mode={viewMode}
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      sx={{
        position: 'fixed',
        zIndex: 1250,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: PANEL_BG,
        color: '#fff',
        overflow: 'hidden',
        ...(fillViewport
          ? {
            inset: 0,
            borderRadius: 0,
            ...(isMobile ? { pt: 'env(safe-area-inset-top)', pb: 'env(safe-area-inset-bottom)' } : {}),
          }
          : {
            ...floatingAnchor,
            width: session.media === 'video' || tiles.length > 2 ? 560 : 400,
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100dvh - 32px)',
            borderRadius: 3,
          }),
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        {...(dragEnabled ? dragHandlers : {})}
        sx={{
          px: 1.5,
          py: 1,
          cursor: dragEnabled ? 'move' : undefined,
          touchAction: dragEnabled ? 'none' : undefined,
          userSelect: dragEnabled ? 'none' : undefined,
        }}
      >
        {dragEnabled ? (
          <DragIndicatorRoundedIcon
            aria-hidden="true"
            sx={{ fontSize: 18, color: 'rgba(255,255,255,0.45)', flexShrink: 0 }}
          />
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{title}</Typography>
          {statusLine}
        </Box>
        {mainTile ? (
          <Button
            size="small"
            variant="outlined"
            data-testid="chat-call-grid-toggle"
            aria-label="Показать сетку участников"
            startIcon={<GridViewRoundedIcon fontSize="small" />}
            onClick={showGrid}
            sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.4)', textTransform: 'none', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            Сетка
          </Button>
        ) : null}
        {isFullscreen ? (
          <Tooltip title="Выйти из полноэкранного режима">
            <IconButton
              aria-label="Выйти из полноэкранного режима"
              data-testid="chat-call-fullscreen-exit"
              onClick={exitPanelFullscreen}
              sx={{ color: '#fff' }}
            >
              <FullscreenExitRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        {!failed && !isMobile ? (
          <Tooltip title={expanded ? 'Вернуть обычный размер' : 'Развернуть на всё окно'}>
            <IconButton
              aria-label={expanded ? 'Вернуть обычный размер' : 'Развернуть на всё окно'}
              data-testid="chat-call-expand"
              onClick={() => setMode(expanded ? 'floating' : 'expanded')}
              sx={{ color: '#fff' }}
            >
              {expanded ? <FullscreenExitRoundedIcon fontSize="small" /> : <OpenInFullRoundedIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        ) : null}
        {!failed ? (
          <Tooltip title="Свернуть">
            <IconButton
              aria-label="Свернуть"
              onClick={minimize}
              sx={{ color: '#fff' }}
            >
              <CloseFullscreenRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>

      {failed ? (
        <Alert
          severity="error"
          sx={{ mx: 1.5, mb: 1 }}
          data-testid="chat-call-error"
          action={session.errorAction === 'reload' ? (
            <Button
              color="inherit"
              size="small"
              data-testid="chat-call-reload"
              onClick={() => { void forceAppHardReload(); }}
            >
              Обновить
            </Button>
          ) : undefined}
        >
          {session.error}
          {session.errorDetail ? (
            <Typography
              variant="caption"
              data-testid="chat-call-error-detail"
              sx={{ display: 'block', mt: 0.5, opacity: 0.75 }}
            >
              {session.errorDetail}
            </Typography>
          ) : null}
        </Alert>
      ) : null}
      {noMic && !failed ? (
        <Alert severity="warning" sx={{ mx: 1.5, mb: 1 }} data-testid="chat-call-no-mic">
          Вы слышите собеседника, но микрофон не подключён. Подключите устройство и нажмите кнопку микрофона.
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.75 }}>
            {[describeMediaFailure(micIssue.errorName, 'microphone').text, buildMediaDetail(micIssue.errorName, micIssue.inputCount)]
              .filter(Boolean)
              .join(' ')}
          </Typography>
        </Alert>
      ) : null}
      {roomSnapshot?.audioBlocked && !failed ? (
        <Alert
          severity="warning"
          sx={{ mx: 1.5, mb: 1 }}
          action={(
            <Button
              color="inherit"
              size="small"
              startIcon={<VolumeUpRoundedIcon />}
              onClick={controls.resumeAudio}
            >
              Включить звук
            </Button>
          )}
        >
          Браузер заблокировал воспроизведение звука.
        </Alert>
      ) : null}

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: 1.5,
          pb: 1,
        }}
      >
        {mainTile ? (
          <Stack spacing={1} sx={{ height: fillViewport ? '100%' : undefined, minHeight: 0 }}>
            <Box
              data-testid="chat-call-spotlight"
              sx={{
                position: 'relative',
                width: '100%',
                flex: fillViewport ? 1 : undefined,
                minHeight: fillViewport ? 0 : undefined,
                aspectRatio: fillViewport ? undefined : '16 / 9',
              }}
            >
              {renderTile(mainTile, 'main')}
              {selfPipTile ? <SelfPip track={selfPipTile.videoTrack} /> : null}
            </Box>
            {stripTiles.length ? (
              <Stack
                data-testid="chat-call-strip"
                direction="row"
                spacing={1}
                sx={{ overflowX: 'auto', flexShrink: 0, pb: 0.5 }}
              >
                {stripTiles.map((tile) => renderTile(tile, 'strip'))}
              </Stack>
            ) : null}
          </Stack>
        ) : (
          <Box
            data-testid="chat-call-grid"
            sx={{
              display: 'grid',
              gap: 1,
              alignContent: 'start',
              gridTemplateColumns: {
                xs: tiles.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
                sm: tiles.length > 2 ? 'repeat(auto-fit, minmax(200px, 1fr))' : (tiles.length > 1 ? 'repeat(2, minmax(0, 1fr))' : '1fr'),
              },
            }}
          >
            {tiles.map((tile) => renderTile(tile, 'grid'))}
            {!tiles.length && !failed ? (
              <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 140, gridColumn: '1 / -1' }}>
                <CircularProgress size={28} sx={{ color: '#fff' }} />
              </Stack>
            ) : null}
          </Box>
        )}
      </Box>

      <Stack
        direction="row"
        spacing={1.25}
        justifyContent="center"
        alignItems="center"
        sx={{ px: 1.5, py: 1.25, borderTop: '1px solid rgba(255,255,255,0.1)' }}
      >
        <ControlButton
          title={micTitle}
          active={micOn}
          warning={noMic}
          disabled={controlsDisabled}
          onClick={controls.toggleMicrophone}
          testId="chat-call-toggle-mic"
          container={portalContainer}
        >
          {micOn ? <MicRoundedIcon /> : <MicOffRoundedIcon />}
        </ControlButton>
        <CallDeviceMenu
          kind="audioinput"
          title="Выбрать микрофон"
          emptyLabel="Устройства ввода не найдены"
          devicesVersion={roomSnapshot?.devicesVersion}
          controls={controls}
          disabled={controlsDisabled}
          testId="chat-call-mic-device-menu"
          container={portalContainer}
        />
        <ControlButton
          title={cameraOn ? 'Выключить камеру' : 'Включить камеру'}
          active={cameraOn}
          disabled={controlsDisabled}
          onClick={controls.toggleCamera}
          testId="chat-call-toggle-camera"
          container={portalContainer}
        >
          {cameraOn ? <VideocamRoundedIcon /> : <VideocamOffRoundedIcon />}
        </ControlButton>
        {session.media === 'video' || cameraOn ? (
          <CallDeviceMenu
            kind="videoinput"
            title="Выбрать камеру"
            emptyLabel="Камеры не найдены"
            devicesVersion={roomSnapshot?.devicesVersion}
            controls={controls}
            disabled={controlsDisabled}
            testId="chat-call-camera-device-menu"
            container={portalContainer}
          />
        ) : null}
        {canShareScreen ? (
          <ControlButton
            title={screenOn ? 'Остановить демонстрацию экрана' : 'Показать экран'}
            active={screenOn}
            disabled={controlsDisabled}
            onClick={controls.toggleScreenShare}
            testId="chat-call-toggle-screen"
            container={portalContainer}
          >
            {screenOn ? <StopScreenShareRoundedIcon /> : <ScreenShareRoundedIcon />}
          </ControlButton>
        ) : null}
        <ControlButton
          title={failed ? 'Закрыть' : 'Завершить звонок'}
          danger
          onClick={handleEnd}
          testId="chat-call-end"
          container={portalContainer}
        >
          <CallEndRoundedIcon />
        </ControlButton>
      </Stack>
    </Paper>
  );
}
