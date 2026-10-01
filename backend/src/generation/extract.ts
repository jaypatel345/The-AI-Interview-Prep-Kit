import { z } from "zod";
import type { Kit } from "../kit-schema";
import { LlmClient, untrusted } from "../llm";

export type Requirement = Kit["role"]["requirements"][number];
export interface Extraction {
  company: string; title: string; seniority: string; location: string;
  responsibilities: string[]; requirements: Requirement[]; thin: boolean; dropped: string[];
}

const kind = z.preprocess((v) => (typeof v === "string" && /behavio/i.test(v) ? "behavioural" : v), z.enum(["technical", "behavioural", "domain"])).catch("technical");
const ExtractSchema = z.object({
  company: z.string().catch(""), title: z.string().catch(""), seniority: z.string().catch(""), location: z.string().catch(""),
  responsibilities: z.array(z.string()).catch([]),
  requirements: z.array(z.object({ text: z.string(), quote: z.string().catch(""), kind, priority: z.enum(["must", "nice"]).catch("must") })).catch([]),
});

const SYSTEM = `You extract the requirements from a job posting for an interview-prep tool.
Return JSON: {"company": "", "title": "", "seniority": "", "location": "", "responsibilities": [""], "requirements": [{"text": "", "quote": "", "kind": "", "priority": ""}]}
Rules:
- Only list requirements the posting actually states. A short posting gets a short list. Never add skills that are typical for the role but not written.
- "quote" is the exact words copied from the posting that state the requirement. "text" is a short, clean restatement (e.g. "5+ years with React").
- kind: "technical" (languages, tools, engineering skills, years of technical experience), "behavioural" (communication, mentoring, leadership, collaboration, ownership), "domain" (industry or business knowledge such as payments or healthcare).
- priority: "nice" if the posting says preferred, bonus, plus, nice to have, ideally, or similar; otherwise "must".
- Split a line only when it names clearly separate skills. Benefits and company marketing are not requirements. Duties go in "responsibilities".
- seniority: intern, junior, mid, senior, staff, principal or lead, or "" if not stated. company: only if the posting names it.`;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["and", "the", "with", "for", "you", "our", "are", "have", "experience", "years", "year", "strong", "good", "ability", "skills", "knowledge", "working", "using", "plus"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length >= 2 && !STOP.has(t));

/** Code, not the model, decides whether a requirement really appears in the posting. */
export function isGrounded(jd: string, quote: string, text: string): boolean {
  const j = norm(jd);
  if (quote && norm(quote).length >= 3 && j.includes(norm(quote))) return true;
  const jdTokens = new Set(tokens(jd));
  const t = tokens(quote || text);
  if (t.length === 0) return false;
  return t.filter((x) => jdTokens.has(x)).length / t.length >= 0.75;
}

const NICE = /nice[- ]to[- ]have|bonus|\bplus\b|preferred|ideally|desirable|advantage|good to have|not required|optional|would be great|extra credit/i;
const MUST = /required|requirements?\b|\bmust\b|minimum|essential|qualifications|you have|you will need|what we.re looking for|need to have/i;
const BULLET = /^\s*([-*•·▪◦–]|\d+[.)])\s*/;

/** Priority from how the posting words it: the line itself first, then the heading it sits under. */
export function priorityFromPosting(jd: string, quote: string, fallback: "must" | "nice"): "must" | "nice" {
  const lines = jd.split(/\r?\n/);
  const q = norm(quote);
  if (q.length < 3) return fallback;
  const idx = lines.findIndex((l) => norm(l).includes(q) || (norm(l).length > 3 && q.includes(norm(l))));
  if (idx < 0) return fallback;
  const line = lines[idx];
  if (NICE.test(line)) return "nice";
  if (/\b(required|must)\b/i.test(line)) return "must";
  for (let i = idx - 1; i >= 0; i--) {
    const h = lines[i].trim();
    if (!h || BULLET.test(h) || h.length > 80) continue;
    if (NICE.test(h)) return "nice";
    if (MUST.test(h)) return "must";
    break;                                   // nearest heading says nothing either way
  }
  return fallback;
}

export async function extractRequirements(llm: LlmClient, jd: string): Promise<Extraction> {
  const out = await llm.json({ label: "extract requirements", system: SYSTEM, user: untrusted("job description", jd, 14_000), schema: ExtractSchema, maxTokens: 3000 });
  const seen = new Set<string>();
  const dropped: string[] = [];
  const requirements: Requirement[] = [];
  for (const r of out.requirements) {
    const text = r.text.trim().slice(0, 200);
    if (!text || seen.has(norm(text))) continue;
    if (!isGrounded(jd, r.quote, text)) { dropped.push(text); continue; }
    seen.add(norm(text));
    requirements.push({ id: `r${requirements.length + 1}`, text, kind: r.kind, priority: priorityFromPosting(jd, r.quote || text, r.priority) });
    if (requirements.length >= 25) break;
  }
  const firstLine = jd.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
  return {
    company: blankIfPlaceholder(out.company), title: out.title.trim() || firstLine.slice(0, 100),
    seniority: blankIfPlaceholder(out.seniority), location: blankIfPlaceholder(out.location),
    responsibilities: out.responsibilities.map((s) => s.trim()).filter(Boolean).slice(0, 15),
    requirements, dropped, thin: jd.trim().length < 300 || requirements.length < 3,
  };
}

/**
 * The model is asked to return "" for a field the posting does not state, but it often writes
 * "unknown" or "not specified" instead. Those are truthy, so they would win over the fallbacks
 * further down the pipeline (site title, then hostname) and surface in the UI as "at unknown".
 */
const PLACEHOLDERS = new Set(["unknown", "n/a", "na", "none", "not stated", "not specified", "not given", "not mentioned", "unspecified", "-"]);
function blankIfPlaceholder(v: string): string {
  const t = v.trim();
  return PLACEHOLDERS.has(t.toLowerCase().replace(/[.]$/, "")) ? "" : t;
}
