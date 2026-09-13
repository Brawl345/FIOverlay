import {
  type EncodableType,
  encodeCanvas,
  isEncodable,
  paint,
} from './convert';

/** High enough that one round trip stays invisible on a photo. */
const QUALITY = 0.95;

/** One JPEG block: a shift over a whole block moves the DC coefficient far
 * enough to survive quantization, while a single pixel would be rounded away. */
const BLOCK = 8;

export function canRehash(file: { type: string }): boolean {
  return isEncodable(file.type);
}

function randomInt(limit: number): number {
  return Math.floor(Math.random() * limit);
}

/** Lifts or lowers one 8×8 block by a single step on every channel. */
function nudge(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d context');

  const width = Math.min(BLOCK, canvas.width);
  const height = Math.min(BLOCK, canvas.height);
  // Aligned to the grid the encoder itself works on, so the step lands on one
  // block instead of a corner of four.
  const x = randomInt(Math.floor((canvas.width - width) / BLOCK) + 1) * BLOCK;
  const y = randomInt(Math.floor((canvas.height - height) / BLOCK) + 1) * BLOCK;

  const image = context.getImageData(x, y, width, height);
  const pixels = image.data;
  const step = randomInt(2) === 0 ? 1 : -1;
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const value = pixels[index + channel] ?? 0;
      // A channel at the very end of the range moves the other way.
      pixels[index + channel] =
        value + step < 0 || value + step > 255 ? value - step : value + step;
    }
  }
  context.putImageData(image, x, y);
}

/**
 * Returns the image with different bytes and the same look: one block is moved
 * by a step no eye catches, then the file is written again, so the change lives
 * in the pixels and a server that strips metadata keeps it.
 */
export async function rehashFile(file: File): Promise<File> {
  if (!isEncodable(file.type)) return file;
  const type: EncodableType = file.type;

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = paint(bitmap, bitmap.width, bitmap.height, type);
    nudge(canvas);
    const blob = await encodeCanvas(canvas, type, QUALITY);
    return new File([blob], file.name, {
      type,
      lastModified: file.lastModified,
    });
  } finally {
    bitmap.close();
  }
}
