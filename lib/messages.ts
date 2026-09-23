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

/**
 * `user` is a URL typed into the overlay. `page` came out of a clipboard or drag
 * payload the page may have written itself, so it only reaches public hosts
 * (or the frame's own origin) and has to answer with an image.
 */
export type DownloadSource = 'user' | 'page';

export interface DownloadRequest {
  url: string;
  source: DownloadSource;
}

export type DownloadEvent =
  | { type: 'meta'; mime: string; size: number; name: string | null }
  | { type: 'chunk'; data: string; loaded: number }
  | { type: 'done' }
  | { type: 'error'; error: string };
