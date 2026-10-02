import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddressBookEntryList from './AddressBookEntryList';
import { getEntryKey } from './addressBookUtils';

const setMatchMedia = (matches = false) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: typeof matches === 'function' ? matches(query) : matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const items = [
  {
    full_name: 'Alpha One',
    department: 'Dept A',
    position: 'Engineer',
    work_phones: [{ kind: 'Рабочий телефон', value: '83452384202', normalized: '73452384202' }],
    work_emails: [{ value: 'alpha@example.com' }],
  },
  {
    full_name: 'Bravo Two',
    department: 'Dept B',
    position: 'Manager',
    work_phones: [{ kind: 'Рабочий телефон', value: '83450000000', normalized: '73450000000' }],
    work_emails: [],
  },
  {
    full_name: 'Charlie Three',
    department: 'Dept C',
    position: 'Lead',
    work_phones: [],
    work_emails: [],
  },
];

const rows = () => screen.getAllByTestId(/^address-book-entry-row-/);

describe('AddressBookEntryList', () => {
  beforeEach(() => {
    setMatchMedia(false);
  });

  it('renders a labelled list with listitem rows', () => {
    render(<AddressBookEntryList items={items} />);

    const list = screen.getByRole('list', { name: 'Сотрудники' });
    const listItems = screen.getAllByRole('listitem');

    expect(list).toBeInTheDocument();
    expect(listItems).toHaveLength(3);
    listItems.forEach((row) => {
      expect(row.parentElement).toBe(list);
    });
  });

  it('keeps one tab stop on the active row and its actions', () => {
    render(<AddressBookEntryList items={items} />);

    const rowNodes = rows();
    expect(rowNodes.filter((row) => row.getAttribute('tabindex') === '0')).toHaveLength(1);
    expect(rowNodes[0]).toHaveAttribute('tabindex', '0');
    expect(rowNodes[1]).toHaveAttribute('tabindex', '-1');
    expect(rowNodes[2]).toHaveAttribute('tabindex', '-1');

    const activeRow = rowNodes[0].parentElement;
    expect(activeRow.querySelector('[aria-label="Открыть Telegram 83452384202"]'))
      .toHaveAttribute('tabindex', '0');
    expect(activeRow.querySelector('[aria-label="Новое письмо в HUB alpha@example.com"]'))
      .toHaveAttribute('tabindex', '0');

    const inactiveRow = rowNodes[1].parentElement;
    expect(inactiveRow.querySelector('[aria-label="Открыть Telegram 83450000000"]'))
      .toHaveAttribute('tabindex', '-1');
    expect(inactiveRow.querySelectorAll('[tabindex="0"]')).toHaveLength(0);
  });

  it('does not nest interactive controls inside the row button', () => {
    render(<AddressBookEntryList items={items} showChatAction />);

    rows().forEach((row) => {
      expect(row.querySelectorAll('button, a')).toHaveLength(0);
    });

    const chatButton = screen.getByTestId(`address-book-chat-${getEntryKey(items[0], 0)}`);
    expect(rows()[0].contains(chatButton)).toBe(false);
    expect(rows()[0].parentElement.querySelector('button')).not.toBeNull();
  });

  it('shows the disabled Telegram tooltip from its span wrapper without a MUI warning', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const item = {
      full_name: 'Invalid Phone',
      department: 'Dept',
      position: 'Engineer',
      work_phones: [{ value: '123', normalized: '123' }],
      work_emails: [],
    };

    try {
      render(<AddressBookEntryList items={[item]} />);
      const telegramButton = screen.getByRole('button', { name: 'Открыть Telegram 123' });
      const wrapper = telegramButton.parentElement;

      expect(telegramButton).toBeDisabled();
      expect(wrapper.tagName).toBe('SPAN');
      fireEvent.mouseOver(wrapper);

      expect(await screen.findByRole('tooltip')).toHaveTextContent('Номер не подходит для Telegram');
      await waitFor(() => {
        expect(consoleError).not.toHaveBeenCalledWith(
          expect.stringContaining('providing a disabled `button` child'),
        );
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('moves focus with ArrowDown, ArrowUp, Home and End', () => {
    render(<AddressBookEntryList items={items} />);

    const rowNodes = rows();
    rowNodes[0].focus();
    expect(document.activeElement).toBe(rowNodes[0]);

    fireEvent.keyDown(rowNodes[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rowNodes[1]);
    expect(rowNodes[1]).toHaveAttribute('tabindex', '0');
    expect(rowNodes[0]).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(rowNodes[1], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rowNodes[0]);

    fireEvent.keyDown(rowNodes[0], { key: 'End' });
    expect(document.activeElement).toBe(rowNodes[2]);
    expect(rowNodes[2]).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(rowNodes[2], { key: 'Home' });
    expect(document.activeElement).toBe(rowNodes[0]);
  });

  it('marks the selected row with aria-current and keeps it as the tab stop', () => {
    render(<AddressBookEntryList items={items} selectedEntryKey={getEntryKey(items[1], 1)} />);

    const rowNodes = rows();
    expect(rowNodes[1]).toHaveAttribute('aria-current', 'true');
    expect(rowNodes[1]).toHaveAttribute('tabindex', '0');
    expect(rowNodes[0]).toHaveAttribute('tabindex', '-1');
    expect(rowNodes[0]).not.toHaveAttribute('aria-current');
  });

  it('selects the adjacent row with arrows when selectionFollowsFocus is enabled', () => {
    const onSelect = vi.fn();
    render(<AddressBookEntryList items={items} selectionFollowsFocus onSelect={onSelect} />);

    const rowNodes = rows();
    fireEvent.keyDown(rowNodes[0], { key: 'ArrowDown' });
    expect(onSelect).toHaveBeenCalledWith(items[1], 1);

    onSelect.mockClear();
    fireEvent.keyDown(rowNodes[1], { key: 'ArrowUp' });
    expect(onSelect).toHaveBeenCalledWith(items[0], 0);
  });

  it('selects with Enter and Space regardless of selection settings', () => {
    const onSelect = vi.fn();
    render(<AddressBookEntryList items={items} onSelect={onSelect} />);

    const rowNodes = rows();
    fireEvent.keyDown(rowNodes[1], { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(items[1], 1);

    onSelect.mockClear();
    fireEvent.keyDown(rowNodes[2], { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith(items[2], 2);
  });
});
