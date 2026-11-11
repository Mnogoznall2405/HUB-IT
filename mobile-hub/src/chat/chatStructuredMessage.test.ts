import {
  buildGeoIntentUrl,
  parseContactBody,
  parseLocationBody,
  parsePollBody,
} from './chatStructuredMessage';

describe('structured message kinds', () => {
  it('parses a location payload and builds a geo intent', () => {
    const payload = parseLocationBody('{"latitude":55.75,"longitude":37.61,"address":"Москва"}');
    expect(payload).toEqual({ latitude: 55.75, longitude: 37.61, title: undefined, address: 'Москва' });
    expect(buildGeoIntentUrl(payload!)).toBe('geo:55.75,37.61?q=55.75,37.61');
  });

  it('rejects malformed or out-of-range locations', () => {
    expect(parseLocationBody('')).toBeNull();
    expect(parseLocationBody('{}')).toBeNull();
    expect(parseLocationBody('{"latitude":200,"longitude":0}')).toBeNull();
    expect(parseLocationBody('текст')).toBeNull();
  });

  it('parses a contact payload', () => {
    expect(parseContactBody('{"name":"Иван","phone":"+79001234567"}'))
      .toEqual({ name: 'Иван', phone: '+79001234567', organization: undefined });
    expect(parseContactBody('{"name":""}')).toBeNull();
    expect(parseContactBody('plain text')).toBeNull();
  });

  it('parses a poll body for pending messages', () => {
    const poll = parsePollBody('{"question":"Обед?","options":["Да","Нет"]}');
    expect(poll?.question).toBe('Обед?');
    expect(poll?.options).toEqual([
      { text: 'Да', votes: 0 },
      { text: 'Нет', votes: 0 },
    ]);
    expect(poll?.my_option_index).toBeNull();
    expect(parsePollBody('{"question":"Q","options":["a"]}')).toBeNull();
    expect(parsePollBody('')).toBeNull();
  });
});
