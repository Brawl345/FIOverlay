import { describe, expect, it } from 'vitest';
import { canRehash, rehashFile } from '../lib/rehash';

describe('canRehash', () => {
  it('takes the types a canvas can write', () => {
    expect(canRehash({ type: 'image/jpeg' })).toBe(true);
    expect(canRehash({ type: 'image/png' })).toBe(true);
    expect(canRehash({ type: 'image/webp' })).toBe(true);
  });

  it('refuses everything else', () => {
    expect(canRehash({ type: 'image/gif' })).toBe(false);
    expect(canRehash({ type: 'image/svg+xml' })).toBe(false);
    expect(canRehash({ type: 'application/pdf' })).toBe(false);
    expect(canRehash({ type: '' })).toBe(false);
  });
});

describe('rehashFile', () => {
  it('passes a file of another type through untouched', async () => {
    const file = new File(['GIF89a'], 'clip.gif', { type: 'image/gif' });
    expect(await rehashFile(file)).toBe(file);
  });
});
