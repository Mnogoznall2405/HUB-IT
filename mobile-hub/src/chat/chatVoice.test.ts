import {
  buildVoiceWaveform,
  formatVoiceDuration,
  isAudioChatAttachment,
  isChatVoiceSurfaceLocked,
  isVoiceWaveformBarFilled,
  lockChatVoiceSurface,
  meteringToVoiceLevel,
  normalizeVoiceDurationSeconds,
  recordingBarHeightPx,
  resolveChatBubbleTapAction,
  resolveVoiceHoldGesture,
  resolveVoiceMicRelease,
  resolveVoiceRecordingLevel,
  voiceHoldHintLabel,
  shouldTreatAsDoubleTap,
  unlockChatVoiceSurface,
  voiceFileName,
  voicePlaybackProgress,
  voiceSeekRatio,
} from './chatVoice';

describe('native chat voice helpers', () => {
  afterEach(() => {
    while (isChatVoiceSurfaceLocked()) unlockChatVoiceSurface();
  });

  it('detects audio attachments from kind, mime and voice file name', () => {
    expect(isAudioChatAttachment({ id: '1', kind: 'audio' })).toBe(true);
    expect(isAudioChatAttachment({ id: '2', mime_type: 'audio/mp4' })).toBe(true);
    expect(isAudioChatAttachment({ id: '3', file_name: 'voice_123.m4a' })).toBe(true);
    expect(isAudioChatAttachment({ id: '4', kind: 'image' })).toBe(false);
    expect(isAudioChatAttachment({
      id: '5',
      kind: 'audio',
      media_kind: 'file',
      mime_type: 'audio/mpeg',
      file_name: 'podcast.mp3',
    })).toBe(false);
  });

  it('formats and clamps voice duration for the existing files_meta_json contract', () => {
    expect(formatVoiceDuration(7)).toBe('0:07');
    expect(formatVoiceDuration(75)).toBe('1:15');
    expect(normalizeVoiceDurationSeconds(0)).toBe(1);
    expect(normalizeVoiceDurationSeconds(12.4)).toBe(12);
    expect(voiceFileName(1700000000000)).toBe('voice_1700000000000.m4a');
  });

  it('treats a second tap inside the Telegram-like window as a double tap', () => {
    expect(shouldTreatAsDoubleTap(1000, 1200)).toBe(true);
    expect(shouldTreatAsDoubleTap(1000, 1400)).toBe(false);
    expect(shouldTreatAsDoubleTap(0, 1200)).toBe(false);
  });

  it('opens the message menu on the first tap and reacts only on the second', () => {
    expect(resolveChatBubbleTapAction({
      hasQuickReaction: true,
      previousTapAt: 0,
      now: 1000,
    })).toBe('menu');
    expect(resolveChatBubbleTapAction({
      hasQuickReaction: true,
      previousTapAt: 1000,
      now: 1180,
    })).toBe('quick-reaction');
    expect(resolveChatBubbleTapAction({
      selected: true,
      hasQuickReaction: true,
      previousTapAt: 1000,
      now: 1180,
    })).toBe('menu');
  });

  it('maps recorder metering and keeps a stable playback waveform', () => {
    expect(meteringToVoiceLevel(-50)).toBe(0);
    expect(meteringToVoiceLevel(0)).toBe(1);
    expect(meteringToVoiceLevel(-25)).toBe(0.5);
    expect(resolveVoiceRecordingLevel(undefined, 0)).toBeGreaterThan(0);
    expect(buildVoiceWaveform('voice-1')).toHaveLength(32);
    expect(buildVoiceWaveform('voice-1')).toEqual(buildVoiceWaveform('voice-1'));
    expect(buildVoiceWaveform('voice-1')[0]).not.toBe(buildVoiceWaveform('voice-2')[0]);
    expect(voicePlaybackProgress(4, 8)).toBe(0.5);
    expect(isVoiceWaveformBarFilled(0.5, 15, 32)).toBe(true);
    expect(isVoiceWaveformBarFilled(0.5, 16, 32)).toBe(false);
    expect(voiceSeekRatio(40, 80)).toBe(0.5);
    expect(recordingBarHeightPx(0, 0.5)).toBeGreaterThan(3);
    expect(recordingBarHeightPx(1, 0.9)).toBeLessThanOrEqual(26);
  });

  it('locks bubble swipe while the voice waveform is being dragged', () => {
    expect(isChatVoiceSurfaceLocked()).toBe(false);
    lockChatVoiceSurface();
    expect(isChatVoiceSurfaceLocked()).toBe(true);
    unlockChatVoiceSurface();
    expect(isChatVoiceSurfaceLocked()).toBe(false);
  });

  it('treats a short tap as lock and a left slide as cancel', () => {
    expect(resolveVoiceHoldGesture(-80, 4)).toBe('cancel');
    expect(resolveVoiceHoldGesture(8, -60)).toBe('lock');
    expect(resolveVoiceHoldGesture(-10, 2)).toBe('record');
    expect(resolveVoiceMicRelease({ heldMs: 80, dx: 0, dy: 0 })).toBe('lock');
    expect(resolveVoiceMicRelease({ heldMs: 800, dx: -80, dy: 0 })).toBe('cancel');
    expect(resolveVoiceMicRelease({ heldMs: 800, dx: 0, dy: 0 })).toBe('send');
    expect(resolveVoiceMicRelease({ heldMs: 300, dx: 0, dy: 0 })).toBe('cancel');
    expect(voiceHoldHintLabel('cancel')).toMatch(/отменить/i);
  });
});
