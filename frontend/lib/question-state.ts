export const CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;
export type Category = (typeof CATEGORIES)[number];

// generated: written by the model, safe to replace on regeneration
// edited:    a human changed it, so it is never replaced
// manual:    a human wrote it from scratch, so it is never replaced
export type Origin = "generated" | "edited" | "manual";

// Appendix A fields plus two extensions: origin and pinned.
export interface Question {
  id: string;
  requirement_ids: string[];
  category: Category;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
  origin: Origin;
  pinned: boolean;
}

export type Action =
  | { type: "edit"; id: string; patch: Partial<Pick<Question, "prompt" | "answer_outline" | "difficulty">> }
  | { type: "move"; id: string; dir: -1 | 1 }
  | { type: "recategorise"; id: string; category: Category }
  | { type: "togglePin"; id: string }
  | { type: "add"; id: string; category: Category }
  | { type: "delete"; id: string }
  | { type: "regenerated"; category: Category; incoming: Question[] };

/** A question survives regeneration if a human touched it or pinned it. */
export const isProtected = (q: Question) => q.origin !== "generated" || q.pinned;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function questionsReducer(state: Question[], action: Action): Question[] {
  switch (action.type) {
    case "edit":
      return state.map((q) =>
        q.id === action.id ? { ...q, ...action.patch, origin: q.origin === "manual" ? "manual" : "edited" } : q
      );

    case "recategorise":
      return state.map((q) =>
        q.id === action.id
          ? { ...q, category: action.category, origin: q.origin === "manual" ? "manual" : "edited" }
          : q
      );

    case "togglePin":
      return state.map((q) => (q.id === action.id ? { ...q, pinned: !q.pinned } : q));

    case "move": {
      const i = state.findIndex((q) => q.id === action.id);
      if (i < 0) return state;
      const siblings = state.flatMap((q, idx) => (q.category === state[i].category ? [idx] : []));
      const target = siblings[siblings.indexOf(i) + action.dir];
      if (target === undefined) return state;
      const next = [...state];
      [next[i], next[target]] = [next[target], next[i]];
      return next;
    }

    case "add":
      return [
        ...state,
        {
          id: action.id,
          requirement_ids: [],
          category: action.category,
          prompt: "",
          answer_outline: "",
          difficulty: 2,
          origin: "manual",
          pinned: true,
        },
      ];

    case "delete":
      return state.filter((q) => q.id !== action.id);

    case "regenerated": {
      // Applied against the *latest* state, so edits made while the request
      // was in flight are still seen and protected.
      const kept = state.filter((q) => q.category !== action.category || isProtected(q));
      const taken = new Set(kept.filter((q) => q.category === action.category).map((q) => norm(q.prompt)));
      const fresh = action.incoming
        .filter((q) => !taken.has(norm(q.prompt)))
        .map<Question>((q) => ({ ...q, category: action.category, origin: "generated", pinned: false }));
      return [...kept, ...fresh];
    }
  }
}
