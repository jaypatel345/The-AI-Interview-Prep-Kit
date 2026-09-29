import type { Category, Kit, Question } from "./kit-schema";

type Requirement = Kit["role"]["requirements"][number];
export type Schedule = Kit["schedule"];

// Estimated minutes to work through one question, by difficulty. Integers only.
const MINUTES_BY_DIFFICULTY = { 1: 10, 2: 15, 3: 25 } as const;
const REVIEW_BATCH = 3;

const CATEGORY_LABEL: Record<Category, string> = {
  technical: "Technical", behavioural: "Behavioural", "system-design": "System design", "company-fit": "Company fit",
};

/** Higher score = study earlier. A question covering a must-have outranks any question that does not. */
export function scoreQuestion(q: Question, priorityById: Map<string, Requirement["priority"]>): number {
  const coversMust = q.requirement_ids.some((id) => priorityById.get(id) === "must");
  return (coversMust ? 10 : 0) + q.difficulty;
}

const minutesFor = (qs: Question[]) => qs.reduce((sum, q) => sum + MINUTES_BY_DIFFICULTY[q.difficulty], 0);

/**
 * Deterministic schedule allocation. No model involved.
 *
 * 1. Rank every question by score (must-have first, then harder first; ties keep original order).
 * 2. Cut the ranked list into contiguous chunks, one per day, as even as possible with any
 *    remainder going to the earliest days. Contiguous cuts mean day 1 holds the highest-ranked
 *    material and the last day holds the lightest, so nothing hard lands the night before.
 * 3. If there are fewer questions than days, the spare days become review days that revisit
 *    the highest-ranked questions again in batches, rather than empty days.
 *
 * The result always has exactly `days` entries, and every question appears at least once.
 */
export function allocateSchedule(input: { requirements: Requirement[]; questions: Question[]; days: number }): Schedule {
  const dayCount = Math.max(1, Math.floor(input.days) || 1);
  const priorityById = new Map(input.requirements.map((r) => [r.id, r.priority]));
  const textById = new Map(input.requirements.map((r) => [r.id, r.text]));

  const ranked = input.questions
    .map((q, index) => ({ q, index, score: scoreQuestion(q, priorityById) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.q);

  if (ranked.length === 0) {
    return {
      days_available: dayCount,
      days: Array.from({ length: dayCount }, (_, i) => ({ day: i + 1, focus: "No questions to study yet", question_ids: [], minutes: 0 })),
    };
  }

  const studyDays = Math.min(dayCount, ranked.length);
  const base = Math.floor(ranked.length / studyDays);
  const extra = ranked.length % studyDays;

  const days: Schedule["days"] = [];
  let cursor = 0;
  for (let d = 0; d < studyDays; d++) {
    const chunk = ranked.slice(cursor, cursor + base + (d < extra ? 1 : 0));
    cursor += chunk.length;
    days.push({ day: d + 1, focus: focusFor(chunk, textById), question_ids: chunk.map((q) => q.id), minutes: minutesFor(chunk) });
  }

  for (let r = 0; days.length < dayCount; r++) {
    const batch = Array.from({ length: Math.min(REVIEW_BATCH, ranked.length) }, (_, i) => ranked[(r * REVIEW_BATCH + i) % ranked.length]);
    days.push({ day: days.length + 1, focus: "Review: revisit earlier questions", question_ids: batch.map((q) => q.id), minutes: minutesFor(batch) });
  }

  return { days_available: dayCount, days };
}

function focusFor(chunk: Question[], textById: Map<string, string>): string {
  const counts = new Map<Category, number>();
  for (const q of chunk) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const topic = chunk[0].requirement_ids.map((id) => textById.get(id)).find(Boolean);
  const short = topic && topic.length > 50 ? `${topic.slice(0, 47)}...` : topic;
  return `${CATEGORY_LABEL[dominant]}: ${short ?? "general preparation"}`;
}
