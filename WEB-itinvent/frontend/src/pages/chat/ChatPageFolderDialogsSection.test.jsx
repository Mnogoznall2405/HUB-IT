import { describe, expect, it } from 'vitest';

import { render } from '@testing-library/react';

import ChatPageFolderDialogsSection from './ChatPageFolderDialogsSection';

describe('ChatPageFolderDialogsSection', () => {
  it('renders nothing visible when closed', () => {
    const { container } = render(
      <ChatPageFolderDialogsSection open={false} folders={[]} conversations={[]} />,
    );
    expect(container.querySelector('.MuiDialog-root')).toBeNull();
  });
});
