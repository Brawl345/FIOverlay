import { browser } from 'wxt/browser';

export const DISABLED_DOMAINS_KEY = 'disabled_domains';

export interface DomainExport {
  format: string;
  version: number;
  disabledDomains: string[];
}

export const EXPORT_FORMAT = 'fioverlay-disabled-domains';
export const EXPORT_VERSION = 1;

/**
 * Turns arbitrary user/import input (`HTTPS://WWW.Example.com/path`, `*.foo.de`,
 * `münchen.de`) into a bare hostname, or null when nothing usable is left.
 * Everything goes through `URL` so an IDN ends up as punycode - the same form
 * `hostnameOf` produces for a visited page, which is what it gets matched
 * against.
 */
export function normalizeDomain(input: string): string | null {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^\.+|\.+$/g, '');
  if (!value || /[\s,]/.test(value)) return null;

  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    return url.hostname.replace(/\.+$/, '') || null;
  } catch {
    return null;
  }
}

export function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return null;
    return hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** A stored entry also covers all of its subdomains. */
export function matchesDomain(hostname: string, entry: string): boolean {
  return hostname === entry || hostname.endsWith(`.${entry}`);
}

export function isDisabled(hostname: string, domains: string[]): boolean {
  return domains.some((entry) => matchesDomain(hostname, entry));
}

export function sortDomains(domains: string[]): string[] {
  return [...new Set(domains)].sort((a, b) => a.localeCompare(b));
}

export async function getDisabledDomains(): Promise<string[]> {
  try {
    const result = await browser.storage.sync.get(DISABLED_DOMAINS_KEY);
    const value = result[DISABLED_DOMAINS_KEY];
    if (!Array.isArray(value)) return [];
    return sortDomains(value.filter((e): e is string => typeof e === 'string'));
  } catch {
    return [];
  }
}

export async function setDisabledDomains(domains: string[]): Promise<string[]> {
  const next = sortDomains(domains);
  await browser.storage.sync.set({ [DISABLED_DOMAINS_KEY]: next });
  return next;
}

/** Returns the new enabled state for `hostname`. */
export async function toggleDomain(hostname: string): Promise<boolean> {
  const domains = await getDisabledDomains();
  const disabled = isDisabled(hostname, domains);
  const next = disabled
    ? domains.filter((entry) => !matchesDomain(hostname, entry))
    : [...domains, hostname];
  await setDisabledDomains(next);
  return disabled;
}

export function buildExport(domains: string[]): DomainExport {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    disabledDomains: sortDomains(domains),
  };
}

/** Accepts both the export envelope and a bare array of domains. */
export function parseImport(raw: string): string[] {
  const data: unknown = JSON.parse(raw);
  const list = Array.isArray(data)
    ? data
    : (data as DomainExport | null)?.disabledDomains;
  if (!Array.isArray(list)) throw new Error('invalid');
  const domains = list
    .filter((entry): entry is string => typeof entry === 'string')
    .map(normalizeDomain)
    .filter((entry): entry is string => entry !== null);
  if (domains.length === 0) throw new Error('empty');
  return sortDomains(domains);
}
