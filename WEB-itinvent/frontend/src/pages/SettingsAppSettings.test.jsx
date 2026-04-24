import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AdminLoginAllowlistSettingsCard } from './Settings';


describe('AdminLoginAllowlistSettingsCard', () => {
  it('saves normalized unique IPs from multiline input', () => {
    const onSave = vi.fn();

    render(
      <AdminLoginAllowlistSettingsCard
        appSettings={{ admin_login_allowed_ips: ['10.105.0.42'] }}
        loading={false}
        saving={false}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: ' 10.105.0.42 \n10.105.0.42\n10.105.0.43\n',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /allowlist/i }));

    expect(onSave).toHaveBeenCalledWith({
      admin_login_allowed_ips: ['10.105.0.42', '10.105.0.43'],
    });
  });

  it('requires at least one IP before save', () => {
    const onSave = vi.fn();

    render(
      <AdminLoginAllowlistSettingsCard
        appSettings={{ admin_login_allowed_ips: ['10.105.0.42'] }}
        loading={false}
        saving={false}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByRole('textbox'), {
      target: {
        value: '\n\n',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /allowlist/i }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/IP-адрес/i)).toBeInTheDocument();
  });
});
