const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/jxl': 'jxl',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
};

export function extensionForMime(mime: string): string {
  return EXTENSION_BY_MIME[mime.toLowerCase()] ?? 'bin';
}

export function generatedName(mime: string, prefix = 'pasted'): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  return `${prefix}-${stamp}.${extensionForMime(mime)}`;
}

/**
 * Mirrors the browser's own `accept` matching: a comma separated list of
 * extensions (`.png`), exact MIME types and wildcard groups (`image/*`).
 */
export function matchesAccept(
  file: { name: string; type: string },
  accept: string,
): boolean {
  const tokens = accept
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const name = file.name.toLowerCase();
  // `image/svg+xml; charset=utf-8` has to match a plain `image/svg+xml` token.
  const type = (file.type.split(';')[0] ?? '').trim().toLowerCase();
  return tokens.some((token) => {
    if (token.startsWith('.')) return name.endsWith(token);
    if (token === '*/*') return true;
    if (token.endsWith('/*')) return type.startsWith(token.slice(0, -1));
    return type === token;
  });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(dataUrl);
  if (!match) throw new Error('invalid data url');
  const mime = match[1] || 'application/octet-stream';
  const body = match[3] ?? '';
  if (!match[2]) {
    return new Blob([decodeURIComponent(body)], { type: mime });
  }
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** First `<img src>` of a clipboard `text/html` payload, if any. */
export function imageUrlFromHtml(html: string): string | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const src = doc.querySelector('img')?.getAttribute('src')?.trim();
  if (!src) return null;
  if (/^(https?|data):/i.test(src)) return src;
  return null;
}

export function isDownloadableUrl(text: string): boolean {
  return /^(https?|data):/i.test(text.trim());
}

/** Splits `photo.png` into `['photo', '.png']`; a name without one keeps `''`. */
export function splitFileName(name: string): [stem: string, extension: string] {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return [name, ''];
  return [name.slice(0, dot), name.slice(dot)];
}

export function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim()
    .slice(0, 200);
}
