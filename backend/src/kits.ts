import { createHash, randomUUID } from "crypto";
import { Request, Router } from "express";
import { isValidObjectId } from "mongoose";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler, HttpError } from "./http";
import { CATEGORIES, KitSchema, QuestionSchema, uncoveredMustHaves } from "./kit-schema";
import { startGeneration } from "./jobs";
import { KitModel } from "./models";
import { regenerateBrief, regenerateQuestions, STEPS } from "./pipeline";
import { allocateSchedule } from "./schedule";

export const kitsRouter = Router();

const CreateSchema = z.object({
  jd: z.string().trim().min(1, "Paste a job description.").max(20000),   // a two-line stub is valid input
  company_url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), "Must start with http:// or https://"),
  days: z.number().int().min(1).max(60),
});
const PracticeSchema = z.record(z.object({ confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]), seen_at: z.number() }));

// Every lookup includes userId. Someone else's kit is a 404, not a 403, so its existence is not revealed.
async function ownedKit(req: Request) {
  const id = req.params.id;
  const doc = isValidObjectId(id) ? await KitModel.findOne({ _id: id, userId: req.userId }) : null;
  if (!doc) throw new HttpError(404, "NOT_FOUND", "Kit not found.");
  return doc;
}

const requestHash = (jd: string, url: string, days: number) =>
  createHash("sha256").update([jd.replace(/\s+/g, " ").toLowerCase(), url.replace(/\/+$/, "").toLowerCase(), days].join("\n")).digest("hex");

const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

kitsRouter.get("/", asyncHandler(async (req, res) => {
  const docs = await KitModel.find({ userId: req.userId }).select("company_url status kit.source createdAt").sort({ createdAt: -1 }).limit(100);
  res.json(docs.map((d) => ({
    id: d.id, status: d.status, created_at: d.get("createdAt"),
    company: d.get("kit.source.company") || hostOf(d.company_url), role: d.get("kit.source.role") || "",
  })));
}));

kitsRouter.post("/", asyncHandler(async (req, res) => {
  const input = CreateSchema.parse(req.body);
  const hash = requestHash(input.jd, input.company_url, input.days);
  const existing = await KitModel.findOne({ userId: req.userId, hash });
  if (existing) return res.json({ id: existing.id, existing: true });
  try {
    const doc = await KitModel.create({ userId: req.userId, hash, ...input });
    startGeneration(doc.id);
    res.status(202).json({ id: doc.id });
  } catch (e: any) {
    if (e?.code === 11000) {                       // two identical requests raced; the unique index picked one
      const winner = await KitModel.findOne({ userId: req.userId, hash });
      if (winner) return res.json({ id: winner.id, existing: true });
    }
    throw e;
  }
}));

kitsRouter.get("/:id", asyncHandler(async (req, res) => {
  const d = await ownedKit(req);
  res.json({
    id: d.id, status: d.status,
    progress: { step: d.progress?.step ?? "", steps: STEPS, warnings: d.progress?.warnings ?? [] },
    error: d.error?.code ? { code: d.error.code, message: d.error.message } : undefined,
    kit: d.status === "done" ? d.kit : undefined,
  });
}));

kitsRouter.post("/:id/retry", asyncHandler(async (req, res) => {
  const d = await ownedKit(req);
  if (d.status !== "failed") throw new HttpError(409, "NOT_FAILED", "Only a failed kit can be retried.");
  startGeneration(d.id);
  res.status(202).json({ ok: true });
}));

kitsRouter.put("/:id/questions", asyncHandler(async (req, res) => {
  const { questions } = z.object({ questions: z.array(QuestionSchema).max(300) }).parse(req.body);
  const d = await ownedKit(req);
  if (d.status !== "done") throw new HttpError(409, "NOT_READY", "This kit is still being built.");
  const kit = KitSchema.parse(d.kit);
  const reqIds = new Set(kit.role.requirements.map((r) => r.id));
  if (new Set(questions.map((q) => q.id)).size !== questions.length) throw new HttpError(400, "VALIDATION", "Duplicate question ids.");
  for (const q of questions) q.requirement_ids = q.requirement_ids.filter((r) => reqIds.has(r));
  // Deleting a question must not leave the schedule pointing at it.
  const alive = new Set(questions.map((q) => q.id));
  const schedule = { ...kit.schedule, days: kit.schedule.days.map((day) => ({ ...day, question_ids: day.question_ids.filter((i) => alive.has(i)) })) };
  const coverage = { ...kit.coverage, uncovered_requirement_ids: uncoveredMustHaves({ role: kit.role, questions }) };
  await KitModel.updateOne({ _id: d.id }, { $set: { "kit.questions": questions, "kit.schedule": schedule, "kit.coverage": coverage } });
  res.json({ ok: true, uncovered_requirement_ids: coverage.uncovered_requirement_ids });
}));

