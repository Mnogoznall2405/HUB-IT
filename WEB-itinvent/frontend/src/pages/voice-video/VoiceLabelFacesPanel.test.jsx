import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VoiceLabelFacesPanel from './VoiceLabelFacesPanel';
import { voiceLabelingAPI } from '../../api/voiceLabeling';

vi.mock('../../api/voiceLabeling', () => ({
  voiceLabelingAPI: {
    getFaces: vi.fn(),
    scanFaces: vi.fn(),
    enrollFaces: vi.fn(),
    purgeFaces: vi.fn(),
    faceThumbUrl: vi.fn((id, faceId) => `/thumb/${id}/${faceId}`),
  },
}));

const faces = (over = {}) => ({
  is_video: true,
  available: true,
  faces_total: 6,
  people: ['Иванов Иван Иванович'],
  clusters: [
    { id: 0, count: 3, shown: [0, 1, 2], first_t: 65, voices: [{ label: 'SPEAKER_00', name: 'Иванов Иван Иванович', share: 0.8 }] },
    { id: 1, count: 3, shown: [3, 4, 5], first_t: 120, voices: [] },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VoiceLabelFacesPanel', () => {
  it('signs a person by the voice chip, drops a wrong face and sends only the signed clusters', async () => {
    voiceLabelingAPI.getFaces.mockResolvedValue(faces());
    voiceLabelingAPI.enrollFaces.mockResolvedValue({ aux_job: { action: 'faces_enroll', status: 'queued' } });
    const onProjectUpdate = vi.fn();
    const { container } = render(<VoiceLabelFacesPanel projectId="p1" auxJob={null} onProjectUpdate={onProjectUpdate} />);

    fireEvent.click(await screen.findByText('Иванов Иван Иванович 80%'));
    expect(screen.getByLabelText('ФИО кластера 1')).toHaveValue('Иванов Иван Иванович');
    fireEvent.click(container.querySelector('img[src="/thumb/p1/1"]'));
    fireEvent.click(screen.getByRole('button', { name: /Записать в эталоны лиц \(1\)/ }));

    await waitFor(() => expect(voiceLabelingAPI.enrollFaces).toHaveBeenCalledTimes(1));
    expect(voiceLabelingAPI.enrollFaces).toHaveBeenCalledWith('p1', {
      assign: { 0: { name: 'Иванов Иван Иванович', delete: false, excluded: [1] } },
      purge: true,
    });
    expect(onProjectUpdate).toHaveBeenCalled();
  });

  it('cannot enroll until somebody is signed, and a "not a person" cluster is not counted', async () => {
    voiceLabelingAPI.getFaces.mockResolvedValue(faces());
    render(<VoiceLabelFacesPanel projectId="p1" auxJob={null} onProjectUpdate={vi.fn()} />);

    const enroll = await screen.findByRole('button', { name: /Записать в эталоны лиц/ });
    expect(enroll).toBeDisabled();
    fireEvent.click(screen.getAllByLabelText('Не человек')[1]);
    expect(enroll).toBeDisabled();
  });

  it('shows nothing for an audio-only recording', async () => {
    voiceLabelingAPI.getFaces.mockResolvedValue({ is_video: false, available: false, clusters: [], people: [] });
    const { container } = render(<VoiceLabelFacesPanel projectId="p1" auxJob={null} onProjectUpdate={vi.fn()} />);
    await waitFor(() => expect(voiceLabelingAPI.getFaces).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('starts the face search and shows what was written after enrolling', async () => {
    voiceLabelingAPI.getFaces.mockResolvedValue(faces({ available: false, clusters: [] }));
    voiceLabelingAPI.scanFaces.mockResolvedValue({ aux_job: { action: 'faces_scan', status: 'queued' } });
    const onProjectUpdate = vi.fn();
    const { rerender } = render(<VoiceLabelFacesPanel projectId="p1" auxJob={null} onProjectUpdate={onProjectUpdate} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Найти лица на видео' }));
    await waitFor(() => expect(voiceLabelingAPI.scanFaces).toHaveBeenCalledWith('p1'));

    rerender(
      <VoiceLabelFacesPanel
        projectId="p1"
        auxJob={{ id: 'j2', action: 'faces_enroll', status: 'done', enroll: [{ ok: true, name: 'Иванов Иван Иванович', faces: 12 }] }}
        onProjectUpdate={onProjectUpdate}
      />,
    );
    expect(await screen.findByText(/Записано в эталоны лиц: Иванов Иван Иванович \(12\)/)).toBeInTheDocument();
  });
});
