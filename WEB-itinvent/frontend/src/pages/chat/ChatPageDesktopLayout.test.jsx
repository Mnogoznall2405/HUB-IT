import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    div: React.forwardRef(({ children, ...props }, ref) => (
      <div ref={ref} {...props}>{children}</div>
    )),
  },
}));

import ChatPageDesktopLayout from './ChatPageDesktopLayout';

const ui = {
  density: { sidebarColumnMin: 280, sidebarColumnMax: 360 },
  borderSoft: 'rgba(0,0,0,0.12)',
  desktopShellBorder: 'rgba(0,0,0,0.08)',
  threadBg: '#fafafa',
  panelBg: '#ffffff',
  panelSolid: '#ffffff',
  shadowStrong: '0 8px 24px rgba(0,0,0,0.12)',
};

const mobileScreenVariants = {
  enter: { x: '100%' },
  center: { x: 0 },
  exit: { x: '-30%' },
};

function renderLayout(overrides = {}) {
  const theme = createTheme();
  return render(
    <ThemeProvider theme={theme}>
      <ChatPageDesktopLayout
        isMobile={false}
        isPhone={false}
        ui={ui}
        theme={theme}
        sidebarPane={<div data-testid="chat-sidebar-slot">Sidebar</div>}
        threadPane={<div data-testid="chat-thread-slot">Thread</div>}
        desktopRightPanelContent={<div data-testid="chat-right-panel-slot">Panel</div>}
        renderDesktopRightPanel={false}
        renderPersistentRightPanel={false}
        showTaskPanel={false}
        closeTaskPanel={() => {}}
        onCloseContextPanel={() => {}}
        contextPanelEnterDuration={220}
        contextPanelExitDuration={180}
        resolvedMobileView="inbox"
        mobileTransitionDirection={1}
        mobileMotionDisabled={false}
        mobileScreenVariants={mobileScreenVariants}
        mobileScreenTransition={{ duration: 0.28 }}
        handleMobileThreadScreenAnimationComplete={() => {}}
        {...overrides}
      />
    </ThemeProvider>,
  );
}

describe('ChatPageDesktopLayout', () => {
  it('renders sidebar and thread slots on desktop', () => {
    renderLayout();

    expect(screen.getByTestId('chat-sidebar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('chat-thread-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-mobile-inbox-screen')).not.toBeInTheDocument();
  });

  it('renders mobile inbox screen with sidebar slot', () => {
    renderLayout({ isMobile: true, isPhone: true, resolvedMobileView: 'inbox' });

    expect(screen.getByTestId('chat-mobile-inbox-screen')).toBeInTheDocument();
    expect(screen.getByTestId('chat-sidebar-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-mobile-thread-screen')).not.toBeInTheDocument();
  });

  it('renders mobile thread screen with thread slot', () => {
    renderLayout({ isMobile: true, isPhone: true, resolvedMobileView: 'thread' });

    expect(screen.getByTestId('chat-mobile-thread-screen')).toBeInTheDocument();
    expect(screen.getByTestId('chat-thread-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-mobile-inbox-screen')).not.toBeInTheDocument();
  });

  it('renders desktop right panel overlay when requested', () => {
    renderLayout({ renderDesktopRightPanel: true });

    expect(screen.getByTestId('chat-desktop-right-panel-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('chat-right-panel-slot')).toBeInTheDocument();
  });

  it('renders persistent right panel column on wide desktop', () => {
    renderLayout({ renderPersistentRightPanel: true, renderDesktopRightPanel: true });

    expect(screen.getByTestId('chat-desktop-right-panel-persistent')).toBeInTheDocument();
    expect(screen.getByTestId('chat-right-panel-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-desktop-right-panel-overlay')).not.toBeInTheDocument();
  });
});
