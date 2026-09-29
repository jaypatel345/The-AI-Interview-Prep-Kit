import { describe, expect, it } from "vitest";
import { Question, questionsReducer } from "./question-state";

const q = (id: string, over: Partial<Question> = {}): Question => ({
  id,
  requirement_ids: ["r1"],
  category: "technical",
  prompt: `prompt ${id}`,
  answer_outline: "",
  difficulty: 2,
  origin: "generated",
  pinned: false,
  ...over,
});

describe("regeneration", () => {
  it("replaces untouched generated questions in that category only", () => {
    const state = [q("a"), q("b", { category: "behavioural" })];
    const next = questionsReducer(state, { type: "regenerated", category: "technical", incoming: [q("n1")] });
    expect(next.map((x) => x.id).sort()).toEqual(["b", "n1"]);
  });

  it("keeps edited, manual and pinned questions", () => {
    let state = [q("a"), q("b"), q("c", { origin: "manual" })];
    state = questionsReducer(state, { type: "edit", id: "a", patch: { prompt: "my wording" } });
    state = questionsReducer(state, { type: "togglePin", id: "b" });
    const next = questionsReducer(state, { type: "regenerated", category: "technical", incoming: [q("n1")] });
    expect(next.map((x) => x.id).sort()).toEqual(["a", "b", "c", "n1"]);
    expect(next.find((x) => x.id === "a")?.prompt).toBe("my wording");
  });

  it("protects edits made while the request was in flight", () => {
    let state = [q("a")];
    // regeneration starts here...
    state = questionsReducer(state, { type: "edit", id: "a", patch: { prompt: "edited mid-flight" } });
    // ...and its result arrives afterwards
    const next = questionsReducer(state, { type: "regenerated", category: "technical", incoming: [q("n1")] });
    expect(next.some((x) => x.id === "a")).toBe(true);
  });

  it("drops incoming questions that duplicate a protected one", () => {
    const state = [q("a", { origin: "manual", prompt: "Explain closures" })];
    const next = questionsReducer(state, {
      type: "regenerated",
      category: "technical",
      incoming: [q("n1", { prompt: "  explain   CLOSURES " })],
    });
    expect(next).toHaveLength(1);
  });
});

describe("move", () => {
  it("swaps within a category, ignoring other categories in between", () => {
    const state = [q("a"), q("x", { category: "behavioural" }), q("b")];
    const next = questionsReducer(state, { type: "move", id: "b", dir: -1 });
    expect(next.map((x) => x.id)).toEqual(["b", "x", "a"]);
  });
});
