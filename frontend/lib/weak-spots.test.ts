import { describe, expect, it } from "vitest";
import { weakSpots } from "./weak-spots";

const r = (id: string, priority: "must" | "nice") => ({ id, text: id, kind: "technical", priority });
const c = (id: string, rid: string) => ({ id, front: "", back: "", requirement_ids: [rid] });

describe("weakSpots", () => {
  it("ranks unpractised must-haves above confident ones, and must above nice", () => {
    const out = weakSpots([r("r1", "must"), r("r2", "must"), r("r3", "nice")], [c("a", "r1"), c("b", "r2"), c("x", "r3")], { a: { confidence: 3, seen_at: 1 } });
    expect(out.map((s) => s.requirement.id)).toEqual(["r2", "r3", "r1"]);
  });
});
