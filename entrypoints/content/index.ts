import { browser } from 'wxt/browser';
import { defineContentScript } from '#imports';
import { DISABLED_DOMAINS_KEY } from '../../lib/domains';
import type { InitResponse } from '../../lib/messages';
import { installEarlyEvents } from './early-events';
import { openOverlay } from './overlay';

/** How long an Alt+click keeps covering the clicks it forwards. */
const ALT_WINDOW_MS = 1000;

/**
 * Duck typed instead of `instanceof` so retargeted events from other realms
 * (same page iframes, custom elements) are still recognized.
 */
function isFileInput(node: unknown): node is HTMLInputElement {
  const el = node as HTMLInputElement | null;
  return (
    !!el &&
    el.nodeType === 1 &&
    el.tagName === 'INPUT' &&
    el.type === 'file' &&
    !el.disabled &&
    !el.hasAttribute('webkitdirectory')
  );
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  runAt: 'document_start',

  main(ctx) {
    let enabled = false;
    let overlayOpen = false;
    let altAt = Number.NEGATIVE_INFINITY;

    const syncState = async (): Promise<void> => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: 'init',
        })) as InitResponse | undefined;
        enabled = response?.enabled === true;
      } catch {
        enabled = false;
      }
    };
    void syncState();

    const onStorageChanged = (
      changes: Record<string, unknown>,
      area: string,
    ): void => {
      if (area === 'sync' && DISABLED_DOMAINS_KEY in changes) void syncState();
    };
    browser.storage.onChanged.addListener(onStorageChanged);

    const onClick = (event: MouseEvent): void => {
      // A label or a page's upload button forwards a synthetic click to the
      // input that may not carry the modifier, so the last one wins.
      if (event.altKey) altAt = event.timeStamp;

      const target = event.composedPath()[0] ?? event.target;
      if (!isFileInput(target)) return;

      // A page handler re-clicking the input while the overlay is up must not
      // slip a second picker past us.
      if (overlayOpen) {
        event.preventDefault();
        return;
      }

      // Escape hatch: Alt/Option+click hands this one click to the browser, and
      // exactly one - the window only exists to cover a forwarded click.
      if (event.altKey || event.timeStamp - altAt < ALT_WINDOW_MS) {
        altAt = Number.NEGATIVE_INFINITY;
        return;
      }

      if (!enabled || event.defaultPrevented) return;

      event.preventDefault();
      overlayOpen = true;
      void openOverlay(ctx, target).finally(() => {
        overlayOpen = false;
      });
    };

    window.addEventListener('click', onClick, true);
    const removeEarlyEvents = installEarlyEvents(['paste', 'keydown']);

    ctx.onInvalidated(() => {
      window.removeEventListener('click', onClick, true);
      removeEarlyEvents();
      browser.storage.onChanged.removeListener(onStorageChanged);
    });
  },
});
