import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import EquipmentTable from './EquipmentTable';
import { EmployeeCompareProvider } from './employeeCompareContext';
import { OneCMarksProvider } from './oneCMarksContext';
import { DATA_MODE_CONSUMABLES, DATA_MODE_EQUIPMENT } from './equipmentModel';

vi.mock('../../components/common', () => ({
  ActionMenu: ({ onAction, actions, item, label }) => (
    <button type="button" aria-label={label} onClick={() => onAction?.(actions?.[0], item)}>
      actions
    </button>
  ),
  StatusChip: ({ status }) => <span data-testid="status-chip">{status}</span>,
}));

const theme = createTheme();

const renderTable = (props = {}, { summaries = null } = {}) => render(
  <EmployeeCompareProvider summaries={summaries}>
    <EquipmentTable
      items={[]}
      isMobile={false}
      theme={theme}
      selectedItemsSet={new Set()}
      tableSort={{ field: 'employee', direction: 'asc' }}
      onTableSort={() => {}}
      onSelectAll={() => {}}
      isAllSelected={() => false}
      isSomeSelected={() => false}
      onSelect={() => {}}
      onAction={() => {}}
      dataMode={DATA_MODE_EQUIPMENT}
      {...props}
    />
  </EmployeeCompareProvider>
);

const PHILIPS_PART_NO = 'ЦБ-00195776';
const PHILIPS_KEY = 'цб-00195776';

const philipsItem = (overrides = {}) => ({
  INV_NO: '100021',
  ID: 21,
  PART_NO: PHILIPS_PART_NO,
  MODEL_NAME: 'Philips monitor',
  EMPL_NO: 42,
  OWNER_DISPLAY_NAME: 'Иванов И.И.',
  ...overrides,
});

const compareSummaryEntry = (overrides = {}) => ({
  owner_no: 42,
  employee_name: 'Иванов И.И.',
  warehouse_ref: 'wh-1',
  warehouse_name: 'Иванов И.И.',
  status: 'match',
  part_status: { [PHILIPS_KEY]: 'match' },
  part_quantities: { [PHILIPS_KEY]: { hub_count: 2, qty_1c: 2 } },
  counts: { match: 1, diff: 0, only_hub: 0, only_1c: 0, no_part: 0, not_in_1c: 0, hub_items: 2 },
  as_of: new Date().toISOString(),
  ...overrides,
});

