import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { createAudioPlayer } from 'expo-audio';
import { ChatVoiceNote } from './ChatVoiceNote';

jest.mock('../../files/nativeAttachmentDownloads', () => ({
  downloadChatAttachment: jest.fn(async () => ({ uri: 'file:///cache/voice.m4a' })),
}));

describe('ChatVoiceNote', () => {
  it('pauses playback instead of resetting and seeks along the waveform', async () => {
    const player = {
      play: jest.fn(),
      pause: jest.fn(),
      remove: jest.fn(),
      seekTo: jest.fn(async () => undefined),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      playing: false,
      currentTime: 0,
      duration: 12,
    };
    (createAudioPlayer as jest.Mock).mockReturnValueOnce(player);

    const screen = await render(
      <ChatVoiceNote
        isOwn={false}
        attachment={{
          id: 'voice-1',
          kind: 'audio',
          file_name: 'voice_1.m4a',
          mime_type: 'audio/mp4',
          duration_seconds: 12,
        }}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Воспроизвести голосовое сообщение 0:12'));
    await waitFor(() => expect(player.play).toHaveBeenCalled());
    expect(screen.getByLabelText(/Пауза голосового сообщения/)).toBeTruthy();

    await fireEvent.press(screen.getByLabelText(/Пауза голосового сообщения/));
    expect(player.pause).toHaveBeenCalled();
    expect(player.seekTo).not.toHaveBeenCalled();

    await fireEvent(screen.getByLabelText('Прогресс воспроизведения'), 'layout', {
      nativeEvent: { layout: { width: 80, height: 24 } },
    });
    await fireEvent.press(screen.getByLabelText('Прогресс воспроизведения'), {
      nativeEvent: { locationX: 40 },
    });
    await waitFor(() => expect(player.seekTo).toHaveBeenCalledWith(6));
  });
});
