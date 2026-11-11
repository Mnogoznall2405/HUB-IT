import { describe, expect, it, vi } from 'vitest';
import { getDesktopOfficeOpenLabel, openOriginalWithDesktopApplication } from './desktopOfficeOpen';

describe('desktopOfficeOpen', () => {
  it('names the Windows handler for Word, Excel and PowerPoint', () => {
    expect(getDesktopOfficeOpenLabel('word')).toBe('Открыть в Word');
    expect(getDesktopOfficeOpenLabel('excel')).toBe('Открыть в Excel');
    expect(getDesktopOfficeOpenLabel('presentation')).toBe('Открыть в PowerPoint');
    expect(getDesktopOfficeOpenLabel('pdf')).toBe('Открыть в приложении');
  });

  it('opens the original only after Desktop accepts the next download', async () => {
    const onDownload = vi.fn().mockResolvedValue();
    const requestOpen = vi.fn().mockResolvedValue({ accepted: true, status: 'accepted' });

    await expect(openOriginalWithDesktopApplication({
      isDesktop: () => true,
      requestOpen,
      onDownload,
    })).resolves.toEqual({ accepted: true, status: 'accepted' });

    expect(requestOpen).toHaveBeenCalledWith('open');
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('does not download when Desktop rejects the open intent', async () => {
    const onDownload = vi.fn();
    await expect(openOriginalWithDesktopApplication({
      isDesktop: () => true,
      requestOpen: async () => ({ accepted: false, status: 'busy' }),
      onDownload,
    })).resolves.toEqual({ accepted: false, status: 'busy' });
    expect(onDownload).not.toHaveBeenCalled();
  });
});
