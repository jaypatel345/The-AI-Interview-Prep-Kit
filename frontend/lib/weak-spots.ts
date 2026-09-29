import type { Flashcard, PracticeRecord, Requirement } from "./api";

export interface WeakSpot { requirement: Requirement; cards: number; practised: number; avgConfidence: number | null; score: number }

/**
 * Per requirement: how many of its cards were practised and how confident the user felt.
 * Weakness score: unpractised cards count as confidence 0; must-haves weigh double. Highest score = weakest.
 */
export function weakSpots(requirements: Requirement[], cards: Flashcard[], rec: PracticeRecord): WeakSpot[] {
  return requirements.map((r) => {
    const mine = cards.filter((c) => c.requirement_ids.includes(r.id));
    const seen = mine.filter((c) => rec[c.id]);
    const avg = seen.length ? seen.reduce((t, c) => t + rec[c.id].confidence, 0) / seen.length : null;
    const gap = mine.length ? mine.reduce((t, c) => t + (3 - (rec[c.id]?.confidence ?? 0)), 0) / mine.length : 3;
    return { requirement: r, cards: mine.length, practised: seen.length, avgConfidence: avg, score: gap * (r.priority === "must" ? 2 : 1) };
  }).sort((a, b) => b.score - a.score);
}
