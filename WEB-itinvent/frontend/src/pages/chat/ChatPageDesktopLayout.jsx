import { Box, Paper } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';

export default function ChatPageDesktopLayout({
  isMobile,
  isPhone,
  ui,
  theme,
  sidebarPane,
  threadPane,
  desktopRightPanelContent,
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
  const resolvedGridTemplateColumns = gridTemplateColumns ?? (
    renderPersistentRightPanel
      ? `minmax(${ui.density.sidebarColumnMin}px, ${ui.density.sidebarColumnMax}px) minmax(0, 1fr) clamp(460px, 38vw, 620px)`
      : `minmax(${ui.density.sidebarColumnMin}px, ${ui.density.sidebarColumnMax}px) minmax(0, 1fr)`
  );

  return (
    <Paper
      elevation={0}
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: isPhone ? 0 : 1.5,
        border: isPhone ? 'none' : `1px solid ${ui.desktopShellBorder || ui.borderSoft}`,
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
                      width: 'min(620px, calc(100% - 48px))',
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
                    {desktopRightPanelContent}
                  </Box>
                </>
              ) : null}
            </Box>
            {renderPersistentRightPanel ? (
              <Box
                data-testid="chat-desktop-right-panel-persistent"
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
            ) : null}
          </>
        )}
      </Box>
    </Paper>
  );
}
