import type { Question } from "./question-state";

export interface Requirement { id: string; text: string; kind: string; priority: "must" | "nice" }
export interface Flashcard { id: string; front: string; back: string; requirement_ids: string[] }
export interface Kit {
  source: { company: string; role: string; location: string; pages_used: string[] };
  company_brief: Brief;
  role: { title: string; seniority: string; responsibilities: string[]; requirements: Requirement[] };
  questions: Question[];
  flashcards: Flashcard[];
  schedule: { days_available: number; days: { day: number; focus: string; question_ids: string[]; minutes: number }[] };
  coverage: { uncovered_requirement_ids: string[]; passes: number };
  notes?: string[];
  coverage_log?: string[];
}
export interface Brief {
  summary: string; what_they_do: string; sources: string[];
  interview_process?: { stage: string; detail: string; source_url: string }[];
  hiring_page_found?: boolean; edited?: boolean;
}
export type Schedule = Kit["schedule"];
export interface KitSummary { id: string; company: string; role: string; status: KitRecord["status"]; created_at: string }
export interface KitRecord {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: { step: string; steps: string[]; warnings: string[] };
  error?: { code: string; message: string };
  kit?: Kit;
}
export type PracticeRecord = Record<string, { confidence: 1 | 2 | 3; seen_at: number }>;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

/** Every call sends the session cookie. A 401 anywhere sends the user to /login. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    window.location.href = "/login?expired=1";
    throw new ApiError(401, "UNAUTHENTICATED", "Your session has expired.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error?.code ?? "ERROR", body.error?.message ?? "Something went wrong.");
  return body as T;
}
