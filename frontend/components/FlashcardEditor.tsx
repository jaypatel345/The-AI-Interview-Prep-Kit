"use client";
import type { Flashcard } from "../lib/api";

interface Props { cards: Flashcard[]; onChange: (cards: Flashcard[]) => void }

/** Controlled list: the parent owns the cards so Practice mode always sees the latest edits. */
export default function FlashcardEditor({ cards, onChange }: Props) {
  const update = (id: string, patch: Partial<Flashcard>) => onChange(cards.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  /** Same keyboard-reachable reorder the question bank uses, so every list in the kit behaves alike. */
  const move = (id: string, dir: -1 | 1) => {
    const i = cards.findIndex((c) => c.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const field = "w-full resize-y rounded border border-transparent bg-transparent p-1 text-sm hover:border-stone-300 focus:border-teal-700 focus:bg-white focus:outline-none";
  return (
    <section aria-labelledby="fc-title" className="mt-4">
      <div className="flex items-center justify-between">
        <h2 id="fc-title" className="text-xl font-semibold">Flashcards ({cards.length})</h2>
        <button onClick={() => onChange([...cards, { id: `f-${crypto.randomUUID().slice(0, 8)}`, front: "", back: "", requirement_ids: [] }])}
          className="rounded border border-stone-400 px-3 py-1.5 text-sm hover:bg-stone-100">Add flashcard</button>
      </div>
      {cards.length === 0 && <p className="mt-4 rounded border border-dashed border-stone-300 p-6 text-center text-sm text-stone-600">No flashcards yet. Add one.</p>}
      <ol className="mt-4 space-y-3">
        {cards.map((c, i) => (
          <li key={c.id} className="rounded border border-stone-300 bg-white p-3">
            <div className="flex items-start gap-2">
              <textarea aria-label={`Flashcard ${i + 1} front`} placeholder="Front (question)" value={c.front} rows={2}
                onChange={(e) => update(c.id, { front: e.target.value })}
                onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(c.id, e.key === "ArrowUp" ? -1 : 1); } }}
                className={`${field} font-medium`} />
              <div className="flex shrink-0 gap-1">
                <button aria-label={`Move flashcard ${i + 1} up`} title="Move up (Alt+Up)" disabled={i === 0} onClick={() => move(c.id, -1)} className="h-8 w-8 rounded hover:bg-stone-200 disabled:opacity-30">↑</button>
                <button aria-label={`Move flashcard ${i + 1} down`} title="Move down (Alt+Down)" disabled={i === cards.length - 1} onClick={() => move(c.id, 1)} className="h-8 w-8 rounded hover:bg-stone-200 disabled:opacity-30">↓</button>
                <button aria-label={`Delete flashcard ${i + 1}`} title="Delete" onClick={() => onChange(cards.filter((x) => x.id !== c.id))} className="h-8 w-8 rounded hover:bg-stone-200">✕</button>
              </div>
            </div>
            <textarea aria-label={`Flashcard ${i + 1} back`} placeholder="Back (answer)" value={c.back} rows={2} onChange={(e) => update(c.id, { back: e.target.value })} className={`${field} text-stone-700`} />
            {c.requirement_ids.length > 0 && <p className="text-xs text-stone-500">Covers {c.requirement_ids.join(", ")}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
