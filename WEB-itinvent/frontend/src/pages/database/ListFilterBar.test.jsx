import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ListFilterBar from './ListFilterBar';
import { buildPhotoStats, filterGroupedByPhoto, PHOTO_FILTER_ALL } from './databaseListModel';

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

    fireEvent.click(screen.getByRole('button', { name: 'Отклонённые (1)' }));
    expect(onPhotoChange).toHaveBeenCalledWith('rejected');
    fireEvent.click(screen.getByRole('button', { name: 'Не проверено (1)' }));
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
