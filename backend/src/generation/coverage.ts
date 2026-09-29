import { uncoveredMustHaves } from "../kit-schema";
import type { Requirement } from "./extract";
import type { DraftQuestion } from "./questions";

/**
 * Pass 1 is the first draft. Passes 2 and 3 each ask the model only for the gaps, then code re-checks.
 * Why 3: gap-targeted prompts almost always close the gap in one retry; a second retry catches the odd miss;
 * more passes cost rate-limited tokens for no measurable gain. Anything still uncovered gets a clearly labelled
 * template question, so a kit never ships with an uncovered must-have.
 */
export const MAX_PASSES = 3;

export type GapFiller = (gaps: Requirement[], existing: DraftQuestion[]) => Promise<DraftQuestion[]>;

export async function closeCoverageGaps(requirements: Requirement[], draft: DraftQuestion[], fillGaps: GapFiller) {
  const questions = [...draft];
  const check = () => uncoveredMustHaves({ role: { title: "", seniority: "", responsibilities: [], requirements }, questions: questions.map((q, i) => ({ ...q, id: String(i) })) });
  let passes = 1;
  let gaps = check();
  const log: string[] = [`Pass 1: ${gaps.length} uncovered must-have requirement(s)${gaps.length ? `: ${gaps.join(", ")}` : ""}.`];
  while (gaps.length && passes < MAX_PASSES) {
    passes++;
    const gapReqs = requirements.filter((r) => gaps.includes(r.id));
    try { questions.push(...(await fillGaps(gapReqs, questions))); }
    catch (e) { log.push(`Pass ${passes}: gap generation failed (${(e as Error).message}).`); }
    gaps = check();
    log.push(`Pass ${passes}: ${gaps.length} still uncovered${gaps.length ? `: ${gaps.join(", ")}` : ""}.`);
  }
  const templated = [...gaps];
  for (const r of requirements.filter((x) => gaps.includes(x.id))) questions.push(templateQuestion(r));
  if (templated.length) { passes++; log.push(`Pass ${passes}: added template questions for ${templated.join(", ")}; 0 uncovered.`); }
  return { questions, passes, uncovered: check(), templated, log };
}

export function templateQuestion(r: Requirement): DraftQuestion {
  const behavioural = r.kind === "behavioural";
  return {
    requirement_ids: [r.id], category: behavioural ? "behavioural" : "technical", difficulty: 2, origin: "generated", pinned: false,
    prompt: behavioural ? `Tell me about a time you showed this: ${r.text}.` : `Walk me through real work where you applied: ${r.text}. What decisions did you make, and what would you change now?`,
    answer_outline: behavioural
      ? "Situation and your role; the specific actions you took; the measurable result; what you learned. (Template question: the generator did not produce one for this requirement.)"
      : "Context and your role; the key technical decisions and trade-offs; how you verified it worked; the outcome. (Template question: the generator did not produce one for this requirement.)",
  };
}
