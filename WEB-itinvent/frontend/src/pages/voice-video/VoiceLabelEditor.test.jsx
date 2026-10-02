import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import VoiceLabelEditor from './VoiceLabelEditor';
import VoiceLabelingSection from './VoiceLabelingSection';
import { voiceLabelingAPI } from '../../api/voiceLabeling';

vi.mock('../../api/voiceLabeling', () => ({
  voiceLabelingAPI: {
    listProjects: vi.fn(),
    getProject: vi.fn(),
    saveProject: vi.fn(),
    createProject: vi.fn(),
    retryProject: vi.fn(),
    deleteProject: vi.fn(),
    mediaUrl: vi.fn((id) => `/api/v1/voice/labeling/projects/${id}/media`),
    rttmUrl: vi.fn((id) => `/api/v1/voice/labeling/projects/${id}/rttm`),
  },
}));

vi.mock('../../api/hubTaskSupport', () => ({
  hubTaskSupportAPI: { getAssignees: vi.fn(async () => ({ items: [] })) },
}));

const project = (over = {}) => ({
  id: 'p1',
  title: 'Планёрка',
  status: 'ready',
  duration: 30,
  version: 3,
  media_kind: 'audio',
  speakers: {},
  segments: [
    { id: 's1', start: 0, end: 5, speaker: 'SPEAKER_00', text: 'добрый день' },
    { id: 's2', start: 5, end: 9, speaker: 'SPEAKER_01', text: 'начнём' },
  ],
  ...over,
});

const rowOf = (text) => screen.getByText(text).closest('[data-seg-id]');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VoiceLabelEditor', () => {
  it('reassigns a speaker with a digit key and saves with the loaded version', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project());
    voiceLabelingAPI.saveProject.mockImplementation(async (_id, payload) => ({
      ...project(), ...payload, version: 4,
    }));
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);

    await screen.findByText('добрый день');
    fireEvent.click(rowOf('начнём'));
    fireEvent.keyDown(window, { key: '1', code: 'Digit1' });

    expect(within(rowOf('начнём')).getByText('SPEAKER_00')).toBeInTheDocument();
    expect(screen.getByText('Есть несохранённые изменения')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    await waitFor(() => expect(voiceLabelingAPI.saveProject).toHaveBeenCalledTimes(1));
    const [, payload] = voiceLabelingAPI.saveProject.mock.calls[0];
    expect(payload.version).toBe(3);
    expect(payload.segments.map((s) => s.speaker)).toEqual(['SPEAKER_00', 'SPEAKER_00']);
    await screen.findByText(/Сохранено/);
  });

  it('undoes the last edit with Ctrl+Z', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project());
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);
    await screen.findByText('начнём');

    fireEvent.click(rowOf('начнём'));
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });
    expect(screen.queryByText('начнём')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(screen.getByText('начнём')).toBeInTheDocument();
  });

  it('shows a conflict banner when the save is rejected with 409', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project());
    voiceLabelingAPI.saveProject.mockRejectedValue({
      response: { status: 409, data: { detail: 'Разметку уже изменили' } },
    });
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);
    await screen.findByText('начнём');

    fireEvent.click(rowOf('начнём'));
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    expect(await screen.findByText(/Разметку уже изменили/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Загрузить заново' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  });

  it('merges one speaker label into another from the speakers panel', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project());
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);
    await screen.findByText('начнём');

    fireEvent.click(screen.getByRole('button', { name: 'Объединить SPEAKER_01' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'SPEAKER_00' }));

    expect(within(rowOf('начнём')).getByText('SPEAKER_00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Объединить SPEAKER_01' })).not.toBeInTheDocument();
  });
});

describe('VoiceLabelingSection', () => {
  it('lists projects with status and opens the editor for a ready one', async () => {
    voiceLabelingAPI.listProjects.mockResolvedValue({
      items: [
        { id: 'p1', title: 'Планёрка', status: 'ready', duration: 600, speakers: { SPEAKER_00: { name: 'Иванов' } } },
        { id: 'p2', title: 'Совет', status: 'processing', job: { progress: 55 } },
        { id: 'p3', title: 'Сбой', status: 'failed', error: 'нет звука' },
      ],
    });
    voiceLabelingAPI.getProject.mockResolvedValue(project());
    render(<VoiceLabelingSection />);

    expect(await screen.findByText('Планёрка')).toBeInTheDocument();
    expect(screen.getByText('Строится черновик')).toBeInTheDocument();
    expect(screen.getByText('нет звука')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Разметить' }));
    expect(await screen.findByText('добрый день')).toBeInTheDocument();
    expect(voiceLabelingAPI.getProject).toHaveBeenCalledWith('p1');
  });
});
