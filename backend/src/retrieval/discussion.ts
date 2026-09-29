import { fetchPage } from "./fetcher";
import type { Skipped } from "./crawl";

export interface Discussion { url: string; title: string; text: string }
export interface DiscussionResult { snippets: Discussion[]; skipped: Skipped[]; searched: string[] }

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ").replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Public discussion of the company's interviews, via the Hacker News search API (free, keyless, built for programmatic use).
 * A hit only counts if it names the company (or its domain) AND talks about interviewing, so a generic name does not
 * pull in unrelated threads. Nothing found is a normal outcome and is reported honestly.
 */
export async function searchDiscussion(company: string, domain: string): Promise<DiscussionResult> {
  const skipped: Skipped[] = [];
  const name = company.trim();
  const mentions = new RegExp(`\\b(${[name.length >= 3 ? escapeRe(name) : "", escapeRe(domain)].filter(Boolean).join("|")})\\b`, "i");
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`${name} interview`)}&tags=(story,comment)&hitsPerPage=30`;
  const snippets: Discussion[] = [];
  try {
    const res = await fetchPage(url);
    const hits: any[] = JSON.parse(res.body).hits ?? [];
    for (const h of hits) {
      const text = stripHtml(`${h.title ?? h.story_title ?? ""} ${h.story_text ?? ""} ${h.comment_text ?? ""}`);
      const at = text.search(/interview/i);
      if (at < 0 || !mentions.test(text)) continue;
      snippets.push({
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        title: stripHtml(h.title ?? h.story_title ?? "Hacker News comment"),
        text: text.slice(Math.max(0, at - 300), at + 500),
      });
      if (snippets.length >= 6) break;
    }
  } catch (e) {
    skipped.push({ url, reason: (e as Error).message });
  }
  return { snippets, skipped, searched: ["Hacker News (hn.algolia.com search API)"] };
}
