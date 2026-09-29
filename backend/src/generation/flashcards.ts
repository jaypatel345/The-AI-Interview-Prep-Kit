import type { Kit, Question } from "../kit-schema";

/** Deterministic: one card per question that has an answer outline, must-have material first. No extra model call. */
export function buildFlashcards(questions: Question[], max = 40): Kit["flashcards"] {
  return questions
    .filter((q) => q.prompt.trim() && q.answer_outline.trim())
    .slice(0, max)
    .map((q, i) => ({ id: `f${i + 1}`, front: q.prompt, back: q.answer_outline, requirement_ids: [...q.requirement_ids] }));
}
