import React from 'react';
import { TextInput, type TextInputProps } from 'react-native-paper';

export type HubTextFieldHandle = {
  focus: () => void;
};

export const HubTextField = React.forwardRef<HubTextFieldHandle, TextInputProps>(
  function HubTextField(props, ref) {
    const inputRef = React.useRef<{ focus?: () => void } | null>(null);
    React.useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus?.(),
    }), []);
    return <TextInput ref={inputRef as never} mode="outlined" {...props} />;
  },
);
