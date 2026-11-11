import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import UploadActInvNoChips from './UploadActInvNoChips';

describe('UploadActInvNoChips', () => {
  it('renders an empty-state label when inventory numbers are missing', () => {
    render(<UploadActInvNoChips values={[]} />);

    expect(screen.getByText('Не указано')).toBeInTheDocument();
  });

  it('renders every inventory number as a chip label', () => {
    render(<UploadActInvNoChips values={['100887', 100888]} />);

    expect(screen.getByText('100887')).toBeInTheDocument();
    expect(screen.getByText('100888')).toBeInTheDocument();
    expect(screen.queryByText('Не указано')).not.toBeInTheDocument();
  });
});
