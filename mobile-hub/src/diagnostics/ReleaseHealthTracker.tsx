import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import {
  recordReleaseHealthMetric,
  startReleaseHealthSession,
} from './diagnostics';

export function ReleaseHealthTracker() {
  useEffect(() => {
    void startReleaseHealthSession();
    if (Platform.OS === 'web') return undefined;

    const receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      void recordReleaseHealthMetric('push_received');
    });
    return () => receivedSubscription.remove();
  }, []);

  return null;
}
