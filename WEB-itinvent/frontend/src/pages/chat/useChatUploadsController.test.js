import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import useChatUploadsController from './useChatUploadsController';

vi.mock('../../components/chat/useChatFileSending', () => ({
  default: vi.fn(() => ({
    clearSelectedFiles: vi.fn(),
    closeFileDialog: vi.fn(),
    handleSelectFiles: vi.fn(),
    openFilePicker: vi.fn(),
    openMediaPicker: vi.fn(),
    queueSelectedFiles: vi.fn(),
    removeSelectedFile: vi.fn(),
    sendFiles: vi.fn(),
  })),
}));

vi.mock('../../components/chat/useVoiceRecorder', () => ({
  default: vi.fn(() => ({
    voiceRecording: false,
    voiceRecordingDuration: 0,
    voiceRecordingLevelRef: { current: 0 },
    startVoiceRecording: vi.fn(),
    stopVoiceRecording: vi.fn(),
    cancelVoiceRecording: vi.fn(),
  })),
}));

describe('useChatUploadsController', () => {
  it('initializes upload state and exposes file sending handlers', () => {
    const fileInputRef = { current: null };
    const mediaFileInputRef = { current: null };

    const { result } = renderHook(() => useChatUploadsController({
      activeConversation: null,
      activeConversationId: '',
      applyOutgoingThreadMessage: vi.fn(),
      buildReplyPreview: vi.fn(),
      cancelPendingInitialAnchor: vi.fn(),
      createOptimisticFileMessage: vi.fn(),
      fileInputRef,
      loadChatDialogsModule: vi.fn(),
      logChatDebug: vi.fn(),
      mediaFileInputRef,
      notifyApiError: vi.fn(),
      notifyWarning: vi.fn(),
      patchThreadMessage: vi.fn(),
      removeThreadMessage: vi.fn(),
      replyMessage: null,
      revokeObjectUrls: vi.fn(),
      setComposerMenuAnchor: vi.fn(),
      setEmojiAnchorEl: vi.fn(),
      setOptimisticAiQueuedStatus: vi.fn(),
      setReplyMessage: vi.fn(),
      setThreadMenuAnchor: vi.fn(),
    }));

    expect(result.current.fileDialogOpen).toBe(false);
    expect(result.current.selectedFiles).toEqual([]);
    expect(result.current.fileDragActive).toBe(false);
    expect(typeof result.current.openFilePicker).toBe('function');
    expect(typeof result.current.handleComposerPaste).toBe('function');
  });
});
