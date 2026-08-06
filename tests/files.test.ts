import { describe, expect, it } from 'vitest';
import {
  dataUrlToBlob,
  extensionForMime,
  formatSize,
  generatedName,
  imageUrlFromHtml,
  isDownloadableUrl,
  matchesAccept,
  sanitizeFileName,
} from '../lib/files';

describe('matchesAccept', () => {
  const png = { name: 'shot.PNG', type: 'image/png' };

  it('matches wildcards, exact types and extensions', () => {
    expect(matchesAccept(png, 'image/*')).toBe(true);
    expect(matchesAccept(png, 'image/png')).toBe(true);
    expect(matchesAccept(png, '.png,.jpg')).toBe(true);
    expect(matchesAccept(png, '*/*')).toBe(true);
  });

  it('rejects other types', () => {
    expect(matchesAccept(png, 'application/pdf')).toBe(false);
    expect(matchesAccept(png, '.pdf')).toBe(false);
  });

  it('ignores mime parameters', () => {
    const svg = { name: 'logo.svg', type: 'image/svg+xml; charset=utf-8' };
    expect(matchesAccept(svg, 'image/svg+xml')).toBe(true);
    expect(matchesAccept(svg, 'image/*')).toBe(true);
  });

  it('treats an empty accept as unrestricted', () => {
    expect(matchesAccept(png, '')).toBe(true);
    expect(matchesAccept({ name: 'a', type: '' }, ' , ')).toBe(true);
  });
});

describe('naming', () => {
  it('derives an extension from the mime type', () => {
    expect(extensionForMime('image/JPEG')).toBe('jpg');
    expect(extensionForMime('application/x-thing')).toBe('bin');
  });

  it('generates a timestamped name', () => {
    expect(generatedName('image/png')).toMatch(/^pasted-\d{8}T\d{6}\.png$/);
  });
});

describe('dataUrlToBlob', () => {
  it('decodes base64 payloads', async () => {
    const blob = dataUrlToBlob('data:text/plain;base64,aGk=');
    expect(blob.type).toBe('text/plain');
    expect(await blob.text()).toBe('hi');
  });

  it('decodes percent encoded payloads', async () => {
    expect(await dataUrlToBlob('data:text/plain,a%20b').text()).toBe('a b');
  });

  it('throws on garbage', () => {
    expect(() => dataUrlToBlob('https://example.com/a.png')).toThrow();
  });
});

describe('clipboard html', () => {
  it('picks the first absolute image url', () => {
    expect(
      imageUrlFromHtml(
        '<meta charset="utf-8"><img src="https://x.test/a.png">',
      ),
    ).toBe('https://x.test/a.png');
    expect(imageUrlFromHtml('<img src="/relative.png">')).toBeNull();
    expect(imageUrlFromHtml('<p>no image</p>')).toBeNull();
  });

  it('detects usable urls', () => {
    expect(isDownloadableUrl(' https://x.test/a.png ')).toBe(true);
    expect(isDownloadableUrl('data:image/png;base64,AA')).toBe(true);
    expect(isDownloadableUrl('blob:https://x.test/uuid')).toBe(false);
  });
});

describe('sanitizeFileName', () => {
  it('keeps a readable name and drops path characters', () => {
    expect(sanitizeFileName(' my report:2026/final.pdf ')).toBe(
      'my report_2026_final.pdf',
    );
    expect(sanitizeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(sanitizeFileName('x'.repeat(300)).length).toBe(200);
  });
});

describe('formatSize', () => {
  it('scales units', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
