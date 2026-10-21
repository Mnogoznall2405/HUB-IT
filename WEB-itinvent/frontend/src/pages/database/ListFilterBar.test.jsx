import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ListFilterBar from './ListFilterBar';
import {
  buildOneCStats,
  buildPhotoStats,
  filterGroupedByOneC,
  filterGroupedByPhoto,
  ONE_C_FILTER_ALL,
  PHOTO_FILTER_ALL,
} from './databaseListModel';

const grouped = {
  Филиал: {
    Кабинет: [
      { inv_no: 'A', photo_count: 2, photo_verified_count: 0, photo_rejected_count: 1 },
      { inv_no: 'B', photo_count: 1, photo_verified_count: 0, photo_rejected_count: 0 },
      { inv_no: 'C', photo_count: 3, photo_verified_count: 2, photo_rejected_count: 0 },
      // Счётчики проверки ещё не пришли — строка не должна попасть в «Не проверено».
      { inv_no: 'D', photo_count: 1 },
      { inv_no: 'E', photo_count: 0, photo_verified_count: 0, photo_rejected_count: 0 },
    ],
  },
};

const invNos = (data) => Object.values(data).flatMap((locations) => (
  Object.values(locations).flatMap((items) => items.map((item) => item.inv_no))
));

describe('photo review filters', () => {
  it('splits rows into rejected and unchecked without guessing unknown counters', () => {
    expect(invNos(filterGroupedByPhoto(grouped, 'rejected'))).toEqual(['A']);
    expect(invNos(filterGroupedByPhoto(grouped, 'unchecked'))).toEqual(['B']);
    const { overall } = buildPhotoStats(grouped);
    expect(overall.rejected).toBe(1);
    expect(overall.unchecked).toBe(1);
  });

  it('offers the new filters and the review queue button with a badge', () => {
    const onPhotoChange = vi.fn();
    const onOpenReview = vi.fn();
    render(
      <ListFilterBar
        photoValue={PHOTO_FILTER_ALL}
        onPhotoChange={onPhotoChange}
        photoStats={buildPhotoStats(grouped)}
        actValue="all"
        onActChange={vi.fn()}
        actStats={null}
        onOpenReview={onOpenReview}
        reviewSummary={{ rejected: 3, unchecked: 4 }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Фильтр по наличию фото' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Отклонённые (1)' }));
    expect(onPhotoChange).toHaveBeenCalledWith('rejected');
    fireEvent.click(screen.getByRole('button', { name: 'Фильтр по наличию фото' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Не проверено (1)' }));
    expect(onPhotoChange).toHaveBeenCalledWith('unchecked');

    expect(screen.getByText('7')).toBeTruthy();
    fireEvent.click(screen.getByTestId('photo-review-open'));
    expect(onOpenReview).toHaveBeenCalledTimes(1);
  });

  it('hides the queue button for users without the check right', () => {
    render(
      <ListFilterBar
        photoValue={PHOTO_FILTER_ALL}
        onPhotoChange={vi.fn()}
        photoStats={buildPhotoStats(grouped)}
        actValue="all"
        onActChange={vi.fn()}
        actStats={null}
      />,
    );
    expect(screen.queryByTestId('photo-review-open')).toBeNull();
  });
});

describe('1C filter', () => {
  const NOW = new Date().toISOString();
  const summary = (partQuantities, status = 'match') => ({
    owner_no: 42,
    status,
    as_of: NOW,
    part_quantities: partQuantities,
  });
  // Владелец 42: PN-OK сходится (хаб 1 = 1С 1), PN-DIFF расходится (хаб 1, в 1С 3).
  const context = {
    summaryByOwner: new Map([[42, summary({
      'pn-ok': { hub_count: 1, qty_1c: 1 },
      'pn-diff': { hub_count: 1, qty_1c: 3 },
    })]]),
    marks: { 'M-1': { marked_by: 'admin' }, 'M-DIFF': { marked_by: 'admin' } },
  };
  const rows = {
    Филиал: {
      Кабинет: [
        { inv_no: 'AUTO-OK', EMPL_NO: 42, PART_NO: 'PN-OK' },
        { inv_no: 'AUTO-DIFF', EMPL_NO: 42, PART_NO: 'PN-DIFF' },
        { inv_no: 'M-1', EMPL_NO: 7, PART_NO: '' },
        { inv_no: 'M-DIFF', EMPL_NO: 42, PART_NO: 'PN-DIFF' },
        { inv_no: 'NONE', EMPL_NO: 7, PART_NO: '' },
      ],
    },
  };

  it('«не сходится» and a PART_NO absent from the nomenclature are filtered and never count as reconciled', () => {
    const verdicts = {
      summaryByOwner: context.summaryByOwner,
      marks: { 'AUTO-OK': { kind: 'mismatch', note: 'нет' }, 'M-1': { kind: 'ok' } },
      missingPartNos: new Set(['pn-diff']),
    };

    expect(invNos(filterGroupedByOneC(rows, 'mismatch', verdicts))).toEqual(['AUTO-OK']);
    expect(invNos(filterGroupedByOneC(rows, 'synced', verdicts))).toEqual(['M-1']);
    expect(invNos(filterGroupedByOneC(rows, 'manual', verdicts))).toEqual(['M-1']);
    expect(invNos(filterGroupedByOneC(rows, 'not_in_nomenclature', verdicts))).toEqual(['AUTO-DIFF', 'M-DIFF']);
    expect(buildOneCStats(rows, verdicts)).toMatchObject({ mismatch: 1, missingNomenclature: 2, manual: 1, synced: 1 });
  });

  it('keeps a live mismatch visible even when the card is marked manually', () => {
    expect(invNos(filterGroupedByOneC(rows, 'synced', context))).toEqual(['AUTO-OK', 'M-1']);
    expect(invNos(filterGroupedByOneC(rows, 'diff', context))).toEqual(['AUTO-DIFF', 'M-DIFF']);
    expect(invNos(filterGroupedByOneC(rows, 'manual', context))).toEqual(['M-1', 'M-DIFF']);
    expect(invNos(filterGroupedByOneC(rows, 'unsynced', context))).toEqual(['NONE']);
    expect(buildOneCStats(rows, context)).toEqual({ total: 5, synced: 2, diff: 2, manual: 2, mismatch: 0, missingNomenclature: 0, unsynced: 1, noWarehouse: 0 });
  });

  it('finds rows whose owner has no 1C warehouse', () => {
    const noWarehouseContext = {
      summaryByOwner: new Map([[7, summary({}, 'no_warehouse')]]),
      marks: {},
    };
    const data = { Филиал: { Кабинет: [
      { inv_no: 'A', EMPL_NO: 7, PART_NO: 'PN-OK' },
      { inv_no: 'B', EMPL_NO: 7, PART_NO: '' },
      { inv_no: 'C', EMPL_NO: 8, PART_NO: 'PN-OK' },
    ] } };
    expect(invNos(filterGroupedByOneC(data, 'no_warehouse', noWarehouseContext))).toEqual(['A']);
  });

  it('adds the 1C chip, picks a value and resets every active filter at once', () => {
    const onOneCChange = vi.fn();
    const onPhotoChange = vi.fn();
    render(
      <ListFilterBar
        photoValue="without"
        onPhotoChange={onPhotoChange}
        photoStats={buildPhotoStats(grouped)}
        actValue="all"
        onActChange={vi.fn()}
        actStats={null}
        oneCValue={ONE_C_FILTER_ALL}
        onOneCChange={onOneCChange}
        oneCStats={buildOneCStats(rows, context)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Фильтр по сверке с 1С' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Расхождение ≠ (2)' }));
    expect(onOneCChange).toHaveBeenCalledWith('diff');

    fireEvent.click(screen.getByTestId('list-filters-reset'));
    expect(onPhotoChange).toHaveBeenCalledWith(PHOTO_FILTER_ALL);
    expect(onOneCChange).toHaveBeenCalledWith(ONE_C_FILTER_ALL);
  });
});
