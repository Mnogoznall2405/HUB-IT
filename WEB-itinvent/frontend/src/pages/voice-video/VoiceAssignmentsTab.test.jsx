import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import VoiceAssignmentsTab from './VoiceAssignmentsTab';

vi.mock('../../api/voiceJobs', () => ({
  voiceJobsAPI: {
    getAssignments: vi.fn().mockResolvedValue({
      items: [
        { num: '1', section: 'Охрана', time: '04:59', clip: 'clip_01.mp4', task: 'Провести инструктаж', assignee: 'Иванов', deadline: '01.10.2026' },
        { num: '2', section: 'Работы', time: '10:11', clip: '', task: 'Сдать отчёт', assignee: '', deadline: '' },
      ],
    }),
    clipUrl: vi.fn().mockReturnValue('/api/v1/voice/meetings/base/clips/clip_01.mp4'),
  },
}));

vi.mock('../../api/hubTaskSupport', () => ({
  hubTaskSupportAPI: { getAssignees: vi.fn().mockResolvedValue({ items: [] }) },
}));

vi.mock('../../api/hubTasks', () => ({
  hubTasksAPI: { createTask: vi.fn().mockResolvedValue({}) },
}));

describe('VoiceAssignmentsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders assignments with continuous numbering and section headers', async () => {
    render(<VoiceAssignmentsTab base="test" />);
    await waitFor(() => {
      expect(screen.getByText('Провести инструктаж')).toBeInTheDocument();
    });
    expect(screen.getByText('Сдать отчёт')).toBeInTheDocument();
    expect(screen.getByText('Охрана')).toBeInTheDocument();
    expect(screen.getByText('Работы')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows empty state when no assignments', async () => {
    const { voiceJobsAPI } = await import('../../api/voiceJobs');
    voiceJobsAPI.getAssignments.mockResolvedValueOnce({ items: [] });
    render(<VoiceAssignmentsTab base="test2" />);
    await waitFor(() => {
      expect(screen.getByText(/нет поручений/i)).toBeInTheDocument();
    });
  });
});
