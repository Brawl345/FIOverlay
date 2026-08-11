export interface InitMessage {
  type: 'init';
}

export type Message = InitMessage;

export interface InitResponse {
  enabled: boolean;
}

export const DOWNLOAD_PORT = 'download';

/** Cancelable announcement the page world sends before a picker opens. */
export const PICKER_EVENT = 'fioverlay:picker';

export interface DownloadRequest {
  url: string;
}

export type DownloadEvent =
  | { type: 'meta'; mime: string; size: number; name: string | null }
  | { type: 'chunk'; data: string; loaded: number }
  | { type: 'done' }
  | { type: 'error'; error: string };
