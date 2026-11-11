import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConstructionPersonLink from './ConstructionPersonLink';

const member = { employee_code: 'E-1', full_name: 'Иванов Иван Иванович', role_key: 'project_lead', position: 'Руководитель проекта', department: 'ПТО' };
const search = vi.hoisted(() => vi.fn());
vi.mock('../../api/addressBook', () => ({ addressBookAPI: { search } }));
beforeEach(() => { search.mockReset().mockResolvedValue({ items: [] }); });

describe('ConstructionPersonLink', () => {
  it('loads only when opened and shows corporate contacts of the exact employee, without personal fallback', async () => {
    search.mockResolvedValue({ items: [
      { employee_code: 'E-2', full_name: member.full_name, work_emails: [{ value: 'other@example.test' }] },
      { employee_code: member.employee_code, work_emails: [{ value: 'work@example.test', kind: 'Корпоративная' }], work_phones: [{ value: '+7 900 123-45-67', kind: 'Рабочий' }], personal_emails: [{ value: 'private@example.test' }], personal_phones: [{ value: '+7 999 999-99-99' }] },
    ] });
    render(<ConstructionPersonLink member={member} />);
    expect(search).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: member.full_name }));
    expect(await screen.findByRole('link', { name: 'work@example.test' })).toHaveAttribute('href', 'mailto:work%40example.test');
    expect(screen.getByRole('link', { name: '+7 900 123-45-67' })).toHaveAttribute('href', 'tel:+79001234567');
    expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('other@example.test')).not.toBeInTheDocument();
    expect(screen.queryByText('+7 999 999-99-99')).not.toBeInTheDocument();
    expect(search).toHaveBeenCalledWith({ q: 'E-1', limit: 200 });
  });

  it('does not substitute personal contacts when corporate contacts are absent and supports retry', async () => {
    search.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [{ employee_code: member.employee_code, personal_emails: [{ value: 'private@example.test' }] }] });
    render(<ConstructionPersonLink member={member} />);
    fireEvent.click(screen.getByRole('button', { name: member.full_name }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось загрузить');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findAllByText('Не указаны в адресной книге')).toHaveLength(2);
    expect(screen.queryByText('private@example.test')).not.toBeInTheDocument();
  });
  it('opens the employee card, closes with Escape and restores focus for reopening', async () => {
    render(<ConstructionPersonLink member={member} />);
    const trigger = screen.getByRole('button', { name: member.full_name });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: member.full_name });
    expect(within(dialog).getByText('ПТО')).toBeVisible();
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: member.full_name })).toBeVisible();
  });

  it('does not offer an empty card and closes the previous card after reassignment', async () => {
    const { rerender } = render(<ConstructionPersonLink member={member} />);
    fireEvent.click(screen.getByRole('button', { name: member.full_name }));
    rerender(<ConstructionPersonLink member={{ ...member, employee_code: 'E-2', full_name: 'Петров Пётр Петрович' }} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Петров Пётр Петрович' }));
    expect(screen.getByRole('dialog', { name: 'Петров Пётр Петрович' })).toBeVisible();
    rerender(<ConstructionPersonLink />);
    expect(screen.getByText('Не назначен')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
