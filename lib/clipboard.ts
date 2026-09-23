import { type Browser, browser } from 'wxt/browser';
import { base64ToBytes } from './base64';
import {
  dataUrlToBlob,
  extensionForMime,
  generatedName,
  imageUrlFromHtml,
  sanitizeFileName,
} from './files';
import {
  DOWNLOAD_PORT,
  type DownloadEvent,
  type DownloadRequest,
  type DownloadSource,
} from './messages';

export interface PickResult {
  files: File[];
  /** i18n key of the reason nothing could be picked. */
  error?: string;
}

export interface DownloadProgress {
  loaded: number;
  total: number;
}

function fileNameFromUrl(url: string, mime: string): string {
  try {
    const last = sanitizeFileName(
      decodeURIComponent(new URL(url).pathname.split('/').pop() ?? ''),
    );
    if (!last) return generatedName(mime, 'download');
    return /\.[a-z0-9]{2,5}$/i.test(last)
      ? last
      : `${last}.${extensionForMime(mime)}`;
  } catch {
    return generatedName(mime, 'download');
  }
}

/**
 * The transfer runs over a port so the page's `connect-src` and CORS stay out
 * of the way and the chunks double as progress events.
 */
export function downloadUrl(
  url: string,
  onProgress: (progress: DownloadProgress) => void,
  source: DownloadSource = 'user',
): Promise<PickResult> {
  if (url.startsWith('data:')) {
    try {
      const blob = dataUrlToBlob(url);
      return Promise.resolve({
        files: [
          new File([blob], generatedName(blob.type, 'download'), {
            type: blob.type,
          }),
        ],
      });
    } catch {
      return Promise.resolve({ files: [], error: 'errorInvalidUrl' });
    }
  }

  return new Promise<PickResult>((resolve) => {
    let port: Browser.runtime.Port;
    try {
      port = browser.runtime.connect({ name: DOWNLOAD_PORT });
    } catch {
      resolve({ files: [], error: 'errorDownloadFailed' });
      return;
    }

    const parts: Uint8Array[] = [];
    let mime = 'application/octet-stream';
    let name: string | null = null;
    let total = 0;
    let settled = false;

    const finish = (result: PickResult): void => {
      if (settled) return;
      settled = true;
      port.disconnect();
      resolve(result);
    };

    port.onMessage.addListener((event: DownloadEvent) => {
      switch (event.type) {
        case 'meta':
          mime = event.mime;
          name = event.name;
          total = event.size;
          onProgress({ loaded: 0, total });
          break;
        case 'chunk':
          parts.push(base64ToBytes(event.data));
          onProgress({ loaded: event.loaded, total });
          break;
        case 'done': {
          const blob = new Blob(parts as BlobPart[], { type: mime });
          if (blob.size === 0) {
            finish({ files: [], error: 'errorDownloadFailed' });
            return;
          }
          const fileName = name
            ? sanitizeFileName(name)
            : fileNameFromUrl(url, mime);
          finish({ files: [new File([blob], fileName, { type: mime })] });
          break;
        }
        case 'error':
          finish({ files: [], error: event.error });
          break;
      }
    });

    port.onDisconnect.addListener(() =>
      finish({ files: [], error: 'errorDownloadFailed' }),
    );

    port.postMessage({ url, source } satisfies DownloadRequest);
  });
}

function readString(item: DataTransferItem): Promise<string> {
  return new Promise((resolve) => item.getAsString(resolve));
}

/**
 * Files first, then an image referenced by the HTML flavour - which is what a
 * browser puts on the clipboard for "copy image". Plain text is never a file
 * and belongs in the URL field instead.
 */
export async function filesFromDataTransfer(
  transfer: DataTransfer | null,
  onProgress: (progress: DownloadProgress) => void,
): Promise<PickResult> {
  if (!transfer) return { files: [], error: 'errorClipboardEmpty' };

  const direct = Array.from(transfer.files);
  if (direct.length > 0) return { files: direct };

  const items = Array.from(transfer.items);
  const html = items.find(
    (item) => item.kind === 'string' && item.type === 'text/html',
  );
  if (html) {
    const url = imageUrlFromHtml(await readString(html));
    if (url) return downloadUrl(url, onProgress, 'page');
  }

  // Pasting text is a no-op, not a failure: the URL field is right there.
  return { files: [] };
}

/**
 * Button path: needs the `clipboardRead` permission and can still be refused by
 * a page `Permissions-Policy`, in which case Ctrl+V remains the way in.
 */
export async function filesFromClipboardApi(
  onProgress: (progress: DownloadProgress) => void,
): Promise<PickResult> {
  let items: ClipboardItems;
  try {
    items = await navigator.clipboard.read();
  } catch {
    return { files: [], error: 'errorClipboardBlocked' };
  }

  for (const item of items) {
    const imageType = item.types.find((type) => type.startsWith('image/'));
    if (imageType) {
      const blob = await item.getType(imageType);
      return {
        files: [
          new File([blob], generatedName(imageType), { type: imageType }),
        ],
      };
    }
  }

  for (const item of items) {
    if (!item.types.includes('text/html')) continue;
    const url = imageUrlFromHtml(
      await (await item.getType('text/html')).text(),
    );
    if (url) return downloadUrl(url, onProgress, 'page');
  }

  return { files: [], error: 'errorClipboardEmpty' };
}