describe('EquipmentTable', () => {
  it('renders equipment rows and wires selection, sorting, and actions', () => {
    const onSelect = vi.fn();
    const onAction = vi.fn();
    const onTableSort = vi.fn();

    renderTable({
      items: [{
        INV_NO: '1001',
        ID: 7,
        SERIAL_NO: 'SN-1',
        PART_NO: 'PN-1',
        TYPE_NAME: 'PC',
        MODEL_NAME: 'OptiPlex',
        OWNER_DISPLAY_NAME: 'Ivan Petrov',
        OWNER_DEPT: 'IT',
        DESCR: 'Active',
      }],
      selectedItemsSet: new Set(['1001']),
      onSelect,
      onAction,
      onTableSort,
      canWrite: true,
      canDeleteEquipment: true,
    });

    expect(screen.getByText('1001')).toBeInTheDocument();
    expect(screen.getByText('Ivan Petrov')).toBeInTheDocument();
    expect(screen.getByTestId('status-chip')).toHaveTextContent('Active');

    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    expect(onSelect).toHaveBeenCalledWith('1001');

    fireEvent.click(screen.getByText(/\u0418\u043d\u0432/));
    expect(onTableSort).toHaveBeenCalledWith('inv');

    // Колонки «⋮» нет: меню действий открывает клик по строке.
    expect(screen.queryByRole('button', { name: 'Actions for 1001' })).not.toBeInTheDocument();
    // Клик по чекбоксу меню не открывает.
    expect(screen.queryByRole('menuitem', { name: 'Просмотр' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('OptiPlex'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Просмотр' }));
    expect(onAction).toHaveBeenCalledWith('view', expect.objectContaining({ INV_NO: '1001' }));
  });

  it('opens the card directly on row click when only viewing is allowed', () => {
    const onAction = vi.fn();
    renderTable({
      items: [{ INV_NO: '1001', ID: 7, MODEL_NAME: 'OptiPlex', OWNER_DISPLAY_NAME: 'Ivan Petrov' }],
      onAction,
      canWrite: false,
    });

    fireEvent.click(screen.getByText('OptiPlex'));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onAction).toHaveBeenCalledWith('view', expect.objectContaining({ INV_NO: '1001' }));
  });

  it('marks only rows with photos and opens the photos tab on click', () => {
    const onAction = vi.fn();
    renderTable({
      items: [
        philipsItem({ INV_NO: '100021', ID: 21, photo_count: 2 }),
        philipsItem({ INV_NO: '100022', ID: 22, photo_count: 0 }),
        philipsItem({ INV_NO: '100023', ID: 23 }),
      ],
      onAction,
    });

    // Счётчик ещё не пришёл (100023) и «0 фото» (100022) — без отметки.
    const marks = screen.getAllByRole('button', { name: /Открыть фото/ });
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveAccessibleName('Открыть фото: 2');

    fireEvent.click(marks[0]);
    expect(onAction).toHaveBeenCalledWith('photos', expect.objectContaining({ INV_NO: '100021' }));
  });

  it('shows the current act state and opens the available act', () => {
    const onOpenCurrentAct = vi.fn();

    renderTable({
      items: [
        {
          INV_NO: '1001',
          ID: 7,
          OWNER_DISPLAY_NAME: 'Ivan Petrov',
          current_act_available: true,
          current_act_doc_no: 901,
          current_act_doc_number: 'ACT-901',
          current_act_doc_date: '2026-09-04T08:30:00',
        },
        {
          INV_NO: '1002',
          ID: 8,
          OWNER_DISPLAY_NAME: 'Ivan Petrov',
          current_act_available: false,
        },
      ],
      onOpenCurrentAct,
    });

    fireEvent.click(screen.getByRole('button', { name: /Открыть актуальный акт ACT-901/ }));

    expect(onOpenCurrentAct).toHaveBeenCalledWith(expect.objectContaining({
      doc_no: 901,
      doc_number: 'ACT-901',
      inv_no: '1001',
    }));
    expect(screen.getByLabelText('Актуального акта нет для оборудования 1002')).toBeInTheDocument();
  });

  it('renders consumable rows and exposes quantity editing', () => {
    const onEditConsumableQty = vi.fn();

    renderTable({
      dataMode: DATA_MODE_CONSUMABLES,
      tableSort: { field: 'model', direction: 'asc' },
      items: [{
        INV_NO: 'C-1',
        ID: 9,
        TYPE_NAME: 'Toner',
        MODEL_NAME: 'HP 12A',
        QTY: '12',
      }],
      onEditConsumableQty,
    });

    expect(screen.getByText('C-1')).toBeInTheDocument();
    expect(screen.getByText('HP 12A')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('\u0418\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e'));

    expect(onEditConsumableQty).toHaveBeenCalledWith(expect.objectContaining({ INV_NO: 'C-1' }));
  });

  it('marks a fresh per-part match green', () => {
    renderTable({
      items: [
        philipsItem({ INV_NO: '100021', ID: 21 }),
        philipsItem({ INV_NO: '100022', ID: 22 }),
      ],
    }, {
      summaries: [compareSummaryEntry()],
    });

    const green = document.querySelectorAll('[data-compare-status="match"]');
    expect(green).toHaveLength(2);
    expect(screen.getAllByText('1С ✓')).toHaveLength(2);
  });

  it('shows yellow mismatch badges with Hub-vs-1C quantities in the tooltip', async () => {
    renderTable({
      items: [
        philipsItem({ INV_NO: '100021', ID: 21 }),
        philipsItem({ INV_NO: '100022', ID: 22 }),
      ],
    }, {
      summaries: [compareSummaryEntry({
        status: 'diff',
        part_status: { [PHILIPS_KEY]: 'diff' },
        part_quantities: { [PHILIPS_KEY]: { hub_count: 2, qty_1c: 1 } },
        counts: { match: 0, diff: 1, only_hub: 0, only_1c: 0, no_part: 0, not_in_1c: 0, hub_items: 2 },
      })],
    });

    const warnings = document.querySelectorAll('[data-compare-status="diff"]');
    expect(warnings).toHaveLength(2);
    expect(screen.getAllByText('1С ≠')).toHaveLength(2);
    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();

    fireEvent.mouseOver(warnings[0]);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Хаб: 2');
    expect(tooltip).toHaveTextContent('1С: 1');
  });

  it('trusts quantities over a contradictory match status', () => {
    renderTable({ items: [philipsItem()] }, {
      summaries: [compareSummaryEntry({
        status: 'match',
        part_status: { [PHILIPS_KEY]: 'match' },
        part_quantities: { [PHILIPS_KEY]: { hub_count: 2, qty_1c: 1 } },
      })],
    });

    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status="diff"]')).toHaveLength(1);
  });

  it('never falls back to the owner-level match for unusable PART_NO values', () => {
    renderTable({
      items: [
        philipsItem({ INV_NO: '100021', ID: 21, PART_NO: '' }),
        philipsItem({ INV_NO: '100022', ID: 22, PART_NO: 'не найден в 1С' }),
        philipsItem({ INV_NO: '100023', ID: 23, PART_NO: 'нет в 1С' }),
      ],
    }, {
      summaries: [compareSummaryEntry()],
    });

    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });

  it('keeps a matched PART_NO green when another code of the same owner differs', () => {
    renderTable({
      items: [
        philipsItem({ INV_NO: '100021', ID: 21 }),
        philipsItem({ INV_NO: '100030', ID: 30, PART_NO: 'ДРУГОЙ-КОД' }),
      ],
    }, {
      summaries: [compareSummaryEntry({
        status: 'diff',
        part_status: { [PHILIPS_KEY]: 'match', 'другой-код': 'diff' },
        part_quantities: {
          [PHILIPS_KEY]: { hub_count: 2, qty_1c: 2 },
          'другой-код': { hub_count: 1, qty_1c: 3 },
        },
        counts: { match: 1, diff: 1, only_hub: 0, only_1c: 0, no_part: 0, not_in_1c: 0, hub_items: 3 },
      })],
    });

    expect(screen.getAllByText('1С ✓')).toHaveLength(1);
    expect(screen.getAllByText('1С ≠')).toHaveLength(1);
  });

  it('does not render any badge for stale, unknown or incomplete summaries', () => {
    const stale = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const { unmount } = renderTable({
      items: [philipsItem({ INV_NO: '100021', ID: 21 })],
    }, {
      summaries: [compareSummaryEntry({ as_of: stale })],
    });
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    unmount();

    const second = renderTable({ items: [philipsItem({ INV_NO: '100025', ID: 25 })] }, {
      summaries: [compareSummaryEntry({ status: 'unknown' })],
    });
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    second.unmount();

    renderTable({ items: [philipsItem({ INV_NO: '100026', ID: 26 })] }, {
      summaries: [compareSummaryEntry({ as_of: null })],
    });
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });

  it('hides the badge when the part quantities evidence is missing', () => {
    const { unmount } = renderTable({ items: [philipsItem()] }, {
      summaries: [compareSummaryEntry({ part_quantities: {} })],
    });
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
    unmount();

    renderTable({ items: [philipsItem()] }, {
      summaries: [compareSummaryEntry({
        part_quantities: { [PHILIPS_KEY]: { hub_count: 2, qty_1c: null } },
      })],
    });
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });

  it.each([
    ['missing', { status: undefined }],
    ['unrecognized', { status: 'reconciled' }],
    ['unreliable', { status: 'unknown' }],
  ])('never goes green on a %s owner status even with matching quantities', (_label, overrides) => {
    renderTable({ items: [philipsItem()] }, {
      summaries: [compareSummaryEntry(overrides)],
    });

    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });

  it.each([
    [{ hub_count: true, qty_1c: 2 }],
    [{ hub_count: 2, qty_1c: true }],
    [{ hub_count: [2], qty_1c: 2 }],
    [{ hub_count: 2, qty_1c: { value: 2 } }],
    [{ hub_count: 'x', qty_1c: 2 }],
    [{ hub_count: 2, qty_1c: -1 }],
  ])('never paints green on non-numeric quantity evidence %j', (quantities) => {
    renderTable({ items: [philipsItem()] }, {
      summaries: [compareSummaryEntry({
        part_quantities: { [PHILIPS_KEY]: quantities },
      })],
    });

    expect(screen.queryByText('1С ✓')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status]')).toHaveLength(0);
  });

  it('accepts numeric-string quantity evidence', () => {
    renderTable({ items: [philipsItem()] }, {
      summaries: [compareSummaryEntry({
        part_quantities: { [PHILIPS_KEY]: { hub_count: '2', qty_1c: '2.0' } },
      })],
    });

    expect(screen.getByText('1С ✓')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-compare-status="match"]')).toHaveLength(1);
  });

  describe('manual 1C mark', () => {
    const MARK = { inv_no: '100021', marked_by: 'admin', marked_at: '2026-10-20T08:00:00Z', note: '' };
    const renderWithMarks = (props, { marks = {}, canMark = true, summaries = null, missing = null } = {}) => render(
      <EmployeeCompareProvider summaries={summaries}>
        <OneCMarksProvider value={{ marks, canMark, missingPartNos: missing }}>
          <EquipmentTable
            items={[philipsItem()]}
            isMobile={false}
            theme={theme}
            selectedItemsSet={new Set()}
            tableSort={{ field: 'employee', direction: 'asc' }}
            onTableSort={() => {}}
            onSelectAll={() => {}}
            isAllSelected={() => false}
            isSomeSelected={() => false}
            onSelect={() => {}}
            onAction={() => {}}
            dataMode={DATA_MODE_EQUIPMENT}
            canWrite
            {...props}
          />
        </OneCMarksProvider>
      </EmployeeCompareProvider>
    );

    it('shows a distinct manual chip where the automatic check has nothing (e.g. an object database)', () => {
      const { container } = renderWithMarks({}, { marks: { 100021: MARK } });

      expect(container.querySelectorAll('[data-compare-status="manual"]')).toHaveLength(1);
      expect(container.querySelector('[data-compare-status="match"], [data-compare-status="diff"]')).toBeNull();
    });

    it('keeps a live automatic mismatch visible next to the manual mark', () => {
      const { container } = renderWithMarks(
        {},
        {
          marks: { 100021: MARK },
          summaries: [compareSummaryEntry({
            status: 'diff',
            part_status: { [PHILIPS_KEY]: 'diff' },
            part_quantities: { [PHILIPS_KEY]: { hub_count: 2, qty_1c: 3 } },
          })],
        },
      );

      expect(container.querySelector('[data-compare-status="diff"]')).not.toBeNull();
      expect(container.querySelector('[data-compare-status="manual"]')).not.toBeNull();
    });

    it('says so when the owner has no 1C warehouse, but lets a manual mark speak instead', () => {
      const noWarehouse = [compareSummaryEntry({
        status: 'no_warehouse', part_status: {}, part_quantities: {}, warehouse_ref: '', warehouse_name: '', warehouse_count: 0,
      })];
      const bare = renderWithMarks({}, { summaries: noWarehouse });
      expect(bare.container.querySelector('[data-compare-status="no_warehouse"]')).not.toBeNull();
      bare.unmount();

      const marked = renderWithMarks({}, { marks: { 100021: MARK }, summaries: noWarehouse });
      expect(marked.container.querySelector('[data-compare-status="manual"]')).not.toBeNull();
      expect(marked.container.querySelector('[data-compare-status="no_warehouse"]')).toBeNull();
    });

    it('shows only the automatic chip when it already matches', () => {
      const { container } = renderWithMarks({}, { marks: { 100021: MARK }, summaries: [compareSummaryEntry()] });

      expect(container.querySelector('[data-compare-status="match"]')).not.toBeNull();
      expect(container.querySelector('[data-compare-status="manual"]')).toBeNull();
    });

    it('offers set/unset in the row menu only to users who may mark', () => {
      const onAction = vi.fn();
      const { unmount } = renderWithMarks({ onAction }, { canMark: true });
      fireEvent.click(screen.getByText('Philips monitor'));
      fireEvent.click(screen.getByText('Отметить сверку с 1С'));
      expect(onAction).toHaveBeenCalledWith('one_c_mark', expect.objectContaining({ INV_NO: '100021' }));
      unmount();

      const onActionMarked = vi.fn();
      const marked = renderWithMarks({ onAction: onActionMarked }, { canMark: true, marks: { 100021: MARK } });
      fireEvent.click(screen.getByText('Philips monitor'));
      expect(screen.queryByText('Отметить сверку с 1С')).not.toBeInTheDocument();
      fireEvent.click(screen.getByText('Снять отметку 1С'));
      expect(onActionMarked).toHaveBeenCalledWith('one_c_unmark', expect.objectContaining({ INV_NO: '100021' }));
      marked.unmount();

      renderWithMarks({}, { canMark: false });
      fireEvent.click(screen.getByText('Philips monitor'));
      expect(screen.queryByRole('menu')).toBeInTheDocument();
      expect(screen.queryByText(/отметк.* 1С|сверку с 1С/)).not.toBeInTheDocument();
    });

    it('shows a red «does not match» chip with the reviewer comment next to the automatic status', async () => {
      const mismatch = { ...MARK, kind: 'mismatch', note: 'в 1С остаток 2, в хабе 1' };
      const { container } = renderWithMarks({}, { marks: { 100021: mismatch }, summaries: [compareSummaryEntry()] });

      expect(container.querySelector('[data-compare-status="match"]')).not.toBeNull();
      const chip = container.querySelector('[data-compare-status="mismatch"]');
      expect(chip).not.toBeNull();
      expect(container.querySelector('[data-compare-status="manual"]')).toBeNull();

      fireEvent.mouseOver(chip);
      expect(await screen.findByText(/в 1С остаток 2, в хабе 1/)).toBeInTheDocument();
    });

    it('offers the «does not match» action with a comment and keeps it available for a marked card', () => {
      const onAction = vi.fn();
      renderWithMarks({ onAction }, { canMark: true, marks: { 100021: { ...MARK, kind: 'mismatch', note: 'x' } } });
      fireEvent.click(screen.getByText('Philips monitor'));

      expect(screen.getByText('Отметить сверку с 1С')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Не сходится с 1С…'));
      expect(onAction).toHaveBeenCalledWith('one_c_mismatch', expect.objectContaining({ INV_NO: '100021' }));
    });

    describe('a mark made before the card changed', () => {
      const snapshotMark = (overrides = {}) => ({
        ...MARK,
        part_no_snapshot: PHILIPS_PART_NO,
        model_snapshot: 'Philips monitor',
        ...overrides,
      });

      it('keeps the manual chip while PART_NO and model are what the reviewer saw', () => {
        const { container } = renderWithMarks({}, { marks: { 100021: snapshotMark() } });

        expect(container.querySelector('[data-compare-status="manual"]')).not.toBeNull();
        expect(container.querySelector('[data-compare-status="stale"]')).toBeNull();
      });

      it('replaces the manual chip with a «check again» chip when PART_NO changed, and allows marking again', async () => {
        const onAction = vi.fn();
        const { container } = renderWithMarks(
          { onAction },
          { marks: { 100021: snapshotMark({ part_no_snapshot: 'OLD-PART' }) } },
        );

        const chip = container.querySelector('[data-compare-status="stale"]');
        expect(chip).not.toBeNull();
        expect(container.querySelector('[data-compare-status="manual"]')).toBeNull();
        fireEvent.mouseOver(chip);
        expect(await screen.findByText(/было «OLD-PART»/)).toBeInTheDocument();

        fireEvent.click(screen.getByText('Philips monitor'));
        fireEvent.click(screen.getByText('Отметить сверку с 1С'));
        expect(onAction).toHaveBeenCalledWith('one_c_mark', expect.objectContaining({ INV_NO: '100021' }));
      });

      it('also stales a «does not match» verdict when the model changed', () => {
        const { container } = renderWithMarks(
          {},
          { marks: { 100021: snapshotMark({ kind: 'mismatch', note: 'нет в 1С', model_snapshot: 'Старая модель' }) } },
        );

        expect(container.querySelector('[data-compare-status="stale"]')).not.toBeNull();
        expect(container.querySelector('[data-compare-status="mismatch"]')).toBeNull();
      });
    });

    it('flags a PART_NO that has no nomenclature in 1C', () => {
      const missing = new Set([PHILIPS_PART_NO.toLowerCase()]);
      const { container } = renderWithMarks({}, { missing });

      expect(container.querySelector('[data-compare-status="not_in_nomenclature"]')).not.toBeNull();
      expect(container.querySelector('[data-part-no-missing="true"]')).toHaveTextContent(PHILIPS_PART_NO);
    });

    it('does not flag anything while the nomenclature check has found no absent codes', () => {
      const { container } = renderWithMarks({}, { missing: new Set() });

      expect(container.querySelector('[data-compare-status="not_in_nomenclature"]')).toBeNull();
      expect(container.querySelector('[data-part-no-missing]')).toBeNull();
    });
  });
});
