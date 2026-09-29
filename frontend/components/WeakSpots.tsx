"use client";
import type { Flashcard, PracticeRecord, Requirement } from "../lib/api";
import { weakSpots } from "../lib/weak-spots";

interface Props { requirements: Requirement[]; cards: Flashcard[]; practice: PracticeRecord; onDrill: (requirementId: string) => void }

/** Creative feature: which job requirements you are weakest on, so you know what the interviewer will expose. */
export default function WeakSpots({ requirements, cards, practice, onDrill }: Props) {
  const spots = weakSpots(requirements, cards, practice).slice(0, 6);
  if (!spots.length) return null;
  return (
    <section aria-labelledby="ws-title" className="mx-auto mt-8 max-w-xl">
      <h2 id="ws-title" className="font-semibold">Weak spots</h2>
      <p className="text-xs text-stone-600">Requirements from the posting, weakest first. Must-haves count double.</p>
      <ul className="mt-2 divide-y divide-stone-200 rounded border border-stone-300 bg-white">
        {spots.map((s) => (
          <li key={s.requirement.id} className="flex flex-wrap items-center gap-2 p-2 text-sm">
            <span className="rounded bg-stone-200 px-1.5 text-xs">{s.requirement.priority === "must" ? "Must" : "Nice"}</span>
            <span className="min-w-0 flex-1">{s.requirement.text}</span>
            <span className="text-xs text-stone-600">
              {s.cards === 0 ? "no cards" : s.practised === 0 ? `${s.cards} card(s), not practised` : `confidence ${s.avgConfidence!.toFixed(1)}/3`}
            </span>
            {s.cards > 0 && <button onClick={() => onDrill(s.requirement.id)} className="rounded border border-stone-400 px-2 py-0.5 text-xs hover:bg-stone-100">Drill</button>}
          </li>
        ))}
      </ul>
    </section>
  );
}
