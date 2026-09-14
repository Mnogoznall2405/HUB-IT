import type { MyFileFolder, MyFilePreview, MyFileRecord, MyFilesQuota } from '../api/myFilesApi';

export type NativeMyFilesInboxSnapshot = {
  items: MyFileRecord[];
  folders: MyFileFolder[];
  quota: MyFilesQuota | null;
  breadcrumbs?: MyFileFolder[];
  folder?: MyFileFolder | null;
};

export type NativeMyFileDetailSnapshot = {
  preview: MyFilePreview;
};
