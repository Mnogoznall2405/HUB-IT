import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { listFiles, listFolders, loadFile } = vi.hoisted(() => ({ listFiles: vi.fn(), listFolders: vi.fn(), loadFile: vi.fn() }));
vi.mock('../../api/myFiles', () => ({ myFilesAPI: { listFiles, listFolders } }));
vi.mock('../../api/chatSandboxFiles', () => ({ loadSandboxInputFile: loadFile, SANDBOX_INPUT_MAX_BYTES: 256 * 1024 * 1024 }));
import OpenCodeMyFilesPicker from './OpenCodeMyFilesPicker';
describe('OpenCodeMyFilesPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFiles.mockResolvedValue({ items: [{ id: 'f1', download_file_name: 'report.txt', status: 'ready', original_size_bytes: 3 }] });
    listFolders.mockResolvedValue({ items: [] });
    loadFile.mockResolvedValue(new File(['abc'], 'report.txt'));
  });
  it('adds a selected file to the existing composer only after a click', async () => {
    const select = vi.fn();
    render(<OpenCodeMyFilesPicker onSelectFiles={select} />);
    expect(listFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Добавить в OpenCode из Моих файлов'));
    fireEvent.click(await screen.findByRole('button', { name: 'report.txt' }));
    await waitFor(() => expect(select).toHaveBeenCalledTimes(1));
    expect(select.mock.calls[0][0].target.files[0].name).toBe('report.txt');
  });
  it('aborts a download when its conversation unmounts and does not deliver late data', async () => {
    let finish;
    loadFile.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const select = vi.fn();
    const view = render(<OpenCodeMyFilesPicker onSelectFiles={select} />);
    fireEvent.click(screen.getByText('Добавить в OpenCode из Моих файлов'));
    fireEvent.click(await screen.findByRole('button', { name: 'report.txt' }));
    const signal = loadFile.mock.calls[0][1].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    finish(new File(['abc'], 'report.txt'));
    await Promise.resolve();
    expect(select).not.toHaveBeenCalled();
  });
});
