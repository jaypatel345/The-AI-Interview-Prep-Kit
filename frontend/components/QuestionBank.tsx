"use client";

import { useReducer, useState } from "react";
import { useDebouncedSave } from "../lib/use-debounced-save";
import {
  CATEGORIES,
  Category,
  Question,
  isProtected,
  questionsReducer,
} from "../lib/question-state";

interface Props {
  initial: Question[];
  /** Called (debounced) with the full list after any local change. Persist here. */
  onChange?: (questions: Question[]) => void;
  /** Fetches replacement questions for one category from your backend. */
  regenerate: (category: Category) => Promise<Question[]>;
}

const label: Record<Category, string> = {
  technical: "Technical",
  behavioural: "Behavioural",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export default function QuestionBank({ initial, onChange, regenerate }: Props) {
  const [questions, dispatch] = useReducer(questionsReducer, initial);
  const [active, setActive] = useState<Category>("technical");
  const [busy, setBusy] = useState<Category | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Local state updates instantly; persistence is debounced so typing never waits on the network.
  useDebouncedSave(questions, (qs) => onChange?.(qs));

  const visible = questions.filter((q) => q.category === active);

  async function handleRegenerate() {
    setBusy(active);
    setError(null);
    try {
      const incoming = await regenerate(active);
      dispatch({ type: "regenerated", category: active, incoming });
    } catch (e) {
      setError(`Could not regenerate ${label[active].toLowerCase()} questions. Your existing questions are unchanged. Try again.`);
    } finally {
      setBusy(null);
    }
  }

  const protectedCount = visible.filter(isProtected).length;

  return (
    <section aria-labelledby="qb-title" className="mx-auto w-full max-w-3xl px-4 py-6">
      <h2 id="qb-title" className="text-xl font-semibold text-stone-900">Question bank</h2>

      <div role="tablist" aria-label="Question categories" className="mt-4 flex gap-1 overflow-x-auto border-b border-stone-300">
        {CATEGORIES.map((c) => {
          const n = questions.filter((q) => q.category === c).length;
          return (
            <button
              key={c}
              role="tab"
              aria-selected={active === c}
              onClick={() => setActive(c)}
              className={`whitespace-nowrap px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 ${
                active === c ? "border-b-2 border-teal-700 font-medium text-stone-900" : "text-stone-600 hover:text-stone-900"
              }`}
            >
              {label[c]} ({n})
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={handleRegenerate}
          disabled={busy !== null}
          className="rounded bg-teal-700 px-3 py-1.5 text-sm text-white hover:bg-teal-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          {busy === active ? "Regenerating…" : `Regenerate ${label[active].toLowerCase()}`}
        </button>
        <button
          onClick={() => dispatch({ type: "add", id: crypto.randomUUID(), category: active })}
          className="rounded border border-stone-400 px-3 py-1.5 text-sm hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          Add question
        </button>
        {protectedCount > 0 && (
          <span className="text-xs text-stone-600">
            {protectedCount} edited or pinned {protectedCount === 1 ? "question stays" : "questions stay"} when you regenerate.
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {visible.length === 0 && busy !== active ? (
        <p className="mt-6 rounded border border-dashed border-stone-300 p-6 text-center text-sm text-stone-600">
          No {label[active].toLowerCase()} questions yet. Add one, or regenerate this category.
        </p>
      ) : (
        <ol className="mt-4 space-y-3" aria-busy={busy === active}>
          {visible.map((q, i) => (
            <li
              key={q.id}
              tabIndex={-1}
              onKeyDown={(e) => {
                if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                  e.preventDefault();
                  dispatch({ type: "move", id: q.id, dir: e.key === "ArrowUp" ? -1 : 1 });
                }
              }}
              className={`rounded border p-3 ${busy === active && !isProtected(q) ? "opacity-50" : ""} ${
                isProtected(q) ? "border-teal-700/50 bg-white" : "border-stone-300 bg-stone-50"
              }`}
            >
              <div className="flex items-start gap-2">
                <textarea
                  aria-label={`Question ${i + 1} prompt`}
                  value={q.prompt}
                  placeholder="Write the question"
                  rows={2}
                  onChange={(e) => dispatch({ type: "edit", id: q.id, patch: { prompt: e.target.value } })}
                  className="w-full resize-y rounded border border-transparent bg-transparent p-1 text-sm font-medium hover:border-stone-300 focus:border-teal-700 focus:bg-white focus:outline-none"
                />
                <div className="flex shrink-0 gap-1">
                  <IconBtn label="Move up" disabled={i === 0} onClick={() => dispatch({ type: "move", id: q.id, dir: -1 })}>↑</IconBtn>
                  <IconBtn label="Move down" disabled={i === visible.length - 1} onClick={() => dispatch({ type: "move", id: q.id, dir: 1 })}>↓</IconBtn>
                  <IconBtn label={q.pinned ? "Unpin question" : "Pin question"} pressed={q.pinned} onClick={() => dispatch({ type: "togglePin", id: q.id })}>
                    {q.pinned ? "★" : "☆"}
                  </IconBtn>
                  <IconBtn label="Delete question" onClick={() => dispatch({ type: "delete", id: q.id })}>✕</IconBtn>
                </div>
              </div>

              <textarea
                aria-label={`Question ${i + 1} answer outline`}
                value={q.answer_outline}
                placeholder="Answer outline"
                rows={2}
                onChange={(e) => dispatch({ type: "edit", id: q.id, patch: { answer_outline: e.target.value } })}
                className="mt-1 w-full resize-y rounded border border-transparent bg-transparent p-1 text-sm text-stone-700 hover:border-stone-300 focus:border-teal-700 focus:bg-white focus:outline-none"
              />

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-stone-600">
                <label className="flex items-center gap-1">
                  Category
                  <select
                    value={q.category}
                    onChange={(e) => dispatch({ type: "recategorise", id: q.id, category: e.target.value as Category })}
                    className="rounded border border-stone-300 bg-white px-1 py-0.5"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{label[c]}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1">
                  Difficulty
                  <select
                    value={q.difficulty}
                    onChange={(e) => dispatch({ type: "edit", id: q.id, patch: { difficulty: Number(e.target.value) as 1 | 2 | 3 } })}
                    className="rounded border border-stone-300 bg-white px-1 py-0.5"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
                <span>Covers {q.requirement_ids.length ? q.requirement_ids.join(", ") : "no requirement"}</span>
                <span className="ml-auto">
                  {q.origin === "generated" ? "Generated" : q.origin === "edited" ? "Edited by you" : "Written by you"}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-stone-500">Tip: focus a question and press Alt + ↑ or ↓ to reorder it.</p>
    </section>
  );
}

function IconBtn({
  label, onClick, children, disabled, pressed,
}: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-8 rounded text-sm hover:bg-stone-200 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700"
    >
      {children}
    </button>
  );
}
