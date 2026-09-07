import { extensionForMime, matchesAccept, splitFileName } from './files';

/** The image types every target browser can encode from a canvas. */
export const ENCODABLE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type EncodableType = (typeof ENCODABLE_TYPES)[number];

export function isEncodable(type: string): type is EncodableType {
  return (ENCODABLE_TYPES as readonly string[]).includes(type);
}

/** Short label for a MIME type, e.g. `image/jpeg` becomes `JPG`. */
export function formatLabel(type: string): string {
  return extensionForMime(type).toUpperCase();
}

/**
 * The type an image has to be re-encoded to so `accept` takes it, or null when
 * the field wants something a canvas cannot produce. PNG comes first because it
 * is the only lossless one of the three.
 */
export function targetTypeFor(
  file: { name: string; type: string },
  accept: string,
): EncodableType | null {
  if (!accept.trim()) return null;
  if (!file.type.startsWith('image/')) return null;
  if (file.type === 'image/svg+xml') return null;
  if (matchesAccept(file, accept)) return null;

  return (
    ENCODABLE_TYPES.find((type) =>
      matchesAccept({ name: `image.${extensionForMime(type)}`, type }, accept),
    ) ?? null
  );
}

/**
 * The type an edited image is written back as: its own, as long as a canvas can
 * write it and the field takes it, otherwise the first accepted one.
 */
export function editOutputType(
  file: { name: string; type: string },
  accept: string,
): EncodableType {
  const own = isEncodable(file.type) ? file.type : null;
  const takes = (type: EncodableType): boolean =>
    !accept.trim() ||
    matchesAccept({ name: `image.${extensionForMime(type)}`, type }, accept);

  if (own && takes(own)) return own;
  return ENCODABLE_TYPES.find(takes) ?? 'image/png';
}

/** `photo.webp` + `image/png` becomes `photo.png`. */
export function renameToType(name: string, type: string): string {
  return `${splitFileName(name)[0]}.${extensionForMime(type)}`;
}

export function encodeCanvas(
  canvas: HTMLCanvasElement,
  type: EncodableType,
  quality = 0.92,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))),
      type,
      quality,
    );
  });
}

/** Draws the bitmap onto a fresh canvas, opaque white below a JPEG. */
export function paint(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: EncodableType,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  if (type === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Re-encodes an image, keeping its pixels and stem name. */
export async function convertImage(
  file: File,
  type: EncodableType,
): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const blob = await encodeCanvas(
      paint(bitmap, bitmap.width, bitmap.height, type),
      type,
    );
    return new File([blob], renameToType(file.name, type), {
      type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