// Regenerating one section touches only that section's field, so edits elsewhere are never overwritten.
// Questions: returns candidates only; the client merges them against its latest state (protecting edited, manual and
// pinned questions, including edits made while the request was in flight) and saves via PUT /questions.
// Brief and schedule: saved here, since each is a single section the user explicitly asked to replace.
const RegenSchema = z.discriminatedUnion("section", [
  z.object({ section: z.literal("questions"), category: z.enum(CATEGORIES) }),
  z.object({ section: z.literal("brief") }),
  z.object({ section: z.literal("schedule") }),
]);
kitsRouter.post("/:id/regenerate", rateLimit({ windowMs: 60_000, limit: 10 }), asyncHandler(async (req, res) => {
  const body = RegenSchema.parse(req.body);
  const d = await ownedKit(req);
  if (d.status !== "done") throw new HttpError(409, "NOT_READY", "This kit is still being built.");
  const kit = KitSchema.parse(d.kit);
  try {
    if (body.section === "questions") {
      const fresh = await regenerateQuestions(kit, body.category, d.get("research") ?? null);
      return res.json(fresh.map((q) => ({ ...q, id: `q-${randomUUID().slice(0, 8)}` })));   // fresh ids can never collide with kept questions
    }
    if (body.section === "brief") {
      const brief = await regenerateBrief(kit, d.get("research") ?? null);
      await KitModel.updateOne({ _id: d.id }, { $set: { "kit.company_brief": brief } });
      return res.json(brief);
    }
    const schedule = allocateSchedule({ requirements: kit.role.requirements, questions: kit.questions, days: kit.schedule.days_available });
    await KitModel.updateOne({ _id: d.id }, { $set: { "kit.schedule": schedule } });
    res.json(schedule);
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, e?.code ?? "REGENERATE_FAILED", `Regeneration failed: ${e?.message ?? "unknown error"}. Nothing was changed.`);
  }
}));

kitsRouter.put("/:id/brief", asyncHandler(async (req, res) => {
  const patch = z.object({ summary: z.string().max(5000), what_they_do: z.string().max(5000) }).parse(req.body);
  const d = await ownedKit(req);
  if (d.status !== "done") throw new HttpError(409, "NOT_READY", "This kit is still being built.");
  await KitModel.updateOne({ _id: d.id }, { $set: { "kit.company_brief.summary": patch.summary, "kit.company_brief.what_they_do": patch.what_they_do, "kit.company_brief.edited": true } });
  res.json({ ok: true });
}));

kitsRouter.put("/:id/flashcards", asyncHandler(async (req, res) => {
  const card = z.object({ id: z.string().min(1).max(64), front: z.string().max(2000), back: z.string().max(5000), requirement_ids: z.array(z.string()).max(50) });
  const { flashcards } = z.object({ flashcards: z.array(card).max(300) }).parse(req.body);
  const d = await ownedKit(req);
  if (d.status !== "done") throw new HttpError(409, "NOT_READY", "This kit is still being built.");
  if (new Set(flashcards.map((f) => f.id)).size !== flashcards.length) throw new HttpError(400, "VALIDATION", "Duplicate flashcard ids.");
  await KitModel.updateOne({ _id: d.id }, { $set: { "kit.flashcards": flashcards } });
  res.json({ ok: true });
}));

kitsRouter.get("/:id/practice", asyncHandler(async (req, res) => res.json((await ownedKit(req)).practice ?? {})));
kitsRouter.put("/:id/practice", asyncHandler(async (req, res) => {
  const practice = PracticeSchema.parse(req.body);
  const d = await ownedKit(req);
  await KitModel.updateOne({ _id: d.id }, { practice });
  res.json({ ok: true });
}));
