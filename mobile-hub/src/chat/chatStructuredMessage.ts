/** Parsers for structured message kinds (location / contact JSON bodies). */

export type LocationPayload = {
  latitude: number;
  longitude: number;
  title?: string;
  address?: string;
};

export type ContactPayload = {
  name: string;
  phone?: string;
  organization?: string;
};

export function parseLocationBody(body: string | null | undefined): LocationPayload | null {
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

export function parseContactBody(body: string | null | undefined): ContactPayload | null {
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

export type PollPayload = {
  question: string;
  options: Array<{ text: string; votes: number }>;
  anonymous?: boolean;
  closed?: boolean;
  total_voters: number;
  my_option_index: number | null;
};

/** Pending poll messages carry the JSON body before the server adds `poll`. */
export function parsePollBody(body: string | null | undefined): PollPayload | null {
  try {
    const data = JSON.parse(String(body || ''));
    if (!data || typeof data !== 'object') return null;
    const question = typeof data.question === 'string' ? data.question.trim() : '';
    const rawOptions = Array.isArray(data.options) ? data.options : [];
    const options = rawOptions
      .map((item: unknown) => {
        if (typeof item === 'string') return { text: item.trim(), votes: 0 };
        if (item && typeof item === 'object') {
          const text = String((item as { text?: unknown }).text || '').trim();
          const votes = Number((item as { votes?: unknown }).votes) || 0;
          return text ? { text, votes } : null;
        }
        return null;
      })
      .filter((item: { text: string; votes: number } | null): item is { text: string; votes: number } => Boolean(item));
    if (!question || options.length < 2) return null;
    const myIndex = Number(data.my_option_index);
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

export function buildGeoIntentUrl(payload: LocationPayload): string {
  const coords = `${payload.latitude},${payload.longitude}`;
  return `geo:${coords}?q=${coords}`;
}
