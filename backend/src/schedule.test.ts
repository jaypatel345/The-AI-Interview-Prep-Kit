import { describe, expect, it } from "vitest";
import { question, req } from "./fixtures";
import { allocateSchedule, scoreQuestion } from "./schedule";

const requirements = [req("r1", "must"), req("r2", "must"), req("r3", "nice"), req("r4", "nice")];
const questions = [
  question("q1", ["r3"], 1), question("q2", ["r1"], 3), question("q3", ["r4"], 2), question("q4", ["r2"], 2),
  question("q5", ["r3"], 3), question("q6", ["r1", "r2"], 1), question("q7", ["r4"], 1), question("q8", ["r2"], 3),
  question("q9", ["r3"], 2), question("q10", ["r4"], 3), question("q11", ["r1"], 2), question("q12", ["r2"], 1),
];
const run = (days: number, qs = questions) => allocateSchedule({ requirements, questions: qs, days });

describe("allocateSchedule", () => {
  it.each([1, 2, 5, 12, 20, 60])("returns exactly %i days", (n) => {
    const s = run(n);
    expect(s.days_available).toBe(n);
    expect(s.days).toHaveLength(n);
    expect(s.days.map((d) => d.day)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  });

  it("schedules every question at least once and only refers to real questions", () => {
    const s = run(5);
    const real = new Set(questions.map((q) => q.id));
    const scheduled = new Set(s.days.flatMap((d) => d.question_ids));
    for (const id of scheduled) expect(real.has(id)).toBe(true);
    for (const id of real) expect(scheduled.has(id)).toBe(true);
  });

  it("puts every covered must-have requirement somewhere in the schedule", () => {
    const s = run(4);
    const scheduled = new Set(s.days.flatMap((d) => d.question_ids));
    for (const r of requirements.filter((r) => r.priority === "must")) {
      const covering = questions.filter((q) => q.requirement_ids.includes(r.id)).map((q) => q.id);
      expect(covering.some((id) => scheduled.has(id))).toBe(true);
    }
  });

  it("front-loads must-have and harder material", () => {
    const s = run(4);
    const priority = new Map(requirements.map((r) => [r.id, r.priority]));
    const score = new Map(questions.map((q) => [q.id, scoreQuestion(q, priority)]));
    const avg = (ids: string[]) => ids.reduce((t, id) => t + score.get(id)!, 0) / ids.length;
    const avgs = s.days.map((d) => avg(d.question_ids));
    for (let i = 1; i < avgs.length; i++) expect(avgs[i - 1]).toBeGreaterThanOrEqual(avgs[i]);
  });

  it("uses integer minutes on every day", () => {
    for (const d of run(7).days) expect(Number.isInteger(d.minutes)).toBe(true);
  });

  it("handles a 1-day plan by putting everything on that day", () => {
    const s = run(1);
    expect(s.days[0].question_ids).toHaveLength(questions.length);
  });

  it("turns spare days into review days when there are fewer questions than days", () => {
    const s = run(60, questions.slice(0, 3));
    expect(s.days).toHaveLength(60);
    expect(s.days[10].focus).toMatch(/^Review/);
    expect(s.days[10].question_ids.length).toBeGreaterThan(0);
  });

  it("still returns the requested number of days when there are no questions", () => {
    const s = run(5, []);
    expect(s.days).toHaveLength(5);
    expect(s.days.every((d) => d.question_ids.length === 0 && d.minutes === 0)).toBe(true);
  });

  it("is deterministic", () => {
    expect(run(6)).toEqual(run(6));
  });
});
