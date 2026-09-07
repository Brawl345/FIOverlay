import { describe, expect, it } from 'vitest';
import {
  editOutputType,
  formatLabel,
  isEncodable,
  renameToType,
  targetTypeFor,
} from '../lib/convert';

const webp = { name: 'shot.webp', type: 'image/webp' };
const avif = { name: 'shot.avif', type: 'image/avif' };
const heic = { name: 'IMG_0001.heic', type: 'image/heic' };

describe('targetTypeFor', () => {
  it('picks a type the field accepts', () => {
    expect(targetTypeFor(avif, 'image/jpeg,image/png')).toBe('image/png');
    expect(targetTypeFor(heic, 'image/jpeg')).toBe('image/jpeg');
    expect(targetTypeFor(avif, '.webp')).toBe('image/webp');
  });

  it('keeps a file the field already takes', () => {
    expect(targetTypeFor(webp, 'image/webp')).toBeNull();
    expect(targetTypeFor(webp, 'image/*')).toBeNull();
    expect(targetTypeFor(webp, '')).toBeNull();
  });

  it('gives up on what a canvas cannot produce', () => {
    expect(targetTypeFor(avif, 'application/pdf')).toBeNull();
    expect(targetTypeFor(avif, '.tiff')).toBeNull();
    expect(
      targetTypeFor({ name: 'notes.txt', type: 'text/plain' }, 'image/png'),
    ).toBeNull();
    expect(
      targetTypeFor({ name: 'logo.svg', type: 'image/svg+xml' }, 'image/png'),
    ).toBeNull();
  });
});

describe('editOutputType', () => {
  it('keeps a type the canvas and the field both take', () => {
    expect(editOutputType(webp, '')).toBe('image/webp');
    expect(editOutputType(webp, 'image/*')).toBe('image/webp');
  });

  it('switches to what the field accepts', () => {
    expect(editOutputType(webp, 'image/jpeg')).toBe('image/jpeg');
    expect(editOutputType(heic, '')).toBe('image/png');
    expect(editOutputType(avif, '.jpg,.jpeg')).toBe('image/jpeg');
  });

  it('falls back to PNG when nothing fits', () => {
    expect(editOutputType(avif, 'application/pdf')).toBe('image/png');
  });
});

describe('renameToType', () => {
  it('swaps the extension', () => {
    expect(renameToType('shot.webp', 'image/png')).toBe('shot.png');
    expect(renameToType('shot', 'image/jpeg')).toBe('shot.jpg');
    expect(renameToType('my.photo.avif', 'image/webp')).toBe('my.photo.webp');
  });
});

describe('formatLabel', () => {
  it('names the type in short form', () => {
    expect(formatLabel('image/jpeg')).toBe('JPG');
    expect(formatLabel('image/webp')).toBe('WEBP');
  });
});

describe('isEncodable', () => {
  it('knows the canvas output types', () => {
    expect(isEncodable('image/png')).toBe(true);
    expect(isEncodable('image/avif')).toBe(false);
  });
});
