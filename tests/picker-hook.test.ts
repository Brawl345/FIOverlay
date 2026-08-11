import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';
import { PICKER_EVENT } from '../lib/messages';
import { installPickerHook } from '../lib/picker-hook';

let uninstall: (() => void) | null = null;
let nativeClick: Mock<() => void>;
let nativeShowPicker: Mock<() => void>;
let announced: HTMLInputElement[];
let cancel = false;

const originalClick = HTMLElement.prototype.click;
const originalShowPicker = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  'showPicker',
);

function onAnnounce(event: Event): void {
  announced.push(event.target as HTMLInputElement);
  if (cancel) event.preventDefault();
}

function fileInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  return input;
}

beforeEach(() => {
  announced = [];
  cancel = true;
  nativeClick = vi.fn<() => void>();
  nativeShowPicker = vi.fn<() => void>();
  HTMLElement.prototype.click = nativeClick;
  HTMLInputElement.prototype.showPicker = nativeShowPicker;
  window.addEventListener(PICKER_EVENT, onAnnounce, true);
  uninstall = installPickerHook();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  window.removeEventListener(PICKER_EVENT, onAnnounce, true);
  document.body.replaceChildren();
  HTMLElement.prototype.click = originalClick;
  if (originalShowPicker) {
    Object.defineProperty(
      HTMLInputElement.prototype,
      'showPicker',
      originalShowPicker,
    );
  } else {
    delete (HTMLInputElement.prototype as { showPicker?: unknown }).showPicker;
  }
});

describe('click on a detached input', () => {
  it('announces the input and keeps the native picker shut', () => {
    const input = fileInput();
    input.click();

    expect(announced).toEqual([input]);
    expect(nativeClick).not.toHaveBeenCalled();
  });

  it('leaves it detached and without a parent', () => {
    const input = fileInput();
    input.click();

    expect(input.isConnected).toBe(false);
    expect(input.parentNode).toBeNull();
  });

  it('puts it back at its old position inside a detached subtree', () => {
    const holder = document.createElement('div');
    const input = fileInput();
    holder.append(input, document.createElement('span'));

    input.click();

    expect(input.parentNode).toBe(holder);
    expect([...holder.childNodes].indexOf(input)).toBe(0);
    expect(input.isConnected).toBe(false);
  });

  it('falls through to the native picker when nobody takes it over', () => {
    cancel = false;
    const input = fileInput();
    input.click();

    expect(announced).toEqual([input]);
    expect(nativeClick).toHaveBeenCalledTimes(1);
  });
});

describe('click on an input the page already inserted', () => {
  it('goes to the native picker, because its event reaches the page', () => {
    const input = fileInput();
    document.body.append(input);
    input.click();

    expect(announced).toEqual([]);
    expect(nativeClick).toHaveBeenCalledTimes(1);
  });
});

describe('inputs that open no file picker', () => {
  it('are left alone', () => {
    const text = document.createElement('input');
    const disabled = fileInput();
    disabled.disabled = true;
    const directory = fileInput();
    directory.setAttribute('webkitdirectory', '');

    for (const input of [text, disabled, directory]) input.click();

    expect(announced).toEqual([]);
    expect(nativeClick).toHaveBeenCalledTimes(3);
  });
});

describe('showPicker', () => {
  it('is announced for a connected input as well', () => {
    const input = fileInput();
    document.body.append(input);
    input.showPicker();

    expect(announced).toEqual([input]);
    expect(nativeShowPicker).not.toHaveBeenCalled();
    expect(input.parentNode).toBe(document.body);
  });

  it('opens natively when nobody takes it over', () => {
    cancel = false;
    const input = fileInput();
    input.showPicker();

    expect(nativeShowPicker).toHaveBeenCalledTimes(1);
  });
});

describe('uninstall', () => {
  it('puts the untouched prototype methods back', () => {
    uninstall?.();
    uninstall = null;

    const input = fileInput();
    input.click();
    input.showPicker();

    expect(announced).toEqual([]);
    expect(nativeClick).toHaveBeenCalledTimes(1);
    expect(nativeShowPicker).toHaveBeenCalledTimes(1);
    expect(Object.hasOwn(HTMLInputElement.prototype, 'click')).toBe(false);
  });
});
