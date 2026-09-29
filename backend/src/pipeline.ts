import { CATEGORIES, Category, isProtectedQuestion, Kit, KitSchema, Question } from "./kit-schema";
import { createLlm, LlmClient, LlmError } from "./llm";
import { crawlCompany } from "./retrieval/crawl";
import { searchDiscussion, Discussion } from "./retrieval/discussion";
import { Brief, buildBrief, detectSignals, researchPages, ResearchPage, Signals } from "./generation/brief";
import { closeCoverageGaps } from "./generation/coverage";
import { extractRequirements } from "./generation/extract";
import { buildFlashcards } from "./generation/flashcards";
import { DraftQuestion, GenContext, generateForCategory, planCategories } from "./generation/questions";
import { allocateSchedule } from "./schedule";

// The ordered steps the UI shows. The pipeline reports each one as it starts.
export const STEPS = [
  "Reading the job description",
  "Crawling the company site",
  "Searching for interview discussion",
  "Writing the company brief",
  "Drafting questions by category",
  "Checking coverage",
  "Building your schedule",
];

export interface PipelineInput { jd: string; company_url: string; days: number }
/** Report the step now running, and optionally a warning (for example, a page that could not be fetched). */
export type Progress = (step: string, warning?: string) => Promise<void> | void;

export class PipelineError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** What we keep from research so a later "regenerate brief / category" does not need to crawl again. */
export interface Research { ctx: GenContext; pages: ResearchPage[]; hiringPageUrl: string | null; discussion: Discussion[]; companyUrl: string }

const hostName = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const nameFromHost = (h: string) => { const p = h.split(".")[0] || h; return p.charAt(0).toUpperCase() + p.slice(1); };
const nameFromTitle = (t: string) => t.split(/\s[|\-–—:]\s/)[0].trim().slice(0, 60);

/**
 * The full path, used by both the web app and `npm run evaluate`:
 * extract -> crawl -> discussion -> brief -> questions per category -> coverage loop -> flashcards + schedule -> validate.
 * Each step reacts to what the previous one found (a published take-home or system design round changes the question prompts).
 */
export async function runPipeline(input: PipelineInput, progress: Progress, llm: LlmClient = createLlm()): Promise<{ kit: Kit; research: Research }> {
  const notes: string[] = [];
  const warn = async (step: string, w: string) => { notes.push(w); await progress(step, w); };

  // 1. Pasted text needs no retrieval: go straight to extraction.
  await progress(STEPS[0]);
  let ex;
  try { ex = await extractRequirements(llm, input.jd); }
  catch (e) { throw e instanceof LlmError ? new PipelineError(e.code, `Could not read the job description: ${e.message}`) : e; }
  if (ex.dropped.length) await warn(STEPS[0], `Dropped ${ex.dropped.length} requirement(s) the model suggested that are not in the posting.`);
  if (ex.thin) await warn(STEPS[0], `The job description is short: only ${ex.requirements.length} requirement(s) could be found, so this kit is short on purpose.`);

  // 2. A homepage needs crawling before it is useful.
  await progress(STEPS[1]);
  const crawl = await crawlCompany(input.company_url);
  for (const s of crawl.skipped.slice(0, 6)) await warn(STEPS[1], `Skipped ${s.url}: ${s.reason}`);
  if (!crawl.homeReachable) await warn(STEPS[1], "The company site could not be reached; continuing with the job description only.");
  else if (!crawl.hiringPageUrl) await warn(STEPS[1], "No hiring or interview-process page was found on the company site.");
  const pages = researchPages(crawl);
  const host = hostName(input.company_url);
  const company = ex.company || (pages[0] ? nameFromTitle(pages[0].title) : "") || nameFromHost(host);

  // 3. Public discussion of how they interview.
  await progress(STEPS[2]);
  const disc = await searchDiscussion(company, host);
  for (const s of disc.skipped) await warn(STEPS[2], `Skipped ${s.url}: ${s.reason}`);
  if (!disc.snippets.length) await warn(STEPS[2], `No public discussion of ${company}'s interview process was found (searched ${disc.searched.join(", ")}).`);

  // 4. Brief, and interview-format signals detected by code from the hiring page and discussion.
  await progress(STEPS[3]);
  const { brief, companyName, notes: briefNotes } = await buildBrief(llm, {
    companyName: company, companyUrl: input.company_url, pages, hiringPageUrl: crawl.hiringPageUrl, discussion: disc.snippets,
    unreachableReason: crawl.homeReachable ? undefined : crawl.skipped[0]?.reason,
  });
  for (const n of briefNotes) await warn(STEPS[3], n);
  const hiringText = [crawl.pages.find((p) => p.url === crawl.hiringPageUrl)?.text ?? "", ...disc.snippets.map((d) => d.text)].join("\n");
  const signals: Signals = detectSignals(hiringText);

  const ctx: GenContext = {
    title: ex.title, seniority: ex.seniority, company: companyName, jdExcerpt: input.jd.slice(0, 3000), thin: ex.thin,
    brief: { summary: brief.summary, what_they_do: brief.what_they_do, interview_process: brief.interview_process }, signals,
  };

  // 5. One call per category, each with its own instructions and its own requirements.
  await progress(STEPS[4]);
  const draft: DraftQuestion[] = [];
  for (const plan of planCategories(ex.requirements, ctx)) {
    const reqs = ex.requirements.filter((r) => plan.requirementIds.includes(r.id));
    try { draft.push(...(await generateForCategory(llm, ctx, plan.category, reqs, plan.count, { avoid: draft.map((q) => q.prompt) }))); }
    catch (e) { await warn(STEPS[4], `Could not generate ${plan.category} questions (${(e as Error).message}); the coverage pass will fill must-have gaps.`); }
  }

  // 6. Coverage: code finds gaps, the model fills only those, code checks again.
  await progress(STEPS[5]);
  const cov = await closeCoverageGaps(ex.requirements, draft, (gaps, existing) => {
    const beh = gaps.filter((g) => g.kind === "behavioural"), tech = gaps.filter((g) => g.kind !== "behavioural");
    return Promise.all([
      tech.length ? generateForCategory(llm, ctx, "technical", tech, tech.length, { mustCoverIds: tech.map((g) => g.id), avoid: existing.map((q) => q.prompt) }) : [],
      beh.length ? generateForCategory(llm, ctx, "behavioural", beh, beh.length, { mustCoverIds: beh.map((g) => g.id), avoid: existing.map((q) => q.prompt) }) : [],
    ]).then((r) => r.flat());
  });
  if (cov.templated.length) await warn(STEPS[5], `Added template questions for ${cov.templated.join(", ")} after ${MAX_LABEL} generation passes left them uncovered.`);

  // 7. Deterministic: ids, flashcards, schedule.
  await progress(STEPS[6]);
  const questions: Question[] = cov.questions.map((q, i) => ({ ...q, id: `q${i + 1}` }));
  const kit: Kit = {
    source: {
      company: companyName, company_url: input.company_url, role: ex.title, location: ex.location,
      jd_chars: input.jd.length, researched_at: new Date().toISOString(), pages_used: pages.map((p) => p.url),
    },
    company_brief: brief,
    role: { title: ex.title, seniority: ex.seniority, responsibilities: ex.responsibilities, requirements: ex.requirements },
    questions,
    flashcards: buildFlashcards(questions),
    schedule: allocateSchedule({ requirements: ex.requirements, questions, days: input.days }),
    coverage: { uncovered_requirement_ids: cov.uncovered, passes: cov.passes },
    notes: [...new Set(notes)],
    coverage_log: cov.log,
  };
  const valid = KitSchema.safeParse(kit);
  if (!valid.success) throw new PipelineError("INVALID_KIT", `Generated kit failed validation: ${valid.error.issues[0]?.message}`);
  return { kit: valid.data, research: { ctx, pages, hiringPageUrl: crawl.hiringPageUrl, discussion: disc.snippets, companyUrl: input.company_url } };
}
const MAX_LABEL = "3";

