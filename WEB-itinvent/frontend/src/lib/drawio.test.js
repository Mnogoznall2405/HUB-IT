import { describe, expect, it } from 'vitest';
import { inflateSync, strFromU8 } from 'fflate';
import {
  DRAWIO_EDITOR_URL,
  compressDrawioXml,
  drawioEditorUrl,
  drawioExportPngBase64,
  drawioOrigin,
  drawioViewerUrl,
  looksLikeDrawioXml,
  parseDrawioMessage,
} from './drawio';

const b64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const decompress = (compressed) => decodeURIComponent(strFromU8(inflateSync(b64ToBytes(compressed))));

const MAP_XML = '<mxfile host="app.diagrams.net"><diagram name="Page-1">payload</diagram></mxfile>';

describe('looksLikeDrawioXml', () => {
  it('accepts mxfile documents, with or without a prolog, and rejects anything else', () => {
    expect(looksLikeDrawioXml(MAP_XML)).toBe(true);
    expect(looksLikeDrawioXml('  <?xml version="1.0" encoding="UTF-8"?>\n<mxfile><diagram/></mxfile>')).toBe(true);
    expect(looksLikeDrawioXml('<mxGraphModel><root/></mxGraphModel>')).toBe(true);
    expect(looksLikeDrawioXml('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(false);
    expect(looksLikeDrawioXml('{"not": "xml"}')).toBe(false);
    expect(looksLikeDrawioXml('')).toBe(false);
  });
});

describe('compressDrawioXml', () => {
  it('round-trips through the raw-deflate + base64 format drawio uses', () => {
    expect(decompress(compressDrawioXml(MAP_XML))).toBe(MAP_XML);
    // Unicode (Russian labels) survives the URI-encoding drawio applies before deflate.
    const russian = '<mxfile><diagram name="Стр-1"/></mxfile>';
    expect(decompress(compressDrawioXml(russian))).toBe(russian);
  });
});

describe('drawioViewerUrl', () => {
  it('points at the hosted lightbox viewer with the compressed diagram in the fragment', () => {
    const url = drawioViewerUrl(MAP_XML, { title: 'Офис' });
    expect(url.startsWith('https://viewer.diagrams.net/?')).toBe(true);
    expect(url).toContain('lightbox=1');
    expect(url).toContain('nav=1');
    const fragment = url.split('#R')[1];
    expect(fragment).toBeTruthy();
    expect(decompress(fragment)).toBe(MAP_XML);
  });
});

describe('drawioEditorUrl / drawioOrigin / parseDrawioMessage', () => {
  it('builds the embed editor url and its origin', () => {
    const url = drawioEditorUrl();
    expect(url.startsWith(`${DRAWIO_EDITOR_URL}?`)).toBe(true);
    expect(url).toContain('embed=1');
    expect(url).toContain('proto=json');
    expect(url).toContain('libraries=1');
    expect(drawioOrigin()).toBe('https://embed.diagrams.net');
    expect(drawioOrigin('not a url')).toBe('');
  });

  it('parses JSON-protocol messages and ignores everything else', () => {
    expect(parseDrawioMessage('{"event":"init"}')).toEqual({ event: 'init' });
    expect(parseDrawioMessage('{"event":"save","xml":"<mxfile/>"}').xml).toBe('<mxfile/>');
    expect(parseDrawioMessage('not json')).toBeNull();
    expect(parseDrawioMessage('')).toBeNull();
    expect(parseDrawioMessage({ event: 'init' })).toBeNull();
  });

  it('extracts only PNG payloads from export events for the map thumbnail', () => {
    expect(drawioExportPngBase64({ event: 'export', data: 'data:image/png;base64,iVBORw0KGgo=' })).toBe('iVBORw0KGgo=');
    expect(drawioExportPngBase64({ event: 'export', data: 'data:image/svg+xml;base64,xxx' })).toBe('');
    expect(drawioExportPngBase64({ event: 'save', xml: '<mxfile/>' })).toBe('');
    expect(drawioExportPngBase64(null)).toBe('');
  });
});
