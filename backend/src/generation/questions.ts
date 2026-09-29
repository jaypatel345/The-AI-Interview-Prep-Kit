import { z } from "zod";
import type { Category, Question } from "../kit-schema";
import { LlmClient, untrusted } from "../llm";
import type { Brief, Signals } from "./brief";
import type { Requirement } from "./extract";

export type DraftQuestion = Omit<Question, "id">;
export interface GenContext {
  title: string; seniority: string; company: string; jdExcerpt: string; thin: boolean;
  brief: Pick<Brief, "summary" | "what_they_do" | "interview_process">; signals: Signals;
}
export interface CategoryPlan { category: Category; requirementIds: string[]; count: number }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const DESIGN_HINT = /architect|design|scal|distributed|microservice|system|infrastructure|performance/i;
const SENIOR = /senior|staff|principal|lead|architect|head/i;

/**
 * Which categories to generate, from which requirements, and how many questions. Decided by code:
 * technical/domain requirements feed the technical call, behavioural ones the behavioural call, and a system-design
 * round is added only when the company's process mentions one, the role is senior, or the requirements are about design.
 */
export function planCategories(reqs: Requirement[], ctx: GenContext): CategoryPlan[] {
  const tech = reqs.filter((r) => r.kind !== "behavioural");
  const beh = reqs.filter((r) => r.kind === "behavioural");
  const designReqs = tech.filter((r) => DESIGN_HINT.test(r.text));
  const plan: CategoryPlan[] = [
    { category: "technical", requirementIds: tech.map((r) => r.id), count: ctx.thin ? clamp(tech.length + 1, 2, 4) : clamp(tech.length + 2, 3, 10) },
    { category: "behavioural", requirementIds: beh.map((r) => r.id), count: ctx.thin ? 2 : clamp(beh.length + 1, 2, 6) },
  ];
  if (ctx.signals.system_design || SENIOR.test(`${ctx.seniority} ${ctx.title}`) || designReqs.length > 0)
    plan.push({ category: "system-design", requirementIds: (designReqs.length ? designReqs : tech).map((r) => r.id), count: ctx.signals.system_design ? 3 : 2 });
  plan.push({ category: "company-fit", requirementIds: reqs.filter((r) => r.kind === "domain").map((r) => r.id), count: /unknown|could not/i.test(ctx.brief.what_they_do) ? 2 : 3 });
  return plan;
}

/** Each category gets its own instructions: a React requirement and a mentoring requirement are different jobs. */
function instructions(category: Category, ctx: GenContext): string {
  const process = ctx.brief.interview_process.map((s) => `${s.stage}: ${s.detail}`).join("; ");
  switch (category) {
    case "technical":
      return `Write technical interview questions that test hands-on depth in the listed requirements: concrete scenarios, debugging and trade-offs rather than trivia.
answer_outline: 3-5 points a strong answer covers.` +
        (ctx.signals.take_home ? "\nThe company's process includes a take-home assignment: include one question on how the candidate would scope, build, test and present it with this stack." : "") +
        (ctx.signals.pair_or_live_coding ? "\nThe process includes live or pair programming: include one small problem to talk through live." : "");
    case "behavioural":
      return `Write behavioural questions that ask for a specific past example (mentoring, communication, ownership, collaboration, as the requirements say).
answer_outline: STAR notes: which situation to choose, the actions to stress, and the result to quantify.` +
        (ctx.signals.behavioural_round ? "\nThe company runs a dedicated behavioural or values round; match its framing." : "");
    case "system-design":
      return `Write system design questions sized for a ${ctx.seniority || "mid-level"} ${ctx.title || "engineer"}, set in the company's domain if the brief states it.
answer_outline: clarify requirements, main components, data model, scaling and failure modes, trade-offs.` +
        (ctx.signals.system_design ? `\nThe company's published process includes a system design round (${process || "details not given"}); match that format.` : "");
    case "company-fit":
      return `Write questions about motivation and fit with this specific company. Use only facts in the company brief.
If the brief says little is known, write general motivation questions and do not invent company facts.
answer_outline: which facts from the brief to reference, and what the candidate should research further.`;
  }
}

const Out = z.object({
  questions: z.array(z.object({
    prompt: z.string(), answer_outline: z.string().catch(""),
    difficulty: z.coerce.number().catch(2), requirement_ids: z.array(z.string()).catch([]),
  })).catch([]),
});
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export async function generateForCategory(
  llm: LlmClient, ctx: GenContext, category: Category, reqs: Requirement[], count: number,
  opts: { avoid?: string[]; mustCoverIds?: string[] } = {},
): Promise<DraftQuestion[]> {
  const allowed = new Set(reqs.map((r) => r.id));
  const reqList = reqs.length ? reqs.map((r) => `${r.id} (${r.priority}, ${r.kind}): ${r.text}`).join("\n") : "(none: base questions on the role title and brief)";
  const user = [
    `Role: ${ctx.title || "unknown"} (${ctx.seniority || "seniority not stated"}) at ${ctx.company || "the company"}.`,
    `Company brief: ${ctx.brief.summary} ${ctx.brief.what_they_do}`,
    `Requirements for this category (use only these ids in requirement_ids):`, untrusted("requirements from the job description", reqList, 4000),
    opts.mustCoverIds?.length ? `Every one of these ids must be covered by at least one question: ${opts.mustCoverIds.join(", ")}.` : "",
    opts.avoid?.length ? `Do not repeat these existing questions:\n${opts.avoid.slice(0, 25).map((p) => `- ${p}`).join("\n")}` : "",
    ctx.thin ? "The posting is very short. Keep questions tied to what it actually says." : "",
    `Write ${count} questions. Return JSON: {"questions": [{"prompt": "", "answer_outline": "", "difficulty": 1, "requirement_ids": ["r1"]}]} where difficulty is 1 (easy), 2 or 3 (hard).`,
  ].filter(Boolean).join("\n\n");

  const out = await llm.json({ label: `${category} questions`, system: `You write interview practice questions in the "${category}" category.\n${instructions(category, ctx)}`, user, schema: Out, maxTokens: 3500 });
  const taken = new Set((opts.avoid ?? []).map(norm));
  const result: DraftQuestion[] = [];
  for (const q of out.questions) {
    const prompt = q.prompt.trim();
    if (!prompt || taken.has(norm(prompt))) continue;
    taken.add(norm(prompt));
    result.push({
      requirement_ids: [...new Set(q.requirement_ids.filter((id) => allowed.has(id)))],   // the model cannot claim coverage of ids it was not given
      category, prompt: prompt.slice(0, 1000), answer_outline: q.answer_outline.trim().slice(0, 3000),
      difficulty: clamp(Math.round(q.difficulty) || 2, 1, 3) as 1 | 2 | 3, origin: "generated", pinned: false,
    });
  }
  return result.slice(0, count + 2);
}
