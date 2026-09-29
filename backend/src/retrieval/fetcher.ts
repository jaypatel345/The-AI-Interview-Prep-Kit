import { assertFetchable, FetchError } from "./safe-url";

export const USER_AGENT = "PrepKitBot/1.0 (interview-prep research; respects robots.txt)";
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "application/json", "application/xml", "text/xml"];
const hostDelayMs = () => Number(process.env.CRAWL_DELAY_MS ?? 400);

export interface FetchedPage { url: string; status: number; contentType: string; body: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map<string, number>();

/** Politeness: at most one request per host per CRAWL_DELAY_MS (or the robots.txt crawl-delay, if larger). */
async function throttle(host: string, extraDelayMs = 0) {
  const gap = Math.max(hostDelayMs(), extraDelayMs);
  const now = Date.now();
  const at = Math.max(now, (lastHit.get(host) ?? 0) + gap);
  lastHit.set(host, at);
  if (at > now) await sleep(at - now);
}

/**
 * Fetch one URL safely: validated target (re-checked on every redirect), timeout, size cap,
 * content-type allow-list, per-host throttle, and up to 3 attempts with backoff on 429/5xx/network errors.
 */
export async function fetchPage(raw: string, opts: { crawlDelayMs?: number } = {}): Promise<FetchedPage> {
  let lastError: FetchError | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fetchOnce(raw, opts.crawlDelayMs ?? 0);
    } catch (e) {
      const err = e instanceof FetchError ? e : new FetchError("NETWORK", (e as Error).message);
      const transient = ["NETWORK", "TIMEOUT", "HTTP_429", "HTTP_5XX"].includes(err.code);
      if (!transient) throw err;
      lastError = err;
      if (attempt < 3) await sleep(500 * 2 ** attempt);
    }
  }
  throw new FetchError(lastError!.code, `${lastError!.message} (after 3 attempts)`);
}

async function fetchOnce(raw: string, crawlDelayMs: number): Promise<FetchedPage> {
  let url = await assertFetchable(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await throttle(url.host, crawlDelayMs);
    let res: Response;
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1" } });
    } catch (e) {
      const name = (e as Error).name;
      throw new FetchError(name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK", `${url.href}: ${name === "TimeoutError" ? "timed out" : (e as Error).message}`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await assertFetchable(new URL(res.headers.get("location")!, url).href);   // re-validate every hop
      continue;
    }
    if (res.status === 429) throw new FetchError("HTTP_429", `${url.href}: rate limited`);
    if (res.status >= 500) throw new FetchError("HTTP_5XX", `${url.href}: server error ${res.status}`);
    if (!res.ok) throw new FetchError(`HTTP_${res.status}`, `${url.href}: HTTP ${res.status}`);
    const contentType = (res.headers.get("content-type") ?? "text/html").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.includes(contentType)) throw new FetchError("BAD_CONTENT_TYPE", `${url.href}: skipped ${contentType}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new FetchError("TOO_LARGE", `${url.href}: larger than ${MAX_BYTES} bytes`);
    return { url: url.href, status: res.status, contentType, body: await readCapped(res) };
  }
  throw new FetchError("TOO_MANY_REDIRECTS", `${raw}: too many redirects`);
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel(); break; }       // keep what we have, stop downloading
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
