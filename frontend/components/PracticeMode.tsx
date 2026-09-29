"use client";
import { useEffect, useMemo, useState } from "react";
import type { Flashcard, PracticeRecord } from "../lib/api";

interface Props { cards: Flashcard[]; initial: PracticeRecord; onSave: (r: PracticeRecord) => void }

/**
 * Ordering: confidence-weighted sort. Unseen cards first, then lowest confidence,
 * then least recently seen. Chosen over spaced repetition because a kit is studied
 * over a few days before a fixed interview date, so long intervals never apply.
 * The order is fixed when a session starts, so cards do not jump while you rate them.
 */
export function orderCards(cards: Flashcard[], rec: PracticeRecord) {
  return [...cards].sort((a, b) => {
    const ca = rec[a.id]?.confidence ?? 0, cb = rec[b.id]?.confidence ?? 0;
    return ca - cb || (rec[a.id]?.seen_at ?? 0) - (rec[b.id]?.seen_at ?? 0);
  });
}

export default function PracticeMode({ cards, initial, onSave }: Props) {
  const [rec, setRec] = useState(initial);
  const [session, setSession] = useState(0);
  const queue = useMemo(() => orderCards(cards, rec), [cards, session]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const card = queue[i];
  const covered = cards.filter((c) => rec[c.id]).length;
  const shaky = cards.filter((c) => rec[c.id]?.confidence === 1).length;

  function rate(confidence: 1 | 2 | 3) {
    const next = { ...rec, [card.id]: { confidence, seen_at: Date.now() } };
    setRec(next); onSave(next); setShown(false); setI(i + 1);
  }

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!card || (e.target as HTMLElement).closest("input,textarea,select")) return;
      if (!shown && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setShown(true); }
      if (shown && ["1", "2", "3"].includes(e.key)) rate(Number(e.key) as 1 | 2 | 3);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (cards.length === 0) return <p className="text-sm text-stone-600">This kit has no flashcards yet.</p>;

  return (
    <section aria-label="Practice" className="mx-auto max-w-xl">
      <p className="text-sm text-stone-700" aria-live="polite">
        Covered {covered} of {cards.length}. {shaky > 0 ? `${shaky} still shaky.` : "None marked shaky."}
      </p>
      <progress className="mt-1 w-full" value={covered} max={cards.length} aria-label="Cards covered" />
      {card ? (
        <div className="mt-4 rounded border border-stone-300 p-5">
          <p className="text-xs text-stone-500">Card {i + 1} of {queue.length}</p>
          <p className="mt-2 text-lg font-medium">{card.front}</p>
          {shown ? (
            <>
              <p className="mt-4 whitespace-pre-wrap text-stone-800">{card.back}</p>
              <div className="mt-5" role="group" aria-label="How confident were you?">
                <p className="text-sm">How confident were you? (press 1, 2 or 3)</p>
                <div className="mt-2 flex gap-2">
                  {([[1, "Not yet"], [2, "Unsure"], [3, "Got it"]] as const).map(([n, t]) => (
                    <button key={n} onClick={() => rate(n)} className="rounded border border-stone-400 px-3 py-1.5 text-sm hover:bg-stone-100">{n}. {t}</button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <button onClick={() => setShown(true)} className="mt-5 rounded bg-teal-700 px-4 py-2 text-sm text-white">Show answer (Space)</button>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded border border-stone-300 p-5 text-center">
          <p>Session complete.</p>
          <button onClick={() => { setSession(session + 1); setI(0); }} className="mt-3 rounded bg-teal-700 px-4 py-2 text-sm text-white">Start next session, least confident first</button>
        </div>
      )}
    </section>
  );
}
