import { requireOptionalNativeModule } from 'expo-modules-core';

export type HubitNativeShareFile = {
  name: string;
  mimeType: string;
  size: number;
};

export type HubitNativeCopiedShareFile = HubitNativeShareFile & {
  /** file:// URI inside the app cache. */
  uri: string;
};

export type HubitNativeSharePayload = {
  id: string;
  text: string;
  subject: string;
  mimeType: string;
  receivedAt: number;
  /** Files of the share (metadata only): copied on demand with copySharedFilesAsync. */
  files?: HubitNativeShareFile[];
};

type HubitShareIntentNativeModule = {
  getPendingShareAsync(): Promise<HubitNativeSharePayload | null>;
  /** Copies the shared streams into the app cache once the user has chosen a destination. */
  copySharedFilesAsync(shareId: string): Promise<HubitNativeCopiedShareFile[]>;
  /** Forgets a share (and any copied files) the user cancelled. */
  discardSharedFilesAsync(shareId: string): Promise<void>;
  addListener(
    eventName: 'onShareIntent',
    listener: (event: { available: boolean }) => void,
  ): { remove(): void };
};

export default requireOptionalNativeModule<HubitShareIntentNativeModule>('HubitShareIntent');
