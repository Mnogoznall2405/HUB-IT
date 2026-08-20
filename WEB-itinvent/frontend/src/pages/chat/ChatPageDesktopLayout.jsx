import { useRef } from 'react';
import { Box, Paper } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';

import {
  CHAT_RIGHT_PANEL_DEFAULT_WIDTH,
  clampChatRightPanelWidth,
  resolveChatDesktopGridTemplateColumns,
} from './chatRightPanelLayout';

function RightPanelResizeHandle({ currentWidth, onWidthChange }) {
  const dragRef = useRef(null);
  if (typeof onWidthChange !== 'function') return null;
  return (
    <Box
      data-testid="chat-right-panel-resize-handle"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = { startX: event.clientX, startWidth: currentWidth };
      }}
      onPointerMove={(event) => {
        if (!dragRef.current) return;
        const next = dragRef.current.startWidth + (dragRef.current.startX - event.clientX);
        onWidthChange(next);
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      sx={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 8,
        cursor: 'col-resize',
        zIndex: 3,
        '&:hover': { bgcolor: alpha('#1976d2', 0.12) },
      }}
    />
  );
}

export default function ChatPageDesktopLayout({
  isMobile,
  isPhone,
  ui,
  theme,
  sidebarPane,
  threadPane,
  desktopRightPanelContent,
  desktopRightPanelWidth,
  onDesktopRightPanelWidthChange,
  taskSplitLayout = false,
  renderDesktopRightPanel = false,
  renderPersistentRightPanel = false,
  showTaskPanel = false,
  closeTaskPanel,
  onCloseContextPanel,
  contextPanelEnterDuration,
  contextPanelExitDuration,
  resolvedMobileView,
  mobileTransitionDirection,
  mobileMotionDisabled = false,
  mobileScreenVariants,
  mobileScreenTransition,
  handleMobileThreadScreenAnimationComplete,
  gridTemplateColumns,
}) {
  const showTaskSplitLayout = taskSplitLayout && renderDesktopRightPanel && showTaskPanel;
  const resolvedDesktopRightPanelWidth = clampChatRightPanelWidth(
    desktopRightPanelWidth,
    CHAT_RIGHT_PANEL_DEFAULT_WIDTH,
  );
  const resolvedGridTemplateColumns = gridTemplateColumns ?? (
    showTaskSplitLayout
      ? 'minmax(0, 1fr) minmax(320px, 400px)'
      : resolveChatDesktopGridTemplateColumns({
        sidebarMin: ui.density.sidebarColumnMin,
        sidebarMax: ui.density.sidebarColumnMax,
        rightPanelWidth: resolvedDesktopRightPanelWidth,
        persistent: renderPersistentRightPanel,
      })
  );

  return (
    <Paper
      data-testid="chat-desktop-shell"
      elevation={0}
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: isPhone ? 0 : 1.5,
        border: isPhone ? 'none' : `1px solid ${ui.desktopShellBorder || ui.borderSoft}`,
        borderBottom: isPhone ? undefined : 'none',
        bgcolor: isPhone ? ui.threadBg : ui.panelBg,
        boxShadow: isPhone ? 'none' : `0 18px 42px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.18 : 0.1)}`,
      }}
    >
      <Box
        sx={{
          display: isMobile ? 'block' : 'grid',
          gridTemplateColumns: isMobile ? undefined : resolvedGridTemplateColumns,
          flex: 1,
          minHeight: 0,
        }}
      >
        {isMobile ? (
          <Box sx={{
            position: 'relative',
            minWidth: 0,
            minHeight: 0,
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            display: 'flex',
            flex: 1,
            isolation: 'isolate',
          }}
          >
            <AnimatePresence initial={false} custom={mobileTransitionDirection} mode="sync">
              {resolvedMobileView === 'thread' ? (
                <Box
                  key="chat-thread-screen"
                  component={motion.div}
                  custom={mobileTransitionDirection}
                  variants={mobileScreenVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={mobileScreenTransition}
                  onAnimationComplete={handleMobileThreadScreenAnimationComplete}
                  data-testid="chat-mobile-thread-screen"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    width: '100%',
                    height: '100%',
                    minHeight: 0,
                    zIndex: 2,
                    willChange: mobileMotionDisabled ? 'auto' : 'transform',
                    backfaceVisibility: 'hidden',
                  }}
                >
                  {threadPane}
                </Box>
              ) : (
                <Box
                  key="chat-inbox-screen"
                  component={motion.div}
                  custom={mobileTransitionDirection}
                  variants={mobileScreenVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={mobileScreenTransition}
                  data-testid="chat-mobile-inbox-screen"
                  sx={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    width: '100%',
                    height: '100%',
                    minHeight: 0,
                    zIndex: 1,
                    willChange: mobileMotionDisabled ? 'auto' : 'transform',
                    backfaceVisibility: 'hidden',
                  }}
                >
                  {sidebarPane}
                </Box>
              )}
            </AnimatePresence>
          </Box>
        ) : showTaskSplitLayout ? (
          <>
            <Box
              data-testid="chat-desktop-thread-pane"
              sx={{ position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex' }}
            >
              {threadPane}
            </Box>
            <Box
              data-testid="chat-desktop-task-pane"
              sx={{
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
                borderLeft: `1px solid ${ui.borderSoft}`,
                bgcolor: ui.panelSolid,
              }}
            >
              {desktopRightPanelContent}
            </Box>
          </>
        ) : (
          <>
            {sidebarPane}
            <Box sx={{ position: 'relative', minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
              {threadPane}

              {renderDesktopRightPanel && !renderPersistentRightPanel ? (
                <>
                  <Box
                    onClick={showTaskPanel ? closeTaskPanel : onCloseContextPanel}
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      bottom: 0,
                      right: 0,
                      zIndex: 6,
                      bgcolor: alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.16 : 0.08),
                      opacity: renderDesktopRightPanel ? 1 : 0,
                      pointerEvents: renderDesktopRightPanel ? 'auto' : 'none',
                      transition: `opacity ${renderDesktopRightPanel ? contextPanelEnterDuration : contextPanelExitDuration}ms ${renderDesktopRightPanel ? 'ease-out' : 'ease-in'}`,
                    }}
                  />
                  <Box
                    data-testid="chat-desktop-right-panel-overlay"
                    sx={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bottom: 0,
                      width: `min(${resolvedDesktopRightPanelWidth}px, calc(100% - 48px))`,
                      zIndex: 7,
                      borderLeft: `1px solid ${ui.borderSoft}`,
                      boxShadow: ui.shadowStrong,
                      opacity: renderDesktopRightPanel ? 1 : 0,
                      pointerEvents: renderDesktopRightPanel ? 'auto' : 'none',
                      transform: renderDesktopRightPanel ? 'translateX(0)' : 'translateX(24px)',
                      transition: `transform ${renderDesktopRightPanel ? contextPanelEnterDuration : contextPanelExitDuration}ms ${renderDesktopRightPanel ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease-in'}, opacity ${renderDesktopRightPanel ? contextPanelEnterDuration : contextPanelExitDuration}ms ${renderDesktopRightPanel ? 'ease-out' : 'ease-in'}`,
                      willChange: 'transform, opacity',
                    }}
                  >
                    <RightPanelResizeHandle
                      currentWidth={resolvedDesktopRightPanelWidth}
                      onWidthChange={onDesktopRightPanelWidthChange}
                    />
                    {desktopRightPanelContent}
                  </Box>
                </>
              ) : null}
            </Box>
            {renderPersistentRightPanel ? (
              <Box
                data-testid="chat-desktop-right-panel-persistent"
                sx={{
                  position: 'relative',
                  minWidth: 0,
                  minHeight: 0,
                  overflow: 'hidden',
                  borderLeft: `1px solid ${ui.borderSoft}`,
                  bgcolor: ui.panelSolid,
                }}
              >
                <RightPanelResizeHandle
                  currentWidth={resolvedDesktopRightPanelWidth}
                  onWidthChange={onDesktopRightPanelWidthChange}
                />
                {desktopRightPanelContent}
              </Box>
            ) : null}
          </>
        )}
      </Box>
    </Paper>
  );
}
