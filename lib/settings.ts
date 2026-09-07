import { browser } from 'wxt/browser';

export const STRIP_METADATA_KEY = 'strip_metadata';

/** On unless it was switched off, so a fresh profile hands over clean files. */
export async function getStripMetadata(): Promise<boolean> {
  try {
    const result = await browser.storage.sync.get(STRIP_METADATA_KEY);
    return result[STRIP_METADATA_KEY] !== false;
  } catch {
    return true;
  }
}

export async function setStripMetadata(enabled: boolean): Promise<void> {
  await browser.storage.sync.set({ [STRIP_METADATA_KEY]: enabled });
}
