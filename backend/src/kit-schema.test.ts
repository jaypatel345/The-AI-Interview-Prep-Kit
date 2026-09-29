import { describe, expect, it } from "vitest";
import { makeKit, question, req } from "./fixtures";
import { KitSchema, uncoveredMustHaves } from "./kit-schema";

describe("uncoveredMustHaves", () => {
  const role = { title: "", seniority: "", responsibilities: [], requirements: [req("r1"), req("r2"), req("r3", "nice")] };

  it("reports must-haves with no question", () => {
    expect(uncoveredMustHaves({ role, questions: [question("q1", ["r1"])] })).toEqual(["r2"]);
  });
  it("ignores nice-to-haves", () => {
    expect(uncoveredMustHaves({ role, questions: [question("q1", ["r1", "r2"])] })).toEqual([]);
  });
  it("counts a question that covers several requirements", () => {
    expect(uncoveredMustHaves({ role, questions: [question("q1", ["r1", "r2"])] })).toEqual([]);
  });
  it("reports every must-have when there are no questions", () => {
    expect(uncoveredMustHaves({ role, questions: [] })).toEqual(["r1", "r2"]);
  });
});

describe("KitSchema", () => {
  it("accepts a well-formed kit", () => {
    expect(KitSchema.safeParse(makeKit()).success).toBe(true);
  });
  it("rejects a schedule that points at a missing question", () => {
    const kit = makeKit();
    kit.schedule.days[0].question_ids.push("q999");
    expect(KitSchema.safeParse(kit).success).toBe(false);
  });
  it("rejects a schedule whose length differs from days_available", () => {
    const kit = makeKit();
    kit.schedule.days.pop();
    expect(KitSchema.safeParse(kit).success).toBe(false);
  });
  it("rejects a question that references an unknown requirement", () => {
    const kit = makeKit();
    kit.questions.push(question("q3", ["r404"]));
    expect(KitSchema.safeParse(kit).success).toBe(false);
  });
  it("rejects duplicate question ids", () => {
    const kit = makeKit();
    kit.questions.push(question("q1", ["r1"]));
    expect(KitSchema.safeParse(kit).success).toBe(false);
  });
  it("rejects difficulty outside 1 to 3 and non-integer minutes", () => {
    const badDifficulty = makeKit();
    (badDifficulty.questions[0] as any).difficulty = 4;
    expect(KitSchema.safeParse(badDifficulty).success).toBe(false);
    const badMinutes = makeKit();
    badMinutes.schedule.days[0].minutes = 12.5;
    expect(KitSchema.safeParse(badMinutes).success).toBe(false);
  });
});
