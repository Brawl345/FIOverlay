import { PICKER_EVENT } from './messages';

function isFilePicker(input: HTMLInputElement): boolean {
  return (
    input.type === 'file' &&
    !input.disabled &&
    !input.hasAttribute('webkitdirectory')
  );
}

/**
 * A detached input's events reach no listener outside itself, so it is parked
 * in the document for the announcement and put back exactly where it came from.
 * Returns whether a listener took the picker over.
 */
function announce(input: HTMLInputElement): boolean {
  const connected = input.isConnected;
  const parent = input.parentNode;
  const sibling = input.nextSibling;
  if (!connected) document.documentElement.append(input);
  try {
    return !input.dispatchEvent(
      new Event(PICKER_EVENT, {
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  } finally {
    if (!connected) {
      if (parent) parent.insertBefore(input, sibling);
      else input.remove();
    }
  }
}

function restore(
  target: object,
  name: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) Object.defineProperty(target, name, descriptor);
  else delete (target as Record<string, unknown>)[name];
}

/**
 * Announces every picker the page opens on its own. Runs in the page's world,
 * so it patches the page's prototypes; the returned function puts them back.
 */
export function installPickerHook(): () => void {
  const proto = HTMLInputElement.prototype;
  const clickDescriptor = Object.getOwnPropertyDescriptor(proto, 'click');
  const pickerDescriptor = Object.getOwnPropertyDescriptor(proto, 'showPicker');
  const elementClick = HTMLElement.prototype.click;
  const showPicker = proto.showPicker;

  proto.click = function (this: HTMLInputElement): void {
    if (isFilePicker(this) && !this.isConnected && announce(this)) return;
    elementClick.call(this);
  };

  // Opening the picker directly produces no click at all, connected or not.
  if (typeof showPicker === 'function') {
    proto.showPicker = function (this: HTMLInputElement): void {
      if (isFilePicker(this) && announce(this)) return;
      showPicker.call(this);
    };
  }

  return () => {
    restore(proto, 'click', clickDescriptor);
    restore(proto, 'showPicker', pickerDescriptor);
  };
}
