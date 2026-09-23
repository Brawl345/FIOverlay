import { describe, expect, it } from 'vitest';
import { isPrivateHost } from '../lib/network';

const host = (url: string): string => new URL(url).hostname;

describe('isPrivateHost', () => {
  it.each([
    'http://localhost/',
    'http://app.localhost/',
    'http://127.0.0.1/',
    'http://0x7f.1/',
    'http://2130706433/',
    'http://10.1.2.3/',
    'http://172.20.0.1/',
    'http://192.168.178.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.100.1.1/',
    'http://0.0.0.0/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://router/',
    'http://nas.local/',
    'http://printer.home.arpa/',
    'http://wiki.corp/',
  ])('%s is private', (url) => {
    expect(isPrivateHost(host(url))).toBe(true);
  });

  it.each([
    'https://example.com/',
    'https://i.imgur.com/a.png',
    'http://8.8.8.8/',
    'http://172.32.0.1/',
    'http://[2001:db8::1]/',
    'https://localhost.example.com/',
  ])('%s is public', (url) => {
    expect(isPrivateHost(host(url))).toBe(false);
  });
});
