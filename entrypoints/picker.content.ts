import { defineContentScript } from '#imports';
import { installPickerHook } from '../lib/picker-hook';

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  allFrames: true,
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    installPickerHook();
  },
});
