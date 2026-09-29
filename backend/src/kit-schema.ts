import { z } from "zod";

export const CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;
export type Category = (typeof CATEGORIES)[number];

const id = z.string().min(1);

export const RequirementSchema = z.object({
  id, text: z.string().min(1),
  kind: z.enum(["technical", "behavioural", "domain"]),
  priority: z.enum(["must", "nice"]),
});

// origin and pinned extend Appendix A (allowed by the brief) to track edited/pinned state.
export const QuestionSchema = z.object({
  id, requirement_ids: z.array(id),
  category: z.enum(CATEGORIES),
  prompt: z.string(),            // may be empty while a user is mid-edit
  answer_outline: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  origin: z.enum(["generated", "edited", "manual"]).optional(),
  pinned: z.boolean().optional(),
});

const FlashcardSchema = z.object({ id, front: z.string(), back: z.string(), requirement_ids: z.array(id) });
const DaySchema = z.object({ day: z.number().int().min(1), focus: z.string(), question_ids: z.array(id), minutes: z.number().int().min(0) });

export const KitSchema = z.object({
  source: z.object({
    company: z.string(), company_url: z.string(), role: z.string(), location: z.string(),
    jd_chars: z.number().int().min(0), researched_at: z.string(), pages_used: z.array(z.string()),
  }),
  // interview_process and hiring_page_found extend Appendix A: what the hiring page (or public discussion) says.
  company_brief: z.object({
    summary: z.string(), what_they_do: z.string(), sources: z.array(z.string()),
    interview_process: z.array(z.object({ stage: z.string(), detail: z.string(), source_url: z.string() })).optional(),
    hiring_page_found: z.boolean().optional(),
  }),
  role: z.object({
    title: z.string(), seniority: z.string(), responsibilities: z.array(z.string()),
    requirements: z.array(RequirementSchema),
  }),
  questions: z.array(QuestionSchema),
  flashcards: z.array(FlashcardSchema),
  schedule: z.object({ days_available: z.number().int().min(1), days: z.array(DaySchema) }),
  coverage: z.object({ uncovered_requirement_ids: z.array(id), passes: z.number().int().min(0) }),
  // Extensions: honest notes about what research could not find, and what each coverage pass did.
  notes: z.array(z.string()).optional(),
  coverage_log: z.array(z.string()).optional(),
}).superRefine((kit, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  const unique = (label: string, ids: string[]) => { if (new Set(ids).size !== ids.length) fail(`duplicate ${label} ids`); };
  unique("requirement", kit.role.requirements.map((r) => r.id));
  unique("question", kit.questions.map((q) => q.id));
  unique("flashcard", kit.flashcards.map((f) => f.id));

  const reqIds = new Set(kit.role.requirements.map((r) => r.id));
  const qIds = new Set(kit.questions.map((q) => q.id));
  for (const item of [...kit.questions, ...kit.flashcards])
    for (const rid of item.requirement_ids) if (!reqIds.has(rid)) fail(`${item.id} references unknown requirement ${rid}`);
  for (const d of kit.schedule.days)
    for (const qid of d.question_ids) if (!qIds.has(qid)) fail(`schedule day ${d.day} references unknown question ${qid}`);
  if (kit.schedule.days.length !== kit.schedule.days_available)
    fail(`schedule has ${kit.schedule.days.length} days but days_available is ${kit.schedule.days_available}`);
});
export type Kit = z.infer<typeof KitSchema>;
export type Question = z.infer<typeof QuestionSchema>;

/** A question survives regeneration of its category if a human wrote, edited or pinned it. */
export const isProtectedQuestion = (q: Pick<Question, "origin" | "pinned">) => (q.origin !== undefined && q.origin !== "generated") || q.pinned === true;

/** Deterministic coverage check. Code decides gaps, never the model. Only must-haves count. */
export function uncoveredMustHaves(kit: Pick<Kit, "role" | "questions">): string[] {
  const covered = new Set(kit.questions.flatMap((q) => q.requirement_ids));
  return kit.role.requirements.filter((r) => r.priority === "must" && !covered.has(r.id)).map((r) => r.id);
}
