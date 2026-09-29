import dns from "dns/promises";
import net from "net";

export class FetchError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Private and loopback targets are allowed for local development and the batch command (cases may be served from localhost). */
export const allowPrivateTargets = () =>
  process.env.ALLOW_PRIVATE_URLS === "true" || (process.env.NODE_ENV !== "production" && process.env.ALLOW_PRIVATE_URLS !== "false");

export function isPrivateIp(ip: string): boolean {
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice(7));
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

/** Validates a URL before any request: scheme, no credentials, and (in production) no private or loopback address. */
export async function assertFetchable(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new FetchError("INVALID_URL", `Not a valid URL: ${raw.slice(0, 100)}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchError("INVALID_URL", "Only http and https URLs are fetched.");
  if (url.username || url.password) throw new FetchError("INVALID_URL", "URLs with credentials are not fetched.");
  if (!allowPrivateTargets()) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: string[];
    try { addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address); }
    catch { throw new FetchError("DNS_FAILED", `Could not resolve ${host}.`); }
    if (addresses.some(isPrivateIp)) throw new FetchError("BLOCKED_ADDRESS", `${host} resolves to a private address.`);
  }
  return url;
}
