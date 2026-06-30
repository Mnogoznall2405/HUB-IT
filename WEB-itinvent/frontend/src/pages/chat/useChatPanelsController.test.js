import { describe, expect, it } from 'vitest';

import {
  computeContextPanelDurations,
  computePanelVisibility,
  CONTEXT_PANEL_ENTER_MS,
  CONTEXT_PANEL_EXIT_MS,
} from './useChatPanelsController';

describe('computePanelVisibility', () => {
  it('hides desktop panels on mobile', () => {
    expect(computePanelVisibility({
      isMobile: true,
      contextPanelOpen: true,
      taskPanelOpen: true,
      taskPanelTaskId: 'task-1',
      hasActiveConversation: true,
    })).toEqual({
      showContextPanel: false,
      showTaskPanel: false,
      renderDesktopRightPanel: false,
      renderPersistentRightPanel: false,
    });
  });

  it('shows context panel on desktop when open', () => {
    expect(computePanelVisibility({
      isMobile: false,
      contextPanelOpen: true,
      hasActiveConversation: true,
    })).toEqual({
      showContextPanel: true,
      showTaskPanel: false,
      renderDesktopRightPanel: true,
      renderPersistentRightPanel: false,
    });
  });

  it('shows persistent right panel on wide desktop', () => {
    expect(computePanelVisibility({
      isMobile: false,
      isWideDesktop: true,
      taskPanelOpen: true,
      taskPanelTaskId: 'task-42',
      hasActiveConversation: true,
    })).toEqual({
      showContextPanel: false,
      showTaskPanel: true,
      renderDesktopRightPanel: true,
      renderPersistentRightPanel: true,
    });
  });
});

describe('computeContextPanelDurations', () => {
  it('uses configured durations by default', () => {
    expect(computeContextPanelDurations(false)).toEqual({
      contextPanelEnterDuration: CONTEXT_PANEL_ENTER_MS,
      contextPanelExitDuration: CONTEXT_PANEL_EXIT_MS,
    });
  });

  it('collapses durations when reduced motion is preferred', () => {
    expect(computeContextPanelDurations(true)).toEqual({
      contextPanelEnterDuration: 1,
      contextPanelExitDuration: 1,
    });
  });
});
