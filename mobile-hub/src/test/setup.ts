const mockSecureStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));

jest.mock('expo-crypto', () => {
  const actual = jest.requireActual('expo-crypto');
  const { Buffer } = require('buffer');
  class MockAesKey {
    private readonly encodedValue: string;

    constructor(encodedValue = 'hubit-test-snapshot-key') {
      this.encodedValue = encodedValue;
    }

    static async generate() { return new MockAesKey(); }
    static async import(value: string) { return new MockAesKey(value); }
    async encoded() { return this.encodedValue; }
  }
  class MockSealedData {
    readonly encodedValue: string;

    constructor(encodedValue: string) {
      this.encodedValue = encodedValue;
    }

    static fromCombined(value: Uint8Array) {
      if (!(value instanceof Uint8Array)) throw new TypeError('fromCombined requires Uint8Array on Android SDK 57');
      return new MockSealedData(Buffer.from(value).toString('base64'));
    }
    async combined() { return this.encodedValue; }
  }
  return {
    ...actual,
    AESKeySize: { AES256: 256 },
    AESEncryptionKey: MockAesKey,
    AESSealedData: MockSealedData,
    aesEncryptAsync: jest.fn(async (value: Uint8Array) => (
      new MockSealedData(Buffer.from(value).toString('base64'))
    )),
    aesDecryptAsync: jest.fn(async (sealed: MockSealedData) => (
      new Uint8Array(Buffer.from(sealed.encodedValue, 'base64'))
    )),
  };
});

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      navigate: jest.fn(),
      setParams: jest.fn(),
      canGoBack: jest.fn(() => true),
    },
    Redirect: () => null,
    Stack: Object.assign(() => null, { Screen: () => null }),
    Tabs: Object.assign(() => null, { Screen: () => null }),
    useLocalSearchParams: jest.fn(() => ({})),
    usePathname: jest.fn(() => '/dashboard'),
    useSegments: jest.fn(() => ['(shell)', 'dashboard']),
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [callback]);
    },
  };
});

jest.mock('expo-router/react-navigation', () => {
  const React = require('react');
  return {
    useNavigation: () => ({ dispatch: jest.fn() }),
    usePreventRemove: jest.fn(),
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(() => {
        const cleanup = callback();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [callback]);
    },
  };
});

jest.mock('expo-haptics', () => ({
  AndroidHaptics: { Confirm: 'confirm', Reject: 'reject', Segment_Tick: 'segment-tick' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
  performAndroidHapticsAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { LOW: 2, DEFAULT: 3, HIGH: 4 },
  AndroidNotificationVisibility: { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelGroupAsync: jest.fn(async () => null),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationCategoryAsync: jest.fn(async () => null),
  setBadgeCountAsync: jest.fn(async () => true),
  dismissNotificationAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'fcm', data: 'test-fcm-token' })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async (request) => request.identifier || 'local-notification'),
  registerTaskAsync: jest.fn(async () => null),
  unregisterTaskAsync: jest.fn(async () => null),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
  isTaskRegisteredAsync: jest.fn(async () => false),
  isAvailableAsync: jest.fn(async () => true),
}));

jest.mock('expo-background-task', () => ({
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
}));

jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: View,
    WebView: View,
  };
});

jest.mock('expo-clipboard', () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ''),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.1.11',
  nativeBuildVersion: '13',
  applicationId: 'ru.zsgp.hubit.mobile',
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async (uri: string) => ({ uri, width: 100, height: 100 })),
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      rotate: jest.fn(),
      crop: jest.fn(),
      renderAsync: jest.fn(async () => ({
        saveAsync: jest.fn(async () => ({ uri: 'file:///edited.jpg', width: 100, height: 100 })),
      })),
    })),
  },
}));

jest.mock('expo-audio', () => {
  const recorder = {
    id: 'recorder-1',
    uri: 'file:///cache/voice.m4a',
    currentTime: 4,
    isRecording: false,
    prepareToRecordAsync: jest.fn(async () => undefined),
    record: jest.fn(() => {
      recorder.isRecording = true;
    }),
    stop: jest.fn(async () => {
      recorder.isRecording = false;
    }),
    getStatus: () => ({
      canRecord: true,
      isRecording: recorder.isRecording,
      durationMillis: recorder.isRecording ? 4000 : 0,
      mediaServicesDidReset: false,
      url: recorder.uri,
      metering: recorder.isRecording ? -18 : undefined,
    }),
    reset: () => {
      recorder.isRecording = false;
    },
  };
  return {
    RecordingPresets: { HIGH_QUALITY: { extension: '.m4a' } },
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
    setAudioModeAsync: jest.fn(async () => undefined),
    useAudioRecorder: () => recorder,
    useAudioRecorderState: () => recorder.getStatus(),
    resetAudioRecorder: recorder.reset,
    createAudioPlayer: jest.fn(() => ({
      play: jest.fn(),
      pause: jest.fn(),
      remove: jest.fn(),
      seekTo: jest.fn(async () => undefined),
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      playing: false,
      currentTime: 0,
      duration: 4,
    })),
  };
});

jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    VideoView: (props: Record<string, unknown>) => React.createElement(View, props),
    useVideoPlayer: (_source: unknown, setup?: (player: Record<string, unknown>) => void) => {
      const player = {
        loop: false,
        muted: false,
        keepScreenOnWhilePlaying: true,
        status: 'readyToPlay',
        play: jest.fn(),
        pause: jest.fn(),
        addListener: jest.fn(() => ({ remove: jest.fn() })),
      };
      setup?.(player);
      return player;
    },
  };
});

jest.mock('lottie-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => React.createElement(View, props),
  };
});

beforeEach(() => {
  mockSecureStore.clear();
  try {
    const fileSystem = require('expo-file-system') as {
      Directory: new (parent: unknown, ...segments: string[]) => { list: () => Array<{ delete?: () => void }> };
      Paths: { cache: unknown; document: unknown };
    };
    [fileSystem.Paths.cache, fileSystem.Paths.document].forEach((root) => {
      try {
        const snapshotDirectory = new fileSystem.Directory(root, 'hubit-native-snapshots');
        snapshotDirectory.list().forEach((entry) => entry.delete?.());
      } catch {
        // The legacy cache directory and the persistent document directory are independent.
      }
    });
  } catch {
    // Some isolated unit tests replace expo-file-system with a minimal mock.
  }
  const expoAudio = jest.requireMock('expo-audio') as { resetAudioRecorder?: () => void };
  expoAudio.resetAudioRecorder?.();
});
