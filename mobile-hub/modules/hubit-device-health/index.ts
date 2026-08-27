import { requireOptionalNativeModule } from 'expo-modules-core';

export type HubitAndroidProcessExitEntry = {
  timestampMs: number;
  reason: string;
};

export type HubitAndroidProcessExitResult = {
  supported: boolean;
  entries: HubitAndroidProcessExitEntry[];
};

export type HubitAndroidConnectivityResult = {
  online: boolean;
  connected: boolean;
  transport: 'none' | 'wifi' | 'cellular' | 'ethernet' | 'vpn' | 'bluetooth' | 'other';
  metered: boolean;
  changedAtMs: number;
};

type HubitDeviceHealthNativeModule = {
  getHistoricalProcessExitInfoAsync(): Promise<HubitAndroidProcessExitResult>;
  getConnectivityAsync(): Promise<HubitAndroidConnectivityResult>;
  addListener(
    eventName: 'onConnectivityChanged',
    listener: (event: HubitAndroidConnectivityResult) => void,
  ): { remove(): void };
};

export default requireOptionalNativeModule<HubitDeviceHealthNativeModule>('HubitDeviceHealth');
