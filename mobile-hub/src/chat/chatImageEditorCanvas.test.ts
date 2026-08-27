import { parseChatImageEditorExportMessage, shouldExportChatImageRecipe } from './chatImageEditorCanvas';

describe('native chat image editor export bridge', () => {
  it('parses exporter messages and ignores invalid JSON', () => {
    expect(parseChatImageEditorExportMessage('{"type":"exported","requestId":"1","dataUrl":"data:image/jpeg;base64,QQ"}'))
      .toEqual({ type: 'exported', requestId: '1', dataUrl: 'data:image/jpeg;base64,QQ' });
    expect(parseChatImageEditorExportMessage('not-json')).toBeNull();
  });

  it('exports only overlay operations, not an empty recipe', () => {
    expect(shouldExportChatImageRecipe({ version: 1, operations: [] })).toBe(false);
    expect(shouldExportChatImageRecipe({
      version: 1,
      operations: [{ type: 'draw', points: [{ x: 0.2, y: 0.3 }], size: 0.02, color: '#fff' }],
    })).toBe(true);
  });
});
