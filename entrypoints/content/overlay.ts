import { type App, createApp } from 'vue';
import type { ContentScriptContext } from '#imports';
import { captureEvents } from './early-events';
import Overlay from './Overlay.vue';
import css from './overlay.css?inline';

interface OverlayInstance {
  pasteFrom: (transfer: DataTransfer | null) => void;
  fail: (messageKey: string) => void;
  dismiss: () => boolean;
  submit: () => void;
  shortcut: (key: string) => boolean;
}

/**
 * Inline `style` attributes are refused under a strict `style-src`, so every
 * host property goes through CSSOM - and with `!important`, because page rules
 * for `dialog` would otherwise reach our host element.
 */
const FRAME_STYLES: readonly [string, string][] = [
  ['all', 'initial'],
  ['position', 'fixed'],
  ['inset', '0'],
  ['display', 'block'],
  ['width', '100%'],
  ['height', '100%'],
  ['max-width', 'none'],
  ['max-height', 'none'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['outline', '0'],
  ['overflow', 'hidden'],
  ['background', 'transparent'],
  ['color-scheme', 'light dark'],
  ['z-index', '2147483647'],
];

const HOST_STYLES: readonly [string, string][] = [
  ['all', 'initial'],
  ['position', 'absolute'],
  ['inset', '0'],
  ['display', 'block'],
];

function style(
  element: HTMLElement,
  declarations: readonly [string, string][],
): void {
  for (const [property, value] of declarations) {
    element.style.setProperty(property, value, 'important');
  }
}

function isEditable(element: Element | null): boolean {
  const active = element as HTMLElement | null;
  if (!active) return false;
  if (active.isContentEditable) return true;
  if (active.tagName === 'TEXTAREA') return true;
  return (
    active.tagName === 'INPUT' && (active as HTMLInputElement).type !== 'file'
  );
}

/** `shadow.activeElement` still resolves inside a closed root we hold. */
function isTextFieldFocused(shadow: ShadowRoot): boolean {
  return isEditable(shadow.activeElement);
}

/**
 * A page field can only hold focus when the dialog could not go modal; typing
 * there must not paste, confirm or open a source in the overlay.
 */
function isPageFieldFocused(host: HTMLElement): boolean {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active !== host && isEditable(active);
}

/**
 * Enter already carries a meaning on these: the URL field submits its form, a
 * focused control activates itself - confirming on top of that would fire twice.
 */
function ownsEnter(shadow: ShadowRoot): boolean {
  if (isTextFieldFocused(shadow)) return true;
  const active = shadow.activeElement;
  return active?.tagName === 'BUTTON' || active?.tagName === 'A';
}

let sheet: CSSStyleSheet | null = null;

function adopt(shadow: ShadowRoot): void {
  try {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    }
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }
}

export function openOverlay(
  ctx: ContentScriptContext,
  input: HTMLInputElement,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const previousFocus = document.activeElement as HTMLElement | null;

    // A <dialog> cannot host a shadow root, so it only provides the top layer
    // and carries a <div> that does.
    const frame = document.createElement('dialog');
    style(frame, FRAME_STYLES);
    const host = document.createElement('div');
    style(host, HOST_STYLES);
    frame.append(host);

    // The e2e build keeps the root open so browser automation can reach it.
    const shadow = host.attachShadow({
      mode: import.meta.env.MODE === 'e2e' ? 'open' : 'closed',
    });
    adopt(shadow);
    const container = document.createElement('div');
    shadow.append(container);
    document.documentElement.append(frame);

    // The top layer beats every stacking context, ancestor transform and
    // fullscreen element on the page; the `open` attribute is the fallback.
    let modal = false;
    try {
      frame.showModal();
      modal = true;
    } catch {
      frame.setAttribute('open', '');
    }

    let app: App | null = null;
    let closed = false;
    let release: (() => void) | null = null;
    let forget: (() => void) | null = null;

    const close = (): void => {
      if (closed) return;
      closed = true;
      release?.();
      forget?.();
      frame.removeEventListener('cancel', onCancel);
      frame.removeEventListener('close', close);
      app?.unmount();
      try {
        if (modal && frame.open) frame.close();
      } catch {
        // Ignore: the page may have removed the frame already.
      }
      frame.remove();
      try {
        previousFocus?.focus?.({ preventScroll: true });
      } catch {
        // Ignore: element gone or not focusable anymore.
      }
      resolve();
    };

    let instance: OverlayInstance | null = null;

    app = createApp(Overlay, {
      accept: input.accept ?? '',
      multiple: input.multiple === true,
      // A page asking for `capture` wants a camera, not a file from the disk.
      capture: input.getAttribute('capture'),
      onConfirm: (files: File[]) => {
        if (assignFiles(input, files)) close();
        else instance?.fail('errorAssignFailed');
      },
      onCancel: close,
    });
    instance = app.mount(container) as unknown as OverlayInstance;

    release = captureEvents({
      paste: (event) => {
        if (isPageFieldFocused(host)) return;
        const clipboard = (event as ClipboardEvent).clipboardData;
        // Typing into our own URL field must keep working - only real files
        // are worth taking away from a focused text field.
        if (isTextFieldFocused(shadow) && !(clipboard?.files?.length ?? 0)) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        instance?.pasteFrom(clipboard);
      },
      keydown: (event) => {
        const key = event as KeyboardEvent;
        if (key.key === 'Escape') {
          event.preventDefault();
          event.stopImmediatePropagation();
          // The large preview eats the first Escape, the overlay the next one.
          if (!instance?.dismiss()) close();
          return;
        }
        if (key.isComposing || key.altKey || key.ctrlKey || key.metaKey) return;
        if (isPageFieldFocused(host)) return;
        if (key.key !== 'Enter') {
          // Single letters open a source, unless they are being typed.
          if (key.key.length !== 1 || key.repeat) return;
          if (isTextFieldFocused(shadow)) return;
          if (instance?.shortcut(key.key)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
          return;
        }
        if (ownsEnter(shadow)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        instance?.submit();
      },
    });

    // A close request that bypasses our Escape handler (the Android back
    // button, a close watcher) walks back one layer like Escape does; a dialog
    // that got closed anyway takes the overlay with it.
    function onCancel(event: Event): void {
      event.preventDefault();
      if (!instance?.dismiss()) close();
    }
    frame.addEventListener('cancel', onCancel);
    frame.addEventListener('close', close);

    forget = ctx.onInvalidated(close);
  });
}

/** Puts the picked files on the input and replays the events a page expects. */
export function assignFiles(
  input: HTMLInputElement,
  files: readonly File[],
): boolean {
  try {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    if (input.files.length !== files.length) return false;
  } catch {
    return false;
  }

  for (const type of ['input', 'change']) {
    input.dispatchEvent(new Event(type, { bubbles: true, composed: true }));
  }
  return true;
}
