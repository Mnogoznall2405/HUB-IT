/**
 * Парсеры structured-сообщений чата (kind='location' | 'contact' | 'poll').
 * Тело таких сообщений — канонический JSON, текстом его показывать нельзя.
 */

export function parseChatLocationBody(body) {
  try {
    const data = JSON.parse(String(body || ''));
    if (!data || typeof data !== 'object') return null;
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return {
      latitude,
      longitude,
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : undefined,
      address: typeof data.address === 'string' && data.address.trim() ? data.address.trim() : undefined,
    };
  } catch {
    return null;
  }
}

export function parseChatContactBody(body) {
  try {
    const data = JSON.parse(String(body || ''));
    if (!data || typeof data !== 'object') return null;
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    if (!name) return null;
    return {
      name,
      phone: typeof data.phone === 'string' && data.phone.trim() ? data.phone.trim() : undefined,
      organization: typeof data.organization === 'string' && data.organization.trim()
        ? data.organization.trim() : undefined,
    };
  } catch {
    return null;
  }
}

/** Pending poll messages carry the JSON body before the server adds `poll`. */
export function parseChatPollBody(body) {
  try {
    const data = JSON.parse(String(body || ''));
    if (!data || typeof data !== 'object') return null;
    const question = typeof data.question === 'string' ? data.question.trim() : '';
    const rawOptions = Array.isArray(data.options) ? data.options : [];
    const options = rawOptions
      .map((item) => {
        if (typeof item === 'string') return { text: item.trim(), votes: 0 };
        if (item && typeof item === 'object') {
          const text = String(item.text || '').trim();
          const votes = Number(item.votes) || 0;
          return text ? { text, votes } : null;
        }
        return null;
      })
      .filter(Boolean);
    if (!question || options.length < 2) return null;
    const myIndex = data.my_option_index === null || data.my_option_index === undefined
      ? -1
      : Number(data.my_option_index);
    return {
      question,
      options,
      anonymous: Boolean(data.anonymous),
      closed: Boolean(data.closed),
      total_voters: Number(data.total_voters) || 0,
      my_option_index: Number.isInteger(myIndex) && myIndex >= 0 ? myIndex : null,
    };
  } catch {
    return null;
  }
}

export function resolveChatMessagePoll(message) {
  const poll = message?.poll;
  if (poll && typeof poll === 'object' && Array.isArray(poll.options) && poll.options.length >= 2) {
    return {
      question: String(poll.question || '').trim(),
      options: poll.options.map((item) => ({
        text: String(item?.text || '').trim(),
        votes: Number(item?.votes) || 0,
      })),
      anonymous: Boolean(poll.anonymous),
      closed: Boolean(poll.closed),
      total_voters: Number(poll.total_voters) || 0,
      // Number(null) === 0: «не голосовал» нельзя превращать в «выбран первый вариант».
      my_option_index: poll.my_option_index !== null && poll.my_option_index !== undefined
        && Number.isInteger(Number(poll.my_option_index)) && Number(poll.my_option_index) >= 0
        ? Number(poll.my_option_index)
        : null,
    };
  }
  return parseChatPollBody(message?.body);
}

export function resolveChatStructuredContent(message) {
  if (!message || message.is_deleted) return { location: null, contact: null, poll: null };
  const kind = String(message.kind || '').trim();
  return {
    location: kind === 'location' ? parseChatLocationBody(message.body) : null,
    contact: kind === 'contact' ? parseChatContactBody(message.body) : null,
    poll: kind === 'poll' ? resolveChatMessagePoll(message) : null,
  };
}

export function hasChatStructuredContent(message) {
  const { location, contact, poll } = resolveChatStructuredContent(message);
  return Boolean(location || contact || poll);
}

export function buildChatLocationOpenUrl(payload) {
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
  return `https://yandex.ru/maps/?pt=${longitude},${latitude}&z=16&l=map`;
}

export function getChatContactPreviewText(contact) {
  const name = String(contact?.name || '').trim();
  return name ? `Контакт: ${name}` : 'Контакт';
}

export function getChatPollPreviewText(poll) {
  const question = String(poll?.question || '').trim();
  return question ? `Опрос: ${question}` : 'Опрос';
}
