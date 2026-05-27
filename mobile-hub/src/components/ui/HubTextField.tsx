import React from 'react';
import { TextInput, type TextInputProps } from 'react-native-paper';

export function HubTextField(props: TextInputProps) {
  return <TextInput mode="outlined" {...props} />;
}
