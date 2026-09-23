import { describe, expect, it } from 'vitest';
import { stripJpeg, stripPng, stripWebp } from '../lib/metadata';

function bytes(...values: number[]): Uint8Array<ArrayBuffer> {
  return new Uint8Array(values);
}

function join(...parts: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** `FFxx` segment with a two byte length and `size` payload bytes. */
function segment(
  marker: number,
  size: number,
  fill = 0x11,
): Uint8Array<ArrayBuffer> {
  const length = size + 2;
  return join(
    bytes(0xff, marker, (length >> 8) & 0xff, length & 0xff),
    new Uint8Array(size).fill(fill),
  );
}

function chunk(
  type: string,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(8);
  new DataView(header.buffer).setUint32(0, data.length);
  header.set(
    [...type].map((c) => c.charCodeAt(0)),
    4,
  );
  return join(header, data, bytes(0, 0, 0, 0));
}

function riffChunk(
  type: string,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(8);
  header.set(
    [...type].map((c) => c.charCodeAt(0)),
    0,
  );
  new DataView(header.buffer).setUint32(4, data.length, true);
  const pad = data.length % 2 === 1 ? bytes(0) : bytes();
  return join(header, data, pad);
}

describe('stripJpeg', () => {
  const scan = bytes(0xff, 0xda, 0x00, 0x02, 0x42, 0x42, 0xff, 0xd9);

  it('drops EXIF and comments, keeps JFIF, ICC and the image data', () => {
    const input = join(
      bytes(0xff, 0xd8),
      segment(0xe0, 4), // APP0 / JFIF
      segment(0xe1, 40, 0xaa), // APP1 / EXIF
      segment(0xe2, 6, 0x99), // APP2 / ICC
      segment(0xed, 12), // APP13 / IPTC
      segment(0xfe, 5), // comment
      segment(0xc0, 8), // frame header
      scan,
    );
    const out = stripJpeg(input);
    expect(out.length).toBe(input.length - (44 + 16 + 9));
    expect(Array.from(out.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(out.includes(0xaa)).toBe(false);
    expect(out.includes(0x99)).toBe(true);
    expect(Array.from(out.subarray(out.length - scan.length))).toEqual(
      Array.from(scan),
    );
  });

  it('keeps the Adobe colour transform and skips fill bytes', () => {
    const input = join(
      bytes(0xff, 0xd8),
      segment(0xee, 12, 0x77), // APP14 / Adobe
      bytes(0xff, 0xff), // fill
      segment(0xe1, 20, 0xaa),
      scan,
    );
    const out = stripJpeg(input);
    expect(out.length).toBe(input.length - 24);
    expect(out.includes(0x77)).toBe(true);
    expect(out.includes(0xaa)).toBe(false);
  });

  it('leaves anything that is not a JPEG alone', () => {
    const input = bytes(1, 2, 3, 4, 5, 6);
    expect(stripJpeg(input)).toBe(input);
  });

  it('stops at a broken segment instead of cutting the file', () => {
    const input = join(bytes(0xff, 0xd8), bytes(0xff, 0xe1, 0x7f, 0xff, 0x00));
    expect(stripJpeg(input).length).toBe(input.length);
  });
});

describe('stripPng', () => {
  const signature = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

  it('drops text and EXIF chunks, keeps the image', () => {
    const input = join(
      signature,
      chunk('IHDR', new Uint8Array(13).fill(1)),
      chunk('eXIf', new Uint8Array(20).fill(0xaa)),
      chunk('tEXt', new Uint8Array(9).fill(2)),
      chunk('iCCP', new Uint8Array(6).fill(0x99)),
      chunk('IDAT', new Uint8Array(10).fill(3)),
      chunk('IEND', new Uint8Array(0)),
    );
    const out = stripPng(input);
    expect(out.length).toBe(input.length - 32 - 21);
    expect(out.includes(0xaa)).toBe(false);
    expect(out.includes(0x99)).toBe(true);
  });

  it('leaves anything that is not a PNG alone', () => {
    const input = bytes(9, 9, 9, 9, 9, 9, 9, 9, 9);
    expect(stripPng(input)).toBe(input);
  });
});

describe('stripWebp', () => {
  function webp(...chunks: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
    const body = join(...chunks);
    const header = new Uint8Array(12);
    header.set(
      [...'RIFF'].map((c) => c.charCodeAt(0)),
      0,
    );
    header.set(
      [...'WEBP'].map((c) => c.charCodeAt(0)),
      8,
    );
    new DataView(header.buffer).setUint32(4, body.length + 4, true);
    return join(header, body);
  }

  it('drops EXIF and XMP and fixes the RIFF size', () => {
    const flags = new Uint8Array(10);
    flags[0] = 0b00101100; // ICC + EXIF + XMP
    const input = webp(
      riffChunk('VP8X', flags),
      riffChunk('VP8 ', new Uint8Array(8).fill(7)),
      riffChunk('EXIF', new Uint8Array(12).fill(0xaa)),
      riffChunk('XMP ', new Uint8Array(6).fill(0xbb)),
    );
    const out = stripWebp(input);
    expect(out.includes(0xaa)).toBe(false);
    expect(out.includes(0xbb)).toBe(false);
    expect(out[20]).toBe(0b00100000);
    expect(new DataView(out.buffer).getUint32(4, true)).toBe(out.length - 8);
  });

  it('keeps a last chunk whose padding byte is missing', () => {
    const input = webp(
      riffChunk('EXIF', new Uint8Array(12).fill(0xaa)),
      riffChunk('VP8L', new Uint8Array(9).fill(7)).subarray(0, 17),
    );
    const out = stripWebp(input);
    expect(out.includes(0xaa)).toBe(false);
    expect(out.filter((value) => value === 7).length).toBe(9);
  });

  it('leaves anything that is not a WebP alone', () => {
    const input = bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
    expect(stripWebp(input)).toBe(input);
  });
});
