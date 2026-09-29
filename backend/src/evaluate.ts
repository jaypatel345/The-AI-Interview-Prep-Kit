/**
 * Batch entry point:  npm run evaluate -- --input cases.json --output kits.json
 * Runs the same runPipeline() the web app uses, needs no database, and never aborts on one bad case.
 */
import { config as loadEnv } from "dotenv";
import { readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { z } from "zod";
import { KitSchema } from "./kit-schema";
import { createLlm } from "./llm";
import { PipelineError, runPipeline } from "./pipeline";

// Runs from the repo root as well as from backend/, so `npm run evaluate` works either way.
// Paths on the command line stay relative to wherever the user ran it (process.cwd()).
const backendDir = resolve(__dirname, "..");
loadEnv();                                          // .env next to where the command was run
loadEnv({ path: resolve(backendDir, ".env") });     // then backend/.env, without overriding the above

const Case = z.object({ id: z.string().min(1), jd: z.string(), company_url: z.string(), days: z.number().int().min(1).max(365) });
type Entry = { id: string; status: "ok" | "failed"; kit: unknown; error: { code: string; message: string } | null };

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const input = arg("input"), output = arg("output");
  if (!input || !output) { console.error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>"); process.exit(2); }
  const cases: unknown[] = JSON.parse(await readFile(input, "utf8"));
  if (!Array.isArray(cases)) throw new Error("Input must be a JSON array of cases.");

  const concurrency = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 2));
  const caseTimeoutMs = Number(process.env.EVAL_CASE_TIMEOUT_MS ?? 300_000);
  const llm = createLlm();                            // one client, so rate-limit pacing is shared across cases
  const results: Entry[] = [];
  const started = Date.now();
  const save = () => writeFile(output, JSON.stringify({ version: "1.0", generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), kits: results }, null, 2));

  async function runCase(raw: unknown, index: number): Promise<Entry> {
    const parsed = Case.safeParse(raw);
    const id = (raw as any)?.id ? String((raw as any).id) : `case-${index + 1}`;
    if (!parsed.success) return { id, status: "failed", kit: null, error: { code: "INVALID_CASE", message: parsed.error.issues[0]?.message ?? "Invalid case" } };
    const c = parsed.data;
    const log = (step: string, warning?: string) => console.error(`[${c.id}] ${warning ? `  warning: ${warning}` : step}`);
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new PipelineError("TIMEOUT", `Case exceeded ${caseTimeoutMs} ms.`)), caseTimeoutMs); });
      const { kit } = await Promise.race([runPipeline({ jd: c.jd, company_url: c.company_url, days: c.days }, log, llm), timeout]);
      return { id: c.id, status: "ok", kit: KitSchema.parse(kit), error: null };
    } catch (e: any) {
      console.error(`[${c.id}] FAILED: ${e?.message}`);
      return { id: c.id, status: "failed", kit: null, error: { code: e?.code && typeof e.code === "string" ? e.code : "GENERATION_FAILED", message: String(e?.message ?? e) } };
    } finally { clearTimeout(timer); }
  }

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, async () => {
    while (next < cases.length) {
      const i = next++;
      results.push(await runCase(cases[i], i));
      await save();                                    // partial results survive a crash
    }
  }));
  await save();
  const ok = results.filter((r) => r.status === "ok").length;
  console.error(`Done: ${ok}/${results.length} ok in ${Math.round((Date.now() - started) / 1000)}s. Wrote ${output}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
