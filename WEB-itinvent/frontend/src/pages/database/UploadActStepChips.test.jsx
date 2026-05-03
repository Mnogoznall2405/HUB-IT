import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import UploadActStepChips, { UPLOAD_ACT_STEPS } from './UploadActStepChips';

describe('UploadActStepChips', () => {
  it('renders the upload-act workflow labels in order', () => {
    render(<UploadActStepChips activeStep={2} />);

    expect(screen.getByText('Этапы загрузки акта')).toBeInTheDocument();
    UPLOAD_ACT_STEPS.forEach((entry) => {
      expect(screen.getByText(`${entry.step}. ${entry.label}`)).toBeInTheDocument();
    });
  });
});
