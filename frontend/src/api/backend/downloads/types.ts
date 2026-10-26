export interface ExternalDownloadLink {
  link: string;
  name: string;
}

export type ExternalDownloadResponse = {
  external_downloads: ExternalDownloadLink[];
  ipfs: string[];
  md5: string;
}[];
