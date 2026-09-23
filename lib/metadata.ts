/**
 * Removes the metadata blocks of an image without touching its pixels: the
 * EXIF, XMP and IPTC containers go, the colour profile stays.
 */

/** A view on a plain buffer, which is what `Blob` and `File` accept. */
type Bytes = Uint8Array<ArrayBuffer>;

/** APP1 (EXIF/XMP), APP3 to APP13, APP15 and the comment segment. APP0 (JFIF),
 * APP2 (ICC profile) and APP14 (Adobe colour transform, which decides how a
 * CMYK or RGB JPEG is decoded) are structural or colour critical and stay. */
function droppedJpegSegment(marker: number): boolean {
  return (
    marker === 0xe1 ||
    (marker >= 0xe3 && marker <= 0xed) ||
    marker === 0xef ||
    marker === 0xfe
  );
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_DROPPED = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);
const WEBP_DROPPED = new Set(['EXIF', 'XMP ']);

function concat(parts: readonly Bytes[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function fourCC(bytes: Bytes, offset: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

export function stripJpeg(bytes: Bytes): Bytes {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;

  const parts: Bytes[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    const marker = bytes[offset + 1] ?? 0;
    // Image data starts at SOS and runs to the end; EOI ends the file.
    if (bytes[offset] !== 0xff || marker === 0xda || marker === 0xd9) break;
    // Any number of 0xFF fill bytes may precede a marker.
    if (marker === 0xff) {
      parts.push(bytes.subarray(offset, offset + 1));
      offset++;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) break;
    if (!droppedJpegSegment(marker)) parts.push(bytes.subarray(offset, end));
    offset = end;
  }
  parts.push(bytes.subarray(offset));
  return concat(parts);
}

export function stripPng(bytes: Bytes): Bytes {
  if (PNG_SIGNATURE.some((value, index) => bytes[index] !== value))
    return bytes;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Bytes[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) break;
    const type = fourCC(bytes, offset + 4);
    if (!PNG_DROPPED.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') break;
  }
  return concat(parts);
}

export function stripWebp(bytes: Bytes): Bytes {
  if (fourCC(bytes, 0) !== 'RIFF' || fourCC(bytes, 8) !== 'WEBP') return bytes;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Bytes[] = [];
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) break;
    // Chunks are padded to an even length; some encoders leave the padding of
    // the last one out.
    const end = Math.min(offset + 8 + size + (size % 2), bytes.length);
    const type = fourCC(bytes, offset);
    if (!WEBP_DROPPED.has(type)) {
      const chunk = bytes.slice(offset, end);
      // The extended header advertises what follows; the metadata bits go too.
      if (type === 'VP8X' && chunk.length > 8) {
        chunk[8] = (chunk[8] ?? 0) & ~0b00001100;
      }
      parts.push(chunk);
    }
    offset = end;
  }

  const body = concat(parts);
  const header = bytes.slice(0, 12);
  new DataView(header.buffer).setUint32(4, body.length + 4, true);
  return concat([header, body]);
}

const STRIPPERS: Record<string, (bytes: Bytes) => Bytes> = {
  'image/jpeg': stripJpeg,
  'image/png': stripPng,
  'image/webp': stripWebp,
};

/** Returns the same file when there is nothing to remove. */
export async function stripMetadata(file: File): Promise<File> {
  const strip = STRIPPERS[file.type.split(';')[0]?.trim() ?? ''];
  if (!strip) return file;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const stripped = strip(bytes);
    if (stripped.length === bytes.length) return file;
    return new File([stripped], file.name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
