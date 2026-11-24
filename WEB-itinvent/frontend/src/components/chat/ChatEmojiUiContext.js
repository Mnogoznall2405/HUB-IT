import { createContext, useContext } from 'react';

// Phase 2: состояние панели эмодзи/стикеров изолировано от ChatThread.
// Раньше открытие панели меняло пропсы ChatThread и взрывало memo —
// по атрибуции это ~2.6–3.8 тыс. отрендеренных файберов на переключение.
// Теперь обновляются только консьюмеры контекста (композер, поповер, док).
export const ChatEmojiUiContext = createContext(null);

export function useChatEmojiUi() {
  return useContext(ChatEmojiUiContext);
}
