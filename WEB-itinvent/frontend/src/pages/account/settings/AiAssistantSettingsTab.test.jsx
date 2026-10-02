import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getAiMemory: vi.fn(),
  updateAiMemorySettings: vi.fn(),
  deleteAiMemoryItem: vi.fn(),
  clearAiMemory: vi.fn(),
  updateAiMemoryItem: vi.fn(),
}));
vi.mock('../../../api/client', () => ({ chatAPI: api }));

import AiAssistantSettingsTab from './AiAssistantSettingsTab';

describe('AiAssistantSettingsTab (personal memory in settings)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAiMemory.mockResolvedValue({
      enabled: true,
      items: [
        { id: 'a', content: 'Отвечай кратко', category: 'preference' },
        { id: 'b', content: 'Обслуживаю принтеры Canon', category: 'work_context' },
      ],
      limits: {},
    });
    api.deleteAiMemoryItem.mockResolvedValue({ ok: true });
    api.clearAiMemory.mockResolvedValue({ ok: true });
    api.updateAiMemorySettings.mockResolvedValue({ enabled: false });
  });

  it('lists the remembered facts and deletes one', async () => {
    render(<AiAssistantSettingsTab />);
    expect(await screen.findByText('Отвечай кратко')).toBeInTheDocument();
    expect(screen.getByText(/Сохранено фактов: 2/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByLabelText('Удалить факт памяти')[0]);
    await waitFor(() => expect(api.deleteAiMemoryItem).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(screen.queryByText('Отвечай кратко')).not.toBeInTheDocument());
  });

  it('clears everything after confirmation and switches the memory off', async () => {
    render(<AiAssistantSettingsTab />);
    await screen.findByText('Отвечай кратко');
    fireEvent.click(screen.getByRole('button', { name: /Очистить всю память/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Очистить' }));
    await waitFor(() => expect(api.clearAiMemory).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByLabelText('Использовать личную память'));
    await waitFor(() => expect(api.updateAiMemorySettings).toHaveBeenCalledWith(false));
  });
});
