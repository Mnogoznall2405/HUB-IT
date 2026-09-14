import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiBotsAdminSection } from './AiBotsAdminSection';
import { AI_ITINVENT_TOOL_OPTIONS, AI_AD_TOOL_OPTIONS, AI_FILE_TOOL_OPTIONS, AI_OFFICE_TOOL_OPTIONS } from '../accountConstants';

const code = { id: 'code', title: 'OpenCode', slug: 'opencode', surface: 'sandbox', is_enabled: true, enabled_tools: [] };
const helper = { id: 'helper', title: 'Помощник', slug: 'assistant', surface: 'corporate', is_enabled: true, enabled_tools: [] };
function setup(bots = [code, helper]) {
  const onSave = vi.fn();
  const props = { bots, onSave, onCreate: vi.fn(), onRefresh: vi.fn(), loading: false, savingBotId: '', runsByBotId: {}, openrouterConfigured: true };
  return { ...render(<AiBotsAdminSection {...props} />), onSave, props };
}
describe('agent settings workspace', () => {
  it.each([
    ['Инструменты ITinvent', AI_ITINVENT_TOOL_OPTIONS[0].id],
    ['AD инструменты', AI_AD_TOOL_OPTIONS[0].id],
    ['Инструменты файлов', AI_FILE_TOOL_OPTIONS[0].id],
    ['Офисные инструменты', AI_OFFICE_TOOL_OPTIONS[0].id],
  ])('disables %s and preserves unrelated tools', (label, tool) => {
    const { onSave } = setup([{ ...helper, enabled_tools: [tool, 'mfu.devices.list'] }]);
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onSave).toHaveBeenCalledWith('helper', expect.objectContaining({ enabled_tools: ['mfu.devices.list'] }));
  });
  it('shows actual OpenCode capabilities and saves presentation fields only', () => {
    const { onSave } = setup();
    expect(screen.getByText('С подтверждением')).toBeInTheDocument();
    expect(screen.queryByLabelText('Инструменты ITinvent')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Сохранить' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Оформление' }));
    expect(screen.queryByLabelText('Модель')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Работа с файлами' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onSave).toHaveBeenCalledWith('code', { title: 'Работа с файлами', description: '' });
  });
  it('separates tools from answer settings and retains an unsaved draft across refresh', () => {
    const { props, rerender } = setup([helper]);
    expect(screen.getByLabelText('Инструменты ITinvent')).toBeInTheDocument();
    expect(screen.queryByLabelText('Модель')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки ответа' }));
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'Мой помощник' } });
    rerender(<AiBotsAdminSection {...props} bots={[{ ...helper, updated_at: 'later' }]} />);
    expect(screen.getByLabelText('Название')).toHaveValue('Мой помощник');
    expect(screen.queryByLabelText('Инструменты ITinvent')).not.toBeInTheDocument();
  });
  it('can switch off MFU and network groups without affecting other tools', () => {
    const { onSave } = setup([{ ...helper, enabled_tools: ['mfu.devices.list', 'network.socket.search', 'ai.files.create'] }]);
    fireEvent.click(screen.getByLabelText('МФУ инструменты'));
    fireEvent.click(screen.getByLabelText('Сетевые инструменты'));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(onSave).toHaveBeenCalledWith('helper', expect.objectContaining({ enabled_tools: ['ai.files.create'] }));
  });
});
