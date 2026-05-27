/**
 * Web shim: 3D Touch / Force Touch отсутствует в браузере.
 * Metro на web иногда не резолвит RNGH lib/module/handlers/ForceTouchGestureHandler.js.
 */
import { View } from 'react-native';

export const forceTouchGestureHandlerProps = ['minForce', 'maxForce', 'feedbackOnActivation'];
export const forceTouchHandlerName = 'ForceTouchGestureHandler';

export const ForceTouchGestureHandler = View;
ForceTouchGestureHandler.forceTouchAvailable = false;
