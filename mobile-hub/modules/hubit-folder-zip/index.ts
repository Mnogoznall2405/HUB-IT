import { requireOptionalNativeModule } from 'expo-modules-core';

export type HubitFolderZipAsset = {
  uri: string;
  name: string;
  mimeType: 'application/zip';
  size: number;
  fileCount: number;
  totalBytes: number;
  folderName: string;
};

export type HubitFolderZipResult = {
  canceled: boolean;
  asset?: HubitFolderZipAsset;
};

type HubitFolderZipNativeModule = {
  pickAndZipFolderAsync(): Promise<HubitFolderZipResult>;
};

export default requireOptionalNativeModule<HubitFolderZipNativeModule>('HubitFolderZip');
