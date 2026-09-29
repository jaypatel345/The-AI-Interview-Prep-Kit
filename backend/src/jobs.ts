import { KitSchema } from "./kit-schema";
import { KitModel } from "./models";
import { PipelineError, runPipeline } from "./pipeline";

// In-process runner. Fine for one free-tier instance; a queue (BullMQ, etc.) is the upgrade if this scales out.
const running = new Set<string>();

export function startGeneration(kitId: string) {
  if (running.has(kitId)) return;                  // a second trigger for the same kit is a no-op
  running.add(kitId);
  void run(kitId).finally(() => running.delete(kitId));
}

async function run(kitId: string) {
  const doc = await KitModel.findByIdAndUpdate(kitId, { status: "running", error: null, "progress.step": "", "progress.warnings": [] }, { new: true });
  if (!doc) return;
  try {
    const { kit: output, research } = await runPipeline(
      { jd: doc.jd, company_url: doc.company_url, days: doc.days },
      async (step, warning) => {
        await KitModel.updateOne({ _id: kitId }, { $set: { "progress.step": step }, ...(warning ? { $push: { "progress.warnings": warning } } : {}) });
      }
    );
    const kit = KitSchema.parse(output);           // nothing unvalidated is ever saved
    await KitModel.updateOne({ _id: kitId }, { status: "done", kit, research });
  } catch (err) {
    const known = err instanceof PipelineError;
    console.error(`kit ${kitId} failed`, err);
    await KitModel.updateOne({ _id: kitId }, {
      status: "failed",
      error: { code: known ? err.code : "GENERATION_FAILED", message: known ? err.message : "We could not build a valid kit for this posting. Try again." },
    });
  }
}

/** Jobs live in memory, so anything still queued or running after a restart is orphaned. Fail it visibly. */
export async function recoverOrphans() {
  await KitModel.updateMany(
    { status: { $in: ["queued", "running"] } },
    { status: "failed", error: { code: "SERVER_RESTARTED", message: "The server restarted while building this kit. Try again." } }
  );
}
