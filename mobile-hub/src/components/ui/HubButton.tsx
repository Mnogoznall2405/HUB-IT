import React from 'react';
import { Button, type ButtonProps } from 'react-native-paper';
import { hubTheme } from '../../theme/hubTheme';

export function HubButton({ style, contentStyle, ...props }: ButtonProps) {
  return (
    <Button
      {...props}
      style={[{ minHeight: hubTheme.minTouch }, style]}
      contentStyle={contentStyle}
    />
  );
}
