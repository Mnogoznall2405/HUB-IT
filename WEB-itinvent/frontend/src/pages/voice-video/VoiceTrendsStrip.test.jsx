import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import VoiceTrendsStrip from './VoiceTrendsStrip';

const desktopMatchMedia = (matches) => (query) => ({
  matches,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

let originalMatchMedia;

afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
});

describe('VoiceTrendsStrip', () => {
  it('keeps the summary chips in one row and keeps the weekly chart collapsed (T21)', () => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = desktopMatchMedia(false);

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

    const chartToggle = screen.getByRole('button', { name: 'Задачи по неделям' });
    expect(chartToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/последние 8 недель/)).not.toBeInTheDocument();

    fireEvent.click(chartToggle);

    expect(chartToggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/последние 8 недель/)).toBeInTheDocument();
  });

  it('renders summary chips and weekly caption', () => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = desktopMatchMedia(false);

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
    fireEvent.click(screen.getByRole('button', { name: 'Задачи по неделям' }));
    expect(screen.getByText(/последние 8 недель/)).toBeInTheDocument();
  });

  it('renders nothing without data', () => {
    const { container } = render(<VoiceTrendsStrip jobs={[]} overview={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lets summary chips wrap instead of an inner horizontal scroller (N16)', () => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: /max-width:\s*599/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
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

    const strip = screen.getByText('Сводка').closest('.MuiBox-root');
    const style = window.getComputedStyle(strip);
    expect(style.flexWrap).toBe('wrap');
    expect(style.overflowX).not.toBe('auto');
  });

  it('on mobile hides the weekly chart and shows no false zero before jobs load', () => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = (query) => ({
      matches: /max-width:\s*599/.test(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
    render(
      <VoiceTrendsStrip
        jobs={[]}
        jobsLoaded={false}
        overview={{ meetings_count: 3 }}
      />,
    );

    expect(screen.getByText('Встреч: 3')).toBeInTheDocument();
    expect(screen.getByText('Готово: —')).toBeInTheDocument();
    expect(screen.queryByText(/последние 8 недель/)).not.toBeInTheDocument();
  });

  it('T45: чипы «Ошибок» и «В очереди» кликабельны — ведут в «Задачи» с фильтром', () => {
    originalMatchMedia = window.matchMedia;
    window.matchMedia = desktopMatchMedia(false);
    const onJobsFilter = vi.fn();

    render(
      <VoiceTrendsStrip
        jobs={[
          { id: '1', status: 'done', created_at: new Date().toISOString() },
          { id: '2', status: 'failed', created_at: new Date().toISOString() },
        ]}
        queue={{ queued: 2, processing: 1 }}
        onJobsFilter={onJobsFilter}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Показать задачи с ошибками/ }));
    expect(onJobsFilter).toHaveBeenCalledWith('failed');

    fireEvent.click(screen.getByRole('button', { name: /Показать задачи в очереди/ }));
    expect(onJobsFilter).toHaveBeenCalledWith('queued');
  });
});
