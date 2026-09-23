import { type Browser, browser } from 'wxt/browser';
import { defineBackground } from '#imports';
import { bytesToBase64 } from '../lib/base64';
import {
  DomainQuotaError,
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
import { isPrivateHost } from '../lib/network';

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
    await browser.action.setBadgeText({ tabId, text: '' });
  } catch {
    // Tab closed or navigated away before the update landed.
  }
}

/** The state stays as it was; the badge and the tooltip say why. */
async function showToggleError(tabId: number, error: unknown): Promise<void> {
  try {
    await browser.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
    await browser.action.setBadgeText({ tabId, text: '!' });
    await browser.action.setTitle({
      tabId,
      title: t(
        error instanceof DomainQuotaError
          ? 'actionToggleQuotaExceeded'
          : 'actionToggleFailed',
      ),
    });
  } catch {
    // Tab closed in the meantime.
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

function parseHttpUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The background fetch ignores CORS, so a URL the page slipped into a clipboard
 * or drag payload must not read anything the page itself could not: the local
 * network stays off limits unless it is the frame's own origin.
 */
function reachable(
  target: URL,
  request: DownloadRequest,
  frameOrigin: string | null,
): boolean {
  return (
    request.source === 'user' ||
    target.origin === frameOrigin ||
    !isPrivateHost(target.hostname)
  );
}

/**
 * Streamed instead of buffered: the content script gets progress events and no
 * single message has to carry the whole file.
 */
async function streamDownload(
  port: Browser.runtime.Port,
  request: DownloadRequest,
  signal: AbortSignal,
): Promise<void> {
  const send = (event: DownloadEvent): void => {
    try {
      port.postMessage(event);
    } catch {
      // Receiver disconnected mid-download.
    }
  };

  const target = parseHttpUrl(request.url);
  if (!target) {
    send({ type: 'error', error: 'errorInvalidUrl' });
    return;
  }
  const frameOrigin = parseHttpUrl(port.sender?.url)?.origin ?? null;
  if (!reachable(target, request, frameOrigin)) {
    send({ type: 'error', error: 'errorPrivateNetwork' });
    return;
  }

  try {
    const response = await fetch(target, {
      credentials: 'omit',
      redirect: 'follow',
      signal,
    });
    const final = parseHttpUrl(response.url) ?? target;
    if (!reachable(final, request, frameOrigin)) {
      await response.body?.cancel();
      send({ type: 'error', error: 'errorPrivateNetwork' });
      return;
    }
    if (!response.ok) {
      send({ type: 'error', error: 'errorDownloadFailed' });
      return;
    }

    const mime =
      response.headers.get('content-type')?.split(';')[0]?.trim() ||
      'application/octet-stream';
    if (request.source !== 'user' && !mime.startsWith('image/')) {
      await response.body?.cancel();
      send({ type: 'error', error: 'errorNotAnImage' });
      return;
    }

    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel();
      send({ type: 'error', error: 'errorTooLarge' });
      return;
    }

    send({
      type: 'meta',
      mime,
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
    let started = false;
    port.onMessage.addListener((message: DownloadRequest) => {
      if (started) return;
      started = true;
      void streamDownload(port, message, controller.signal);
    });
  });

  browser.action.onClicked.addListener((tab) => {
    const hostname = hostnameOf(tab.url);
    const tabId = tab.id;
    if (!hostname || tabId == null) return;
    toggleDomain(hostname).then(
      (enabled) => updateAction(tabId, enabled),
      (error: unknown) => showToggleError(tabId, error),
    );
  });
});
