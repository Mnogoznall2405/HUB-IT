import type { MyFilePreview, MyFileRecord, MyFilesQuota } from '../api/myFilesApi';

export type NativeMyFilesInboxSnapshot = {
  items: MyFileRecord[];
  quota: MyFilesQuota | null;
};

export type NativeMyFileDetailSnapshot = {
  preview: MyFilePreview;
};
