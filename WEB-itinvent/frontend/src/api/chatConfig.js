import chatDirectoryAPI from './chatDirectory';

export const chatConfigAPI = {
  // GET /chat/config → { group_max_members } — лимит участников группы
  // (CHAT_GROUP_MAX_MEMBERS на бэкенде, включая создателя).
  getConfig: () => chatDirectoryAPI.getConfig(),
};

// Д2-9: конфиг запрашивается один раз на сессию. Ошибка не кешируется —
// следующий вызов повторит запрос (повторное открытие потока «Новый чат»).
let chatConfigPromise = null;

export function getChatConfigCached() {
  if (!chatConfigPromise) {
    chatConfigPromise = chatConfigAPI.getConfig().catch((error) => {
      chatConfigPromise = null;
      throw error;
    });
  }
  return chatConfigPromise;
}

// Сброс кеша для unit-тестов.
export function resetChatConfigCache() {
  chatConfigPromise = null;
}

export default chatConfigAPI;
