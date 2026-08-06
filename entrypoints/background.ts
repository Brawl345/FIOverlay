import { type Browser, browser } from 'wxt/browser';
import { defineBackground } from '#imports';
import { bytesToBase64 } from '../lib/base64';
import {
  getDisabledDomains,
  hostnameOf,
  isDisabled,
  toggleDomain,
} from '../lib/domains';
import { t } from '../lib/i18n';
import {
  DOWNLOAD_PORT,
  type DownloadEvent,
  type DownloadRequest,
  type InitResponse,
  type Message,
} from '../lib/messages';

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

const ICON_SIZES = [16, 32, 48, 128] as const;

function iconPaths(enabled: boolean): Record<number, string> {
  const dir = enabled ? '/icons' : '/icons/off';
  return Object.fromEntries(
    ICON_SIZES.map((size) => [size, `${dir}/${size}.png`]),
  );
}

async function updateAction(tabId: number, enabled: boolean): Promise<void> {
  try {
    await browser.action.setIcon({ tabId, path: iconPaths(enabled) });
    await browser.action.setTitle({
      tabId,
      title: t(enabled ? 'actionTitleEnabled' : 'actionTitleDisabled'),
    });
  } catch {
    // Tab closed or navigated away before the update landed.
  }
}

async function isTabEnabled(url: string | undefined): Promise<boolean> {
  const hostname = hostnameOf(url);
  if (!hostname) return false;
  return !isDisabled(hostname, await getDisabledDomains());
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = /filename\*\s*=\s*[^']*'[^']*'([^;]+)/i.exec(header)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // Fall through to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header)?.[1];
  return plain?.trim() || null;
}

/**
 * Streamed instead of buffered: the content script gets progress events and no
 * single message has to carry the whole file.
 */
async function streamDownload(
  port: Browser.runtime.Port,
  url: string,
  signal: AbortSignal,
): Promise<void> {
  const send = (event: DownloadEvent): void => {
    try {
      port.postMessage(event);
    } catch {
      // Receiver disconnected mid-download.
    }
  };

  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal,
    });
    if (!response.ok) {
      send({ type: 'error', error: 'errorDownloadFailed' });
      return;
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_DOWNLOAD_BYTES) {
      send({ type: 'error', error: 'errorTooLarge' });
      return;
    }

    send({
      type: 'meta',
      mime:
        response.headers.get('content-type')?.split(';')[0]?.trim() ||
        'application/octet-stream',
      size: Number.isFinite(declared) ? declared : 0,
      name: filenameFromDisposition(
        response.headers.get('content-disposition'),
      ),
    });

    const reader = response.body?.getReader();
    if (!reader) {
      send({ type: 'error', error: 'errorDownloadFailed' });
      return;
    }

    let loaded = 0;
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.length;
      if (loaded > MAX_DOWNLOAD_BYTES) {
        await reader.cancel();
        send({ type: 'error', error: 'errorTooLarge' });
        return;
      }
      send({ type: 'chunk', data: bytesToBase64(value), loaded });
    }

    if (!signal.aborted) send({ type: 'done' });
  } catch {
    if (!signal.aborted) send({ type: 'error', error: 'errorDownloadFailed' });
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (message: Message, sender, sendResponse) => {
      if (message?.type !== 'init') return false;

      // `sender.tab.url` is the top level document, which is what the toolbar
      // icon toggles - a cross origin upload iframe must follow the tab.
      void isTabEnabled(sender.tab?.url ?? sender.url).then((enabled) => {
        if (sender.tab?.id != null && sender.frameId === 0) {
          void updateAction(sender.tab.id, enabled);
        }
        sendResponse({ enabled } satisfies InitResponse);
      });
      return true;
    },
  );

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== DOWNLOAD_PORT) return;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener((message: DownloadRequest) => {
      void streamDownload(port, message.url, controller.signal);
    });
  });

  browser.action.onClicked.addListener((tab) => {
    const hostname = hostnameOf(tab.url);
    if (!hostname || tab.id == null) return;
    void toggleDomain(hostname).then((enabled) => {
      if (tab.id != null) void updateAction(tab.id, enabled);
    });
  });
});
