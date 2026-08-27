import { requireOptionalNativeModule } from 'expo-modules-core';

export type HubitNativeSharePayload = {
  id: string;
  text: string;
  subject: string;
  mimeType: string;
  receivedAt: number;
};

type HubitShareIntentNativeModule = {
  getPendingShareAsync(): Promise<HubitNativeSharePayload | null>;
  addListener(
    eventName: 'onShareIntent',
    listener: (event: { available: boolean }) => void,
  ): { remove(): void };
};

export default requireOptionalNativeModule<HubitShareIntentNativeModule>('HubitShareIntent');
