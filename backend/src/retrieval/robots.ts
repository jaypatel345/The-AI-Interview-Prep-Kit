import { fetchPage, USER_AGENT } from "./fetcher";

interface Rules { allow: string[]; disallow: string[]; crawlDelayMs: number; sitemaps: string[] }
const cache = new Map<string, Promise<Rules>>();

/** Minimal robots.txt support: groups for "*" or our bot, longest-match Allow/Disallow, Crawl-delay, Sitemap. */
export function parseRobots(text: string): Rules {
  const rules: Rules = { allow: [], disallow: [], crawlDelayMs: 0, sitemaps: [] };
  const me = USER_AGENT.split("/")[0].toLowerCase();
  let agents: string[] = [], inGroupBody = false, applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "sitemap") { rules.sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (inGroupBody) { agents = []; inGroupBody = false; }
      agents.push(value.toLowerCase());
      applies = agents.some((a) => a === "*" || me.includes(a));
      continue;
    }
    inGroupBody = true;
    if (!applies) continue;
    if (key === "disallow" && value) rules.disallow.push(value);
    if (key === "allow" && value) rules.allow.push(value);
    if (key === "crawl-delay") rules.crawlDelayMs = Math.min(5000, (Number(value) || 0) * 1000);
  }
  return rules;
}

export function isAllowed(rules: Rules, path: string): boolean {
  const match = (p: string) => path.startsWith(p.replace(/\*$/, ""));
  const allow = Math.max(-1, ...rules.allow.filter(match).map((p) => p.length));
  const disallow = Math.max(-1, ...rules.disallow.filter(match).map((p) => p.length));
  return disallow < 0 || allow >= disallow;
}

/** No robots.txt (or unreadable) means everything is allowed, per the standard. */
export function robotsFor(origin: string): Promise<Rules> {
  if (!cache.has(origin)) {
    cache.set(origin, fetchPage(`${origin}/robots.txt`)
      .then((p) => (p.contentType.startsWith("text/") ? parseRobots(p.body) : parseRobots("")))
      .catch(() => parseRobots("")));
  }
  return cache.get(origin)!;
}
