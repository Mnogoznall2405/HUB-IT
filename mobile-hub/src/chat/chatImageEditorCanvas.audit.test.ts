import { Directory, File, Paths } from 'expo-file-system';
import { writeEditedImageFromDataUrl } from './chatImageEditorCanvas';

const dataUrl = 'data:image/jpeg;base64,QUJD';

describe('AUD-7 edit cache pruning', () => {
  it('bounds hubit-edits to the newest files when an export lands', () => {
    const directory = new Directory(Paths.cache, 'hubit-edits');
    directory.create({ intermediates: true, idempotent: true });
    for (let index = 0; index < 35; index += 1) {
      new File(directory, `stale-edit-${index}.jpg`).write('x');
    }

    const exported = writeEditedImageFromDataUrl(dataUrl);

    const remaining = directory.list().map((entry) => entry.name);
    expect(remaining.length).toBeLessThanOrEqual(30);
    // The fresh export is the newest file — it survives the prune.
    expect(remaining).toContain(exported.name);
    expect(new File(exported.uri).exists).toBe(true);
    expect(exported.name).toMatch(/^chat-edit-\d+-\d+\.jpg$/);
  });

  it('keeps file names unique for two exports in the same millisecond', () => {
    const first = writeEditedImageFromDataUrl(dataUrl);
    const second = writeEditedImageFromDataUrl(dataUrl);
    expect(first.name).not.toBe(second.name);
    expect(new File(first.uri).exists).toBe(true);
    expect(new File(second.uri).exists).toBe(true);
  });
});
