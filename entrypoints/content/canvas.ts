export interface Dimensions {
  width: number;
  height: number;
}

interface Decoded {
  source: CanvasImageSource;
  /** Pixels the source actually carries. */
  width: number;
  height: number;
  /** True for vector sources, which can be rasterized at any size. */
  scalable: boolean;
  dispose: () => void;
}

function ratio(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

/**
 * Last resort for formats `createImageBitmap` refuses, SVG above all. An
 * `<img>` never runs scripts inside an SVG, but it does load through a blob:
 * URL, which a strict `img-src` may block - hence only as a fallback.
 */
async function decodeViaImage(file: File): Promise<Decoded> {
  const url = URL.createObjectURL(file);
  const dispose = () => URL.revokeObjectURL(url);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) throw new Error('no intrinsic size');
    return {
      source: image,
      width,
      height,
      scalable: file.type === 'image/svg+xml',
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

/**
 * Passing both resize options only preserves the aspect ratio when they already
 * match it, so the target is computed from the natural size - which the caller
 * learns from the first (full) decode and hands back in afterwards.
 */
async function decode(file: File, target: Dimensions | null): Promise<Decoded> {
  const asBitmap = (bitmap: ImageBitmap): Decoded => ({
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    scalable: false,
    dispose: () => bitmap.close(),
  });

  if (target) {
    try {
      return asBitmap(
        await createImageBitmap(file, {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
        }),
      );
    } catch {
      // Some decoders reject the resize options.
    }
  }

  try {
    return asBitmap(await createImageBitmap(file));
  } catch {
    return decodeViaImage(file);
  }
}

/**
 * Square thumbnail, cropped to fill. Returns the image's natural size, or null
 * when it cannot be decoded.
 */
export async function drawCover(
  file: File,
  canvas: HTMLCanvasElement,
  sizeCss: number,
  natural: Dimensions | null = null,
): Promise<Dimensions | null> {
  const side = Math.round(sizeCss * ratio());

  let decoded: Decoded;
  try {
    const scale = natural
      ? Math.min(Math.max(side / natural.width, side / natural.height), 1)
      : 0;
    decoded = await decode(
      file,
      natural
        ? {
            width: Math.max(1, Math.round(natural.width * scale)),
            height: Math.max(1, Math.round(natural.height * scale)),
          }
        : null,
    );
  } catch {
    return null;
  }

  try {
    const context = canvas.getContext('2d');
    if (!context) return null;

    canvas.width = side;
    canvas.height = side;
    canvas.style.width = `${sizeCss}px`;
    canvas.style.height = `${sizeCss}px`;

    const scale = Math.max(side / decoded.width, side / decoded.height);
    const width = Math.round(decoded.width * scale);
    const height = Math.round(decoded.height * scale);
    context.drawImage(
      decoded.source,
      (side - width) / 2,
      (side - height) / 2,
      width,
      height,
    );
    return natural ?? { width: decoded.width, height: decoded.height };
  } finally {
    decoded.dispose();
  }
}

/**
 * Fits the image into a CSS pixel box without upscaling it, and backs every CSS
 * pixel with a device pixel as long as the original has them to give.
 */
export async function drawContain(
  file: File,
  canvas: HTMLCanvasElement,
  box: Dimensions,
  natural: Dimensions | null = null,
): Promise<Dimensions | null> {
  const fit = (size: Dimensions): number =>
    Math.min(box.width / size.width, box.height / size.height, 1);

  let decoded: Decoded;
  try {
    decoded = await decode(
      file,
      natural
        ? (() => {
            const pixelScale = Math.min(fit(natural) * ratio(), 1);
            return {
              width: Math.max(1, Math.round(natural.width * pixelScale)),
              height: Math.max(1, Math.round(natural.height * pixelScale)),
            };
          })()
        : null,
    );
  } catch {
    return null;
  }

  try {
    const context = canvas.getContext('2d');
    if (!context) return null;

    const source = natural ?? { width: decoded.width, height: decoded.height };
    const scale = fit(source);
    const cssWidth = Math.round(source.width * scale);
    const cssHeight = Math.round(source.height * scale);

    // A vector source is rasterized at display resolution instead of its
    // nominal size, which keeps an SVG crisp on a HiDPI screen.
    const pixels = decoded.scalable
      ? {
          width: Math.round(cssWidth * ratio()),
          height: Math.round(cssHeight * ratio()),
        }
      : { width: decoded.width, height: decoded.height };

    canvas.width = pixels.width;
    canvas.height = pixels.height;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    context.drawImage(decoded.source, 0, 0, pixels.width, pixels.height);
    return source;
  } finally {
    decoded.dispose();
  }
}
