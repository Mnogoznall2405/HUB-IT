import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import EquipmentPhotoIndicator from './EquipmentPhotoIndicator';

const stateOf = (item) => {
  render(<EquipmentPhotoIndicator item={item} onOpen={() => {}} />);
  return screen.getByRole('button').getAttribute('data-photo-state');
};

describe('EquipmentPhotoIndicator', () => {
  it('stays blue while unchecked photos remain, even when some are already verified', () => {
    expect(stateOf({ photo_count: 3, photo_verified_count: 0, photo_rejected_count: 0 })).toBe('pending');
  });

  it('keeps blue for a partly verified set and says how many are left', () => {
    render(<EquipmentPhotoIndicator item={{ photo_count: 3, photo_verified_count: 1, photo_rejected_count: 0 }} onOpen={() => {}} />);
    expect(screen.getByRole('button').getAttribute('data-photo-state')).toBe('pending');
    expect(screen.getByRole('button', { name: 'Открыть фото: 3, проверено 1' })).toBeInTheDocument();
  });

  it('turns green only when every photo is verified', () => {
    expect(stateOf({ photo_count: 2, photo_verified_count: 2, photo_rejected_count: 0 })).toBe('verified');
  });

  it('is red when any photo is rejected, whatever else is checked', () => {
    expect(stateOf({ photo_count: 3, photo_verified_count: 1, photo_rejected_count: 1 })).toBe('rejected');
  });

  it('treats unknown check counts as unchecked, not as verified', () => {
    expect(stateOf({ photo_count: 2 })).toBe('pending');
  });
});
