import React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VoiceLogViewer from './VoiceLogViewer';

describe('VoiceLogViewer: auto-scroll accessibility (T15)', () => {
  it('announces auto-scroll state and exposes it as a pressed toggle', () => {
    render(
      <VoiceLogViewer
        open
        onClose={() => {}}
        jobId="job-1"
        logText="processing"
        loading={false}
      />,
    );

    const enabledButton = screen.getByRole('button', { name: 'Автопрокрутка включена' });
    expect(enabledButton).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(enabledButton);

    const disabledButton = screen.getByRole('button', { name: 'Автопрокрутка выключена' });
    expect(disabledButton).toHaveAttribute('aria-pressed', 'false');
  });
});
