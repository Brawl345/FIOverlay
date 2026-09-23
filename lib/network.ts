const PRIVATE_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa',
];

function ipv4Parts(hostname: string): number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  return numbers.every((value) => value <= 255) ? numbers : null;
}

function isPrivateIpv4([a = 0, b = 0]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** `::ffff:7f00:1` carries 127.0.0.1 in its last two groups. */
function mappedIpv4(address: string): number[] | null {
  const match = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (!match) return null;
  const high = Number.parseInt(match[1] ?? '0', 16);
  const low = Number.parseInt(match[2] ?? '0', 16);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isPrivateIpv6(address: string): boolean {
  if (address === '::' || address === '::1') return true;
  const mapped = mappedIpv4(address);
  if (mapped) return isPrivateIpv4(mapped);
  const first = Number.parseInt(address.split(':')[0] || '0', 16);
  // fc00::/7 (unique local), fe80::/10 (link local), ff00::/8 (multicast).
  return (
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00
  );
}

/**
 * True for a host that only makes sense inside the user's own network: loopback,
 * private and link-local addresses, single-label names and the usual intranet
 * suffixes. Expects the canonical form `URL` produces, where every IPv4
 * notation is already normalized to four decimal parts.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (!host) return true;
  if (host.startsWith('[') && host.endsWith(']')) {
    return isPrivateIpv6(host.slice(1, -1));
  }
  const ipv4 = ipv4Parts(host);
  if (ipv4) return isPrivateIpv4(ipv4);
  if (!host.includes('.')) return true;
  return PRIVATE_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  );
}
