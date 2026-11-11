import React from 'react';
import { Button, type ButtonProps } from 'react-native-paper';
import { useAppFluentTokens } from '../../theme/fluentTokens';

export function HubButton({ style, contentStyle, ...props }: ButtonProps) {
  const tokens = useAppFluentTokens();
  return (
    <Button
      {...props}
      style={[{ minHeight: tokens.minTouch }, style]}
      contentStyle={contentStyle}
    />
  );
}