/** New candidates for one category. Protected (edited, manual, pinned) questions stay; the client merges. */
export async function regenerateQuestions(kit: Kit, category: Category, research: Research | null, llm: LlmClient = createLlm()): Promise<Question[]> {
  const ctx = research?.ctx ?? fallbackCtx(kit);
  const plan = planCategories(kit.role.requirements, ctx).find((p) => p.category === category)
    ?? { category, requirementIds: [], count: 3 };
  const reqs = kit.role.requirements.filter((r) => plan.requirementIds.includes(r.id));
  const staying = kit.questions.filter((q) => q.category !== category || isProtectedQuestion(q));
  const coveredElsewhere = new Set(staying.flatMap((q) => q.requirement_ids));
  const mustCoverIds = reqs.filter((r) => r.priority === "must" && !coveredElsewhere.has(r.id)).map((r) => r.id);
  let fresh = await generateForCategory(llm, ctx, category, reqs, plan.count, { avoid: staying.map((q) => q.prompt), mustCoverIds });
  const covered = new Set([...coveredElsewhere, ...fresh.flatMap((q) => q.requirement_ids)]);
  const gaps = reqs.filter((r) => mustCoverIds.includes(r.id) && !covered.has(r.id));
  if (gaps.length) fresh = fresh.concat(await generateForCategory(llm, ctx, category, gaps, gaps.length, { mustCoverIds: gaps.map((g) => g.id), avoid: [...staying, ...fresh].map((q) => q.prompt) }));
  return fresh.map((q, i) => ({ ...q, id: `tmp${i}` }));
}

/** Rebuild only the brief from stored research (no re-crawl). */
export async function regenerateBrief(kit: Kit, research: Research | null, llm: LlmClient = createLlm()): Promise<Brief> {
  const { brief } = await buildBrief(llm, {
    companyName: kit.source.company, companyUrl: kit.source.company_url, pages: research?.pages ?? [],
    hiringPageUrl: research?.hiringPageUrl ?? null, discussion: research?.discussion ?? [],
  });
  return brief;
}

function fallbackCtx(kit: Kit): GenContext {
  return {
    title: kit.role.title, seniority: kit.role.seniority, company: kit.source.company, jdExcerpt: "", thin: kit.role.requirements.length < 3,
    brief: { summary: kit.company_brief.summary, what_they_do: kit.company_brief.what_they_do, interview_process: kit.company_brief.interview_process ?? [] },
    signals: detectSignals(""),
  };
}
export { CATEGORIES };
