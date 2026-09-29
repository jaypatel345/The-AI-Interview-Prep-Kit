import { z } from "zod";
import type { CrawlResult } from "../retrieval/crawl";
import type { Discussion } from "../retrieval/discussion";
import { LlmClient, untrusted } from "../llm";

export interface Stage { stage: string; detail: string; source_url: string }
export interface Signals { take_home: boolean; system_design: boolean; pair_or_live_coding: boolean; behavioural_round: boolean }
export interface Brief { summary: string; what_they_do: string; sources: string[]; interview_process: Stage[]; hiring_page_found: boolean }
export interface ResearchPage { url: string; title: string; description: string; kind: string; text: string }

/** Interview-format signals are detected by code from the text we found, so they cannot be invented. */
export function detectSignals(text: string): Signals {
  return {
    take_home: /take[- ]home|home assignment|coding assignment|technical assignment|work sample/i.test(text),
    system_design: /system design|architecture (interview|round|discussion)|design interview/i.test(text),
    pair_or_live_coding: /pair(ing)?[- ]program|live coding|live[- ]code|whiteboard/i.test(text),
    behavioural_round: /behaviou?ral|culture (fit|interview)|values interview/i.test(text),
  };
}

const BriefSchema = z.object({
  company_name: z.string().catch(""), summary: z.string().catch(""), what_they_do: z.string().catch(""),
  interview_process: z.array(z.object({ stage: z.string(), detail: z.string().catch(""), source_url: z.string().catch("") })).catch([]),
});

const SYSTEM = `You write a short, factual company brief for someone preparing for an interview.
Return JSON: {"company_name": "", "summary": "", "what_they_do": "", "interview_process": [{"stage": "", "detail": "", "source_url": ""}]}
- summary: 2-3 sentences a candidate should know. what_they_do: products, customers and market, as the content states them.
- interview_process: only stages the content explicitly describes, in order, each with the URL of the content that says it. Empty list if none are described.
- Content from forums is people's reports, not official; say "reportedly" when you use it.
- If the content says little about the company, say so plainly. Do not fill gaps from general knowledge.`;

export function researchPages(crawl: CrawlResult): ResearchPage[] {
  const order = { hiring: 0, home: 1, about: 2, other: 3 } as Record<string, number>;
  return [...crawl.pages].sort((a, b) => (a.url === crawl.hiringPageUrl ? -1 : b.url === crawl.hiringPageUrl ? 1 : order[a.kind] - order[b.kind]))
    .map((p) => ({ url: p.url, title: p.title, description: p.description, kind: p.kind, text: p.text.slice(0, p.url === crawl.hiringPageUrl ? 6000 : 2500) }));
}

export async function buildBrief(llm: LlmClient, input: {
  companyName: string; companyUrl: string; pages: ResearchPage[]; hiringPageUrl: string | null; discussion: Discussion[]; unreachableReason?: string;
}): Promise<{ brief: Brief; companyName: string; notes: string[] }> {
  const notes: string[] = [];
  const host = (() => { try { return new URL(input.companyUrl).host; } catch { return input.companyUrl; } })();
  const hiringNote = input.hiringPageUrl ? "" : ` ${host} does not publish a hiring or interview-process page that we could find, so the questions are based on the job description.`;

  if (input.pages.length === 0) {
    notes.push(`The company site could not be read${input.unreachableReason ? ` (${input.unreachableReason})` : ""}. The brief is honest about that rather than guessed.`);
    return {
      companyName: input.companyName,
      notes,
      brief: {
        summary: `We could not retrieve any pages from ${host}, so we have no verified information about ${input.companyName || "this company"}. Research the company yourself before the interview.`,
        what_they_do: "Unknown: the company site could not be read.",
        sources: [], interview_process: stagesFromDiscussion(input.discussion), hiring_page_found: false,
      },
    };
  }

  let budget = 12_000;
  const blocks: string[] = [];
  for (const p of input.pages) {
    if (budget <= 0) break;
    const body = `${p.title}\n${p.description}\n${p.text}`.slice(0, budget);
    budget -= body.length;
    blocks.push(untrusted(p.url, body, 6500));
  }
  for (const d of input.discussion.slice(0, 4)) blocks.push(untrusted(`${d.url} (forum post)`, d.text, 800));
  const allowed = new Set([...input.pages.map((p) => p.url), ...input.discussion.map((d) => d.url)]);

  try {
    const out = await llm.json({
      label: "company brief", system: SYSTEM, schema: BriefSchema, maxTokens: 1500,
      user: `Company: ${input.companyName || "(name not given)"}, site ${input.companyUrl}\n\n${blocks.join("\n\n")}`,
    });
    const stages = out.interview_process.filter((s) => s.stage.trim() && allowed.has(s.source_url)).slice(0, 8);
    return {
      companyName: input.companyName || out.company_name.trim(),
      notes,
      brief: {
        summary: (out.summary.trim() || "The site's content says little about the company.") + hiringNote,
        what_they_do: out.what_they_do.trim() || "Not stated on the pages we could read.",
        sources: [...new Set([...input.pages.map((p) => p.url), ...stages.map((s) => s.source_url)])],
        interview_process: stages, hiring_page_found: !!input.hiringPageUrl,
      },
    };
  } catch (e) {
    const home = input.pages[0];
    notes.push(`The AI summary step failed (${(e as Error).message}); the brief uses the site's own title and description.`);
    return {
      companyName: input.companyName,
      notes,
      brief: {
        summary: `${home.title}${home.description ? `: ${home.description}` : ""}`.trim() + hiringNote,
        what_they_do: home.description || "Not summarised.",
        sources: input.pages.map((p) => p.url), interview_process: [], hiring_page_found: !!input.hiringPageUrl,
      },
    };
  }
}

function stagesFromDiscussion(d: Discussion[]): Stage[] {
  return d.slice(0, 2).map((x) => ({ stage: "Reported publicly (unverified)", detail: x.text.slice(0, 300), source_url: x.url }));
}
