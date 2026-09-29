import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import VoiceTrendsStrip from './VoiceTrendsStrip';

describe('VoiceTrendsStrip', () => {
  it('renders summary chips and weekly caption', () => {
    render(
      <VoiceTrendsStrip
        jobs={[
          { id: '1', status: 'done', created_at: new Date().toISOString() },
          { id: '2', status: 'failed', created_at: new Date().toISOString() },
        ]}
        overview={{ meetings_count: 7 }}
        queue={{ queued: 1, processing: 0 }}
      />,
    );
    expect(screen.getByText('Сводка')).toBeInTheDocument();
    expect(screen.getByText('Встреч: 7')).toBeInTheDocument();
    expect(screen.getByText('Готово: 1')).toBeInTheDocument();
    expect(screen.getByText('Ошибок: 1')).toBeInTheDocument();
    expect(screen.getByText(/последние 8 недель/)).toBeInTheDocument();
  });

  it('renders nothing without data', () => {
    const { container } = render(<VoiceTrendsStrip jobs={[]} overview={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
