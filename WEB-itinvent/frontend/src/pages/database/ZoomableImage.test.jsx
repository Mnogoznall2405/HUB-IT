import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ZoomableImage from './ZoomableImage';

const scaleOf = () => {
  const match = /scale\(([\d.]+)\)/.exec(screen.getByRole('img').style.transform || '');
  return match ? Number(match[1]) : NaN;
};

describe('ZoomableImage', () => {
  it('zooms with the wheel up to 16x, steps with buttons and fits back to the screen', () => {
    render(<ZoomableImage src="blob:photo" alt="Фото" />);
    const frame = screen.getByTestId('zoomable-image');

    expect(scaleOf()).toBe(1);
    expect(screen.getByRole('button', { name: 'Вписать в экран' })).toBeDisabled();

    fireEvent.wheel(frame, { deltaY: -400, clientX: 10, clientY: 10 });
    const afterWheel = scaleOf();
    expect(afterWheel).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole('button', { name: 'Увеличить' }));
    expect(scaleOf()).toBeGreaterThan(afterWheel);

    for (let i = 0; i < 20; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Увеличить' }));
    expect(scaleOf()).toBe(16);
    expect(screen.getByRole('button', { name: 'Увеличить' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Вписать в экран' }));
    expect(scaleOf()).toBe(1);
  });

  it('jumps in on double click and back out on the next one, and resets for another photo', () => {
    const { rerender } = render(<ZoomableImage src="blob:a" alt="Фото" />);
    const frame = screen.getByTestId('zoomable-image');

    fireEvent.doubleClick(frame, { clientX: 5, clientY: 5 });
    expect(scaleOf()).toBe(3);
    fireEvent.doubleClick(frame);
    expect(scaleOf()).toBe(1);

    fireEvent.doubleClick(frame, { clientX: 5, clientY: 5 });
    expect(scaleOf()).toBe(3);
    rerender(<ZoomableImage src="blob:b" alt="Фото" />);
    expect(scaleOf()).toBe(1);
  });
});
