import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import ScanCenterNavigation from './ScanCenterNavigation';

function renderNav(props) {
  return render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
      <ScanCenterNavigation
        active="agents"
        counts={{ overview: null, incidents: 61865, review: 2882, agents: 490, hosts: 261 }}
        onChange={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('ScanCenterNavigation', () => {
  it('uses horizontal tabs in compact mode with inline counts', () => {
    renderNav({ compact: true });
    expect(screen.getByRole('navigation', { name: 'Разделы Scan Center' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Агенты' })).toBeInTheDocument();
    expect(screen.getByText('61.9k')).toBeInTheDocument();
    expect(screen.getByText('Инциденты')).toBeInTheDocument();
    expect(screen.queryByText('Рабочие разделы')).not.toBeInTheDocument();
  });

  it('keeps vertical desktop nav with section helpers', () => {
    renderNav({ compact: false });
    expect(screen.getByText('Рабочие разделы')).toBeInTheDocument();
    expect(screen.getByText('Связь и задания')).toBeInTheDocument();
    expect(screen.getByText('61.9k')).toBeInTheDocument();
  });
});
