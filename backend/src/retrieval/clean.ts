import * as cheerio from "cheerio";

export interface CleanPage { title: string; description: string; text: string; links: { url: string; text: string }[] }

/**
 * Turn raw HTML into readable text plus absolute links. Scripts, styles and hidden elements are removed
 * (hidden text is a common place to plant instructions aimed at an AI). Relative links resolve against the page URL.
 */
export function cleanHtml(html: string, pageUrl: string, maxChars = 12_000): CleanPage {
  const $ = cheerio.load(html);
  const links: CleanPage["links"] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!.trim();
    if (!href || /^(mailto|tel|javascript|data):/i.test(href)) return;
    try {
      const u = new URL(href, pageUrl);
      u.hash = "";
      if (seen.has(u.href)) return;
      seen.add(u.href);
      links.push({ url: u.href, text: $(el).text().replace(/\s+/g, " ").trim().slice(0, 120) || ($(el).attr("title") ?? "") });
    } catch { /* unparsable href: skip */ }
  });
  const title = $("title").first().text().trim().slice(0, 200);
  const description = ($('meta[name="description"]').attr("content") ?? $('meta[property="og:description"]').attr("content") ?? "").trim().slice(0, 500);
  $("script,style,noscript,svg,iframe,template,form,[hidden],[aria-hidden=true]").remove();
  $("[style]").filter((_, el) => /display\s*:\s*none|visibility\s*:\s*hidden/i.test($(el).attr("style") ?? "")).remove();
  $("nav,footer,header").remove();
  const root = $("main").length ? $("main") : $("article").length ? $("article") : $("body");
  root.find("h1,h2,h3,h4,li,p,br,div,section,tr").each((_, el) => { $(el).append("\n"); });
  const text = root.text().replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, maxChars);
  return { title, description, text, links };
}

export function plainText(body: string, maxChars = 12_000) {
  return body.replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim().slice(0, maxChars);
}
