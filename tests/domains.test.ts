import { describe, expect, it } from 'vitest';
import {
  buildExport,
  hostnameOf,
  isDisabled,
  normalizeDomain,
  parseImport,
  sortDomains,
} from '../lib/domains';

describe('normalizeDomain', () => {
  it('strips scheme, path, wildcard and case', () => {
    expect(normalizeDomain('HTTPS://WWW.Example.com/upload?a=1')).toBe(
      'www.example.com',
    );
    expect(normalizeDomain('*.example.com')).toBe('example.com');
    expect(normalizeDomain('  example.com. ')).toBe('example.com');
  });

  it('punycodes an IDN so it matches a visited hostname', () => {
    expect(normalizeDomain('münchen.de')).toBe('xn--mnchen-3ya.de');
    expect(normalizeDomain('münchen.de')).toBe(
      hostnameOf('https://münchen.de/upload'),
    );
    expect(normalizeDomain('example.com:8080')).toBe('example.com');
  });

  it('rejects unusable input', () => {
    expect(normalizeDomain('')).toBeNull();
    expect(normalizeDomain('two words')).toBeNull();
    expect(normalizeDomain('http://')).toBeNull();
  });
});

describe('hostnameOf', () => {
  it('only accepts http(s) urls', () => {
    expect(hostnameOf('https://Sub.Example.com/x')).toBe('sub.example.com');
    expect(hostnameOf('about:blank')).toBeNull();
    expect(hostnameOf(undefined)).toBeNull();
  });
});

describe('isDisabled', () => {
  it('covers subdomains of a listed entry', () => {
    const list = ['example.com'];
    expect(isDisabled('example.com', list)).toBe(true);
    expect(isDisabled('files.example.com', list)).toBe(true);
    expect(isDisabled('notexample.com', list)).toBe(false);
    expect(isDisabled('example.com.evil.net', list)).toBe(false);
  });
});

describe('import/export', () => {
  it('round trips', () => {
    const exported = buildExport(['b.com', 'a.com', 'a.com']);
    expect(exported.disabledDomains).toEqual(['a.com', 'b.com']);
    expect(parseImport(JSON.stringify(exported))).toEqual(['a.com', 'b.com']);
  });

  it('accepts a bare array and normalizes entries', () => {
    expect(parseImport('["https://WWW.Foo.de/x", "*.bar.de"]')).toEqual([
      'bar.de',
      'www.foo.de',
    ]);
  });

  it('rejects junk', () => {
    expect(() => parseImport('{}')).toThrow();
    expect(() => parseImport('[]')).toThrow();
    expect(() => parseImport('nope')).toThrow();
  });

  it('deduplicates and sorts', () => {
    expect(sortDomains(['b', 'a', 'b'])).toEqual(['a', 'b']);
  });
});
