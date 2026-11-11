import { render, waitFor } from '@testing-library/react-native';
import { File, Paths } from 'expo-file-system';
import { clearNativeFormDrafts, createNativeFormDraftSession } from '../../drafts/nativeFormDrafts';
import { NativeFeedEditorScreen } from './NativeFeedEditorScreen';
const mockStore = new Map<string, string>();
jest.mock('../../cache/nativeSnapshotStorage', () => ({
  readEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => mockStore.get(`${user}:${scope}`) || null),
  writeEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number, data: string) => { mockStore.set(`${user}:${scope}`, data); return true; }),
  deleteEncryptedNativeSnapshot: jest.fn(async (scope: string, user: number) => { mockStore.delete(`${user}:${scope}`); }),
}));
jest.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, offlineMode: true, hasPermission: () => true }) }));
jest.mock('../../preferences/PreferencesContext', () => ({ usePreferences: () => ({ preferences: { theme_mode: 'system' } }) }));
jest.mock('../../api/feedApi', () => ({
  getFeedRecipients: jest.fn(async () => ({ users: [], roles: [] })), listFeedCategories: jest.fn(async () => []), listFeedTags: jest.fn(async () => []),
}));

it('restores offline text and attachment metadata after temporary picker files disappear', async () => {
  await clearNativeFormDrafts();
  const file = new File(Paths.cache, 'publication-photo'); file.write('image');
  await createNativeFormDraftSession(1, 'feed-editor-new').write({
    createdPostId: '', title: 'Restored publication', preview: '', body: 'Restored body', priority: 'normal', requiresAck: false, isPinned: false,
    commentsEnabled: true, reactionsEnabled: true, tagsText: '', categoryId: '', isActive: true, notifyOnUpdate: false,
    audienceScope: 'all', audienceRoles: [], audienceUserIds: [], publishedFrom: '', expiresAt: '', pinnedUntil: '', pollEnabled: false,
    pollQuestion: '', pollOptions: ['', ''], pollAllowsMultiple: false, pollAnonymous: false, pollClosesAt: '', existingAttachments: [],
    newFiles: [{ uri: file.uri, name: 'durable.jpg', mimeType: 'image/jpeg', size: file.size, uploadId: 'stable-upload' }],
    attachmentOrder: [`new:${file.uri}`], coverKey: `new:${file.uri}`, createRequest: { id: 'same-request', fingerprint: 'same-payload' },
  });
  file.delete();
  const view = await render(<NativeFeedEditorScreen />);
  await waitFor(() => expect(view.getByTestId('feed-editor-title').props.value).toBe('Restored publication'));
  expect(view.getByText('durable.jpg')).toBeTruthy();
  expect(view.getByTestId('feed-editor-publish')).toBeDisabled();
  await view.unmount();
});
