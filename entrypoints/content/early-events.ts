type Handler = (event: Event) => void;

const active = new Map<string, Handler>();

function forward(event: Event): void {
  active.get(event.type)?.(event);
}

/**
 * Capture listeners on the same target run in registration order, so these are
 * installed at document_start - a page listener added later can no longer
 * swallow the event before the overlay sees it.
 */
export function installEarlyEvents(types: readonly string[]): () => void {
  for (const type of types) window.addEventListener(type, forward, true);
  return () => {
    active.clear();
    for (const type of types) window.removeEventListener(type, forward, true);
  };
}

export function captureEvents(handlers: Record<string, Handler>): () => void {
  for (const [type, handler] of Object.entries(handlers)) {
    active.set(type, handler);
  }
  return () => {
    for (const type of Object.keys(handlers)) active.delete(type);
  };
}
