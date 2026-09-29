import type { Kit, Question } from "./kit-schema";
import { allocateSchedule } from "./schedule";

export const req = (id: string, priority: "must" | "nice" = "must", text = `requirement ${id}`) =>
  ({ id, text, kind: "technical" as const, priority });

export const question = (id: string, requirement_ids: string[], difficulty: 1 | 2 | 3 = 2, category: Question["category"] = "technical"): Question =>
  ({ id, requirement_ids, category, prompt: `prompt ${id}`, answer_outline: "outline", difficulty });

export function makeKit(over: Partial<Kit> = {}, days = 3): Kit {
  const requirements = [req("r1"), req("r2", "nice")];
  const questions = [question("q1", ["r1"]), question("q2", ["r2"], 1)];
  return {
    source: { company: "Acme", company_url: "http://localhost/acme", role: "Engineer", location: "", jd_chars: 100, researched_at: "2026-09-29T00:00:00Z", pages_used: [] },
    company_brief: { summary: "s", what_they_do: "w", sources: [] },
    role: { title: "Engineer", seniority: "senior", responsibilities: [], requirements },
    questions,
    flashcards: [{ id: "f1", front: "f", back: "b", requirement_ids: ["r1"] }],
    schedule: allocateSchedule({ requirements, questions, days }),
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    ...over,
  };
}
