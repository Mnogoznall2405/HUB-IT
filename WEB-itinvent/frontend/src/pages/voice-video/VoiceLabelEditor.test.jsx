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
    getPeaks: vi.fn(async () => ({ step: 0.1, peaks: [10, 50, 90] })),
    getMetrics: vi.fn(async () => ({ edited: false, collar: 0.25, reference_segments: 2, items: [] })),
    createVariant: vi.fn(),
    deleteVariant: vi.fn(),
    enrollVoices: vi.fn(),
    calibrate: vi.fn(),
    getCalibration: vi.fn(async () => ({ available: false })),
    getOverallCalibration: vi.fn(async () => ({ projects: 0, suggestion: null })),
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

// jsdom: no canvas backend and no PointerEvent (fireEvent would drop clientX).
HTMLCanvasElement.prototype.getContext = () => null;
if (typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  };
}

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


describe('VoiceLabelEditor: waveform, quality and voices', () => {
  const rect = { left: 0, top: 0, width: 300, height: 96, right: 300, bottom: 96, x: 0, y: 0 };

  it('drags the end of the selected segment on the waveform as one undoable edit', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project({ has_peaks: true }));
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);
    await screen.findByText('добрый день');
    const wave = screen.getByTestId('label-waveform');
    wave.getBoundingClientRect = () => rect;

    fireEvent.click(rowOf('добрый день'));
    const endHandle = await screen.findByRole('separator', { name: 'Конец реплики' });
    // 30 s window over 300 px: x = 70 -> 7 s.
    fireEvent.pointerDown(endHandle, { clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(wave, { clientX: 70, pointerId: 1 });
    fireEvent.pointerUp(wave, { clientX: 70, pointerId: 1 });

    expect(within(rowOf('добрый день')).getByRole('button', { name: /0:00\.0–0:07\.0/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(within(rowOf('добрый день')).getByRole('button', { name: /0:00\.0–0:05\.0/ })).toBeInTheDocument();
    expect(voiceLabelingAPI.getPeaks).toHaveBeenCalledWith('p1', expect.anything());
  });

  it('shows DER per variant and queues a cleaned-audio variant', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project({ edited_at: '2026-10-02T10:00:00Z' }));
    voiceLabelingAPI.getMetrics.mockResolvedValue({
      edited: true,
      collar: 0.25,
      reference_segments: 2,
      items: [
        { name: 'auto', title: 'Черновик: сырой звук', der: 0.123, miss: 0.01, false_alarm: 0.02, confusion: 0.093, hypothesis_speakers: 3, reference_speakers: 2 },
        { name: 'kim', title: 'Очищенный звук (kim)', der: 0.2, miss: 0.05, false_alarm: 0.05, confusion: 0.1, hypothesis_speakers: 2, reference_speakers: 2 },
      ],
    });
    voiceLabelingAPI.createVariant.mockResolvedValue({
      aux_job: { id: 'j2', action: 'variant', status: 'queued', progress: 0 },
      variants: [],
    });
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);

    const table = await screen.findByRole('table', { name: 'Метрики диаризации' });
    expect(within(table).getByText('12.3%')).toBeInTheDocument();
    expect(within(table).getByText('20.0%')).toBeInTheDocument();
    expect(within(table).getByText('лучше').closest('tr')).toHaveTextContent('Черновик: сырой звук');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Эксклюзивная разметка' }));
    fireEvent.click(screen.getByRole('button', { name: 'Прогнать вариант' }));
    await waitFor(() => expect(voiceLabelingAPI.createVariant).toHaveBeenCalledWith('p1', 'kim', true));
    expect(await screen.findByText(/Диаризация варианта/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Прогнать вариант' })).toBeDisabled();
  });

  it('enrolls saved named speakers into reference voices', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project({
      speakers: { SPEAKER_00: { name: 'Иванов И.И.', user_id: 1 } },
    }));
    voiceLabelingAPI.enrollVoices.mockResolvedValue({
      aux_job: {
        id: 'j3', action: 'enroll', status: 'done',
        enroll: [{ ok: true, label: 'SPEAKER_00', name: 'Иванов И.И' }],
      },
      variants: [],
    });
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);
    await screen.findByText('добрый день');

    fireEvent.click(screen.getByRole('button', { name: 'Записать голоса в эталоны (1)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Заменить голоса, которые уже есть в эталонах' }));
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }));

    await waitFor(() => expect(voiceLabelingAPI.enrollVoices).toHaveBeenCalledWith(
      'p1', { labels: ['SPEAKER_00'], replace: true },
    ));
    expect(await screen.findByText('Иванов И.И: записан')).toBeInTheDocument();
  });

  it('blocks enrollment while there are unsaved edits', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project({
      speakers: { SPEAKER_00: { name: 'Иванов И.И.', user_id: 1 } },
    }));
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);
    await screen.findByText('начнём');
    fireEvent.click(rowOf('начнём'));
    fireEvent.keyDown(window, { key: 'Delete', code: 'Delete' });
    expect(screen.getByRole('button', { name: /Записать голоса в эталоны/ })).toBeDisabled();
  });
});


describe('VoiceLabelEditor: подбор порога узнавания', () => {
  it('запускает расчёт и показывает похожесть и рекомендацию для .env', async () => {
    voiceLabelingAPI.getProject.mockResolvedValue(project({
      speakers: { SPEAKER_00: { name: 'Иванов И.И.', user_id: 1 } },
    }));
    voiceLabelingAPI.calibrate.mockResolvedValue({
      aux_job: { id: 'j9', action: 'calibrate', status: 'done' },
      variants: [],
    });
    const suggestion = {
      positives: 2, negatives: 4, min_positive: 0.7, max_negative: 0.4, separable: true,
      current: { strict: 0.25, moderate: 0.35, loose: 0.45 },
      suggested: { strict: 0.45, moderate: 0.52, loose: 0.6, similarity: 0.55 },
    };
    voiceLabelingAPI.getCalibration
      .mockResolvedValueOnce({ available: false })
      .mockResolvedValue({
        available: true,
        embedding_mode: 'improved',
        rows: [{ label: 'SPEAKER_00', name: 'Иванов И.И.', own_similarity: 0.81, best_other: 'Петров П.П', best_other_similarity: 0.35 }],
        suggestion,
      });
    voiceLabelingAPI.getOverallCalibration.mockResolvedValue({ projects: 3, suggestion });
    render(<VoiceLabelEditor projectId="p1" onClose={() => {}} />);
    await screen.findByText('добрый день');

    fireEvent.click(screen.getByRole('button', { name: 'Посчитать похожесть с эталонами' }));
    await waitFor(() => expect(voiceLabelingAPI.calibrate).toHaveBeenCalledWith('p1'));
    const table = await screen.findByRole('table', { name: 'Похожесть с эталонами' });
    expect(within(table).getByText('81%')).toBeInTheDocument();
    expect(within(table).getByText('Петров П.П · 35%')).toBeInTheDocument();
    const env = await screen.findAllByTestId('calibration-env');
    expect(env[0]).toHaveTextContent('SPEAKER_ID_STRICT=0.45');
    expect(screen.getByText(/Разметок: 3/)).toBeInTheDocument();
  });
});
