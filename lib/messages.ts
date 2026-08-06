export interface InitMessage {
  type: 'init';
}

export type Message = InitMessage;

export interface InitResponse {
  enabled: boolean;
}

export const DOWNLOAD_PORT = 'download';

export interface DownloadRequest {
  url: string;
}

export type DownloadEvent =
  | { type: 'meta'; mime: string; size: number; name: string | null }
  | { type: 'chunk'; data: string; loaded: number }
  | { type: 'done' }
  | { type: 'error'; error: string };
