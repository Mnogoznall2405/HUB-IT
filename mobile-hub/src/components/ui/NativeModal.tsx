import { Modal, type ModalProps } from 'react-native';
import { useReducedMotion } from '../../accessibility/useReducedMotion';

/** Preserve modal lifecycle/actions while respecting the current system motion preference. */
export function NativeModal(props: ModalProps) {
  const reduceMotion = useReducedMotion();
  return <Modal {...props} animationType={reduceMotion ? 'none' : props.animationType} />;
}
