import { cleanHtml, plainText } from "./clean";
import { fetchPage } from "./fetcher";
import { isAllowed, robotsFor } from "./robots";
import { FetchError } from "./safe-url";

export type PageKind = "home" | "hiring" | "about" | "other";
export interface CrawledPage { url: string; title: string; description: string; text: string; kind: PageKind }
export interface Skipped { url: string; reason: string }
export interface CrawlResult { pages: CrawledPage[]; skipped: Skipped[]; homeReachable: boolean; hiringPageUrl: string | null }

const HIRING: [RegExp, number][] = [
  [/interview/, 14], [/hiring|recruit/, 10], [/career/, 10], [/\bjobs?\b|openings|positions|vacanc/, 8],
  [/join|work[- ]?with[- ]?us|work[- ]?here/, 7], [/handbook/, 7], [/people|talent/, 4], [/culture|values/, 4], [/process/, 3],
];
const ABOUT: [RegExp, number][] = [
  [/about/, 9], [/company|who[- ]?we[- ]?are|our[- ]?story|mission/, 7], [/engineering/, 4],
  [/product|platform|solutions|what[- ]?we[- ]?do|customers/, 4], [/blog/, 2],
];
const NEGATIVE = /log-?in|sign[- ]?(in|up)|register|privacy|terms|cookie|legal|cart|checkout|password|\/(tag|author|feed)s?\/|\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|css|js|ico)(\?|$)/;
const PROCESS_TERMS = [/interview/i, /hiring process|our process|how we hire/i, /recruit/i, /take[- ]home|assignment/i, /on-?site/i, /technical screen|phone screen|screening call/i, /system design/i, /\bstages?\b|\brounds?\b/i, /offer/i];

/** The hiring page is the fetched page that describes the most interview-process concepts (at least two), decided by code. */
export function pickHiringPage(pages: CrawledPage[]): string | null {
  let best: string | null = null, bestScore = 1;
  for (const p of pages) {
    const score = PROCESS_TERMS.filter((re) => re.test(p.text)).length + (/interview|hiring|process/i.test(p.url) ? 1 : 0);
    if (score > bestScore) { best = p.url; bestScore = score; }
  }
  return best;
}

/** Rank a link by how likely it is to describe the company or how it hires. Pure function: tested directly. */
export function scoreLink(link: { url: string; text: string }, basePath = "/"): { score: number; kind: PageKind } {
  let path: string;
  try { path = decodeURIComponent(new URL(link.url).pathname); } catch { return { score: -100, kind: "other" }; }
  const hay = `${path} ${link.text}`.toLowerCase();
  if (NEGATIVE.test(path.toLowerCase()) || NEGATIVE.test(link.text.toLowerCase())) return { score: -100, kind: "other" };
  const sum = (rules: [RegExp, number][]) => rules.reduce((t, [re, w]) => t + (re.test(hay) ? w : 0), 0);
  const hiring = sum(HIRING), about = sum(ABOUT);
  const depth = path.split("/").filter(Boolean).length;
  const score = Math.max(hiring, about) + (path.startsWith(basePath) ? 2 : 0) - Math.max(0, depth - 3);
  return { score, kind: hiring === 0 && about === 0 ? "other" : hiring >= about ? "hiring" : "about" };
}

const bareHost = (h: string) => h.replace(/^www\./, "");
const sameSite = (u: URL, base: URL) => bareHost(u.hostname) === bareHost(base.hostname) || u.hostname.endsWith(`.${bareHost(base.hostname)}`);

/**
 * Crawl a company site: read the given page, rank every same-site link (plus sitemap entries), fetch the best,
 * and follow links one more level from pages that look relevant. No fixed list of paths.
 * Anything that cannot be fetched is recorded in `skipped` rather than failing the run.
 */
export async function crawlCompany(companyUrl: string, maxPages = Number(process.env.CRAWL_MAX_PAGES ?? 8)): Promise<CrawlResult> {
  const skipped: Skipped[] = [];
  const pages: CrawledPage[] = [];
  let base: URL;
  try { base = new URL(companyUrl); } catch { return { pages, skipped: [{ url: companyUrl, reason: "Not a valid URL" }], homeReachable: false, hiringPageUrl: null }; }
  const basePath = base.pathname.endsWith("/") ? base.pathname : base.pathname.replace(/[^/]*$/, "");
  const visited = new Set<string>();
  const queue = new Map<string, { score: number; kind: PageKind; depth: number }>();

  const enqueue = (links: { url: string; text: string }[], depth: number) => {
    for (const l of links) {
      let u: URL;
      try { u = new URL(l.url); } catch { continue; }
      u.hash = ""; u.search = "";
      if (!sameSite(u, base) || visited.has(u.href)) continue;
      const { score, kind } = scoreLink({ url: u.href, text: l.text }, basePath);
      if (score < 3) continue;
      const prev = queue.get(u.href);
      if (!prev || prev.score < score) queue.set(u.href, { score, kind, depth });
    }
  };

  const load = async (url: string): Promise<{ finalUrl: string; title: string; description: string; text: string; links: { url: string; text: string }[] } | null> => {
    visited.add(url);
    try {
      const u = new URL(url);
      const robots = await robotsFor(u.origin);
      if (!isAllowed(robots, u.pathname)) { skipped.push({ url, reason: "Disallowed by robots.txt" }); return null; }
      const res = await fetchPage(url, { crawlDelayMs: robots.crawlDelayMs });
      visited.add(res.url);
      if (res.contentType.includes("html")) { const c = cleanHtml(res.body, res.url); return { finalUrl: res.url, ...c }; }
      if (res.contentType === "text/plain") return { finalUrl: res.url, title: "", description: "", text: plainText(res.body), links: [] };
      skipped.push({ url, reason: `Unsupported content (${res.contentType})` });
      return null;
    } catch (e) {
      skipped.push({ url, reason: e instanceof FetchError ? e.message : (e as Error).message });
      return null;
    }
  };

  const home = await load(base.href);
  if (!home) return { pages, skipped, homeReachable: false, hiringPageUrl: null };
  pages.push({ url: home.finalUrl, title: home.title, description: home.description, text: home.text, kind: "home" });
  enqueue(home.links, 1);
  enqueue(await sitemapLinks(base, basePath), 1);

  while (pages.length < maxPages && queue.size) {
    const [url, meta] = [...queue.entries()].sort((a, b) => b[1].score - a[1].score)[0];
    queue.delete(url);
    const page = await load(url);
    if (!page || page.text.length < 80) continue;
    pages.push({ url: page.finalUrl, title: page.title, description: page.description, text: page.text, kind: meta.kind });
    if (meta.depth < 2 && meta.kind !== "other") enqueue(page.links, meta.depth + 1);
  }

  return { pages, skipped, homeReachable: true, hiringPageUrl: pickHiringPage(pages) };
}

/** Best effort: sitemap.xml often lists careers or handbook pages that the homepage never links to. */
async function sitemapLinks(base: URL, basePath: string): Promise<{ url: string; text: string }[]> {
  const robots = await robotsFor(base.origin);
  const candidates = [...robots.sitemaps, new URL("sitemap.xml", base).href, `${base.origin}/sitemap.xml`];
  for (const sm of [...new Set(candidates)].slice(0, 3)) {
    try {
      const res = await fetchPage(sm);
      const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]).slice(0, 300);
      const inScope = locs.filter((l) => { try { return new URL(l).pathname.startsWith(basePath); } catch { return false; } });
      if (inScope.length) return inScope.map((url) => ({ url, text: "" }));
    } catch { /* no sitemap: fine */ }
  }
  return [];
}
