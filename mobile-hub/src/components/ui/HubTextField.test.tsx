import { render } from '@testing-library/react-native';
import React from 'react';
import { HubTextField } from './HubTextField';

it('forwards a focusable native input ref for form error recovery', async () => {
  const ref = React.createRef<React.ComponentRef<typeof HubTextField>>();

  await render(<HubTextField ref={ref} label="Проверяемое поле" value="" />);

  expect(ref.current).toBeTruthy();
  expect(typeof ref.current?.focus).toBe('function');
});
