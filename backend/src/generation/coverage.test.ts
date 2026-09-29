import { describe, expect, it, vi } from "vitest";
import { closeCoverageGaps, MAX_PASSES } from "./coverage";
import { req, question } from "../fixtures";

const draftQ = (ids: string[]) => { const { id, ...rest } = question("x", ids); return rest; };
const reqs = [req("r1"), req("r2"), req("r3", "nice")];

describe("closeCoverageGaps", () => {
  it("stops after one pass when the draft already covers every must-have", async () => {
    const fill = vi.fn();
    const out = await closeCoverageGaps(reqs, [draftQ(["r1", "r2"])], fill);
    expect(fill).not.toHaveBeenCalled();
    expect(out.passes).toBe(1);
    expect(out.uncovered).toEqual([]);
  });
  it("asks only for the gaps, then re-checks", async () => {
    const fill = vi.fn(async (gaps: any[]) => gaps.map((g) => draftQ([g.id])));
    const out = await closeCoverageGaps(reqs, [draftQ(["r1"])], fill);
    expect(fill).toHaveBeenCalledTimes(1);
    expect(fill.mock.calls[0][0].map((r: any) => r.id)).toEqual(["r2"]);   // nice-to-have r3 is not a gap
    expect(out.passes).toBe(2);
    expect(out.uncovered).toEqual([]);
  });
  it("gives up on the model after MAX_PASSES and adds template questions so nothing ships uncovered", async () => {
    const fill = vi.fn(async () => []);
    const out = await closeCoverageGaps(reqs, [], fill);
    expect(fill).toHaveBeenCalledTimes(MAX_PASSES - 1);
    expect(out.templated).toEqual(["r1", "r2"]);
    expect(out.uncovered).toEqual([]);
  });
  it("survives a gap pass that throws", async () => {
    const fill = vi.fn().mockRejectedValueOnce(new Error("429")).mockImplementation(async (gaps: any[]) => gaps.map((g) => draftQ([g.id])));
    const out = await closeCoverageGaps(reqs, [], fill);
    expect(out.uncovered).toEqual([]);
    expect(out.templated).toEqual([]);
  });
});
