"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import QuestionBank from "../../../components/QuestionBank";
import PracticeMode from "../../../components/PracticeMode";
import BriefEditor from "../../../components/BriefEditor";
import FlashcardEditor from "../../../components/FlashcardEditor";
import WeakSpots from "../../../components/WeakSpots";
import { api, Brief, Flashcard, Kit, KitRecord, PracticeRecord, Schedule } from "../../../lib/api";
import type { Category, Question } from "../../../lib/question-state";
import { useDebouncedSave } from "../../../lib/use-debounced-save";

const TABS = ["Overview", "Questions", "Flashcards", "Practice", "Schedule"] as const;
type Tab = (typeof TABS)[number];
type SaveState = "saved" | "saving" | "error";

export default function KitPage() {
  const { id } = useParams<{ id: string }>();
  const [rec, setRec] = useState<KitRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll while the backend is generating; stop once it reaches a final state.
  useEffect(() => {
    let stop = false, t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const r = await api<KitRecord>(`/api/kits/${id}`);
        if (stop) return;
        setRec(r);
        if (r.status === "queued" || r.status === "running") t = setTimeout(tick, 2000);
      } catch (e) { if (!stop) setError((e as Error).message); }
    };
    tick();
    return () => { stop = true; clearTimeout(t); };
  }, [id]);

  if (error) return <Msg tone="error">{error} <Link href="/kits" className="underline">Back to kits</Link></Msg>;
  if (!rec) return <Msg>Loading your kit…</Msg>;
  if (rec.status === "queued" || rec.status === "running") return <Progress rec={rec} />;
  if (rec.status === "failed" || !rec.kit) {
    return (
      <Msg tone="error">
        <p className="font-medium">We could not build this kit.</p>
        <p className="mt-1 text-sm">{rec.error?.message ?? "Unknown error."} <span className="text-xs">({rec.error?.code})</span></p>
        <button onClick={async () => { await api(`/api/kits/${id}/retry`, { method: "POST" }); location.reload(); }} className="mt-3 rounded bg-teal-700 px-3 py-1.5 text-sm text-white">Try again</button>
      </Msg>
    );
  }
  return <KitView id={id} kit={rec.kit} warnings={rec.progress.warnings} />;
}

function Progress({ rec }: { rec: KitRecord }) {
  const { steps, step, warnings } = rec.progress;
  const at = steps.indexOf(step);
  return (
    <main className="mx-auto max-w-xl px-4 py-10" aria-live="polite">
      <h1 className="text-xl font-semibold">Building your kit</h1>
      <p className="mt-1 text-sm text-stone-600">This usually takes one to three minutes. You can leave and come back; it keeps running.</p>
      <ol className="mt-5 space-y-2">
        {steps.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 text-sm ${i === at ? "font-medium text-teal-800" : i < at ? "text-stone-500" : "text-stone-700"}`}>
            <span aria-hidden className="w-4">{i < at ? "✓" : i === at ? "●" : "○"}</span>
            <span>{s}{i === at ? " (working)" : i < at ? " (done)" : ""}</span>
          </li>
        ))}
      </ol>
      {warnings.length > 0 && (
        <ul className="mt-5 space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
    </main>
  );
}

function KitView({ id, kit: initial, warnings }: { id: string; kit: Kit; warnings: string[] }) {
  const [tab, setTab] = useState<Tab>("Overview");
  const [questions, setQuestions] = useState<Question[]>(initial.questions);
  const [cards, setCards] = useState<Flashcard[]>(initial.flashcards);
  const [schedule, setSchedule] = useState<Schedule>(initial.schedule);
  const [uncovered, setUncovered] = useState(initial.coverage.uncovered_requirement_ids);
  const [practice, setPractice] = useState<PracticeRecord | null>(null);
  const [drill, setDrill] = useState<string | null>(null);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [scheduleBusy, setScheduleBusy] = useState(false);

  useEffect(() => { api<PracticeRecord>(`/api/kits/${id}/practice`).then(setPractice).catch(() => setPractice({})); }, [id]);

  // Each section saves independently, so a failed save in one never blocks or overwrites another.
  const persist = useCallback(async <T,>(key: string, path: string, body: unknown): Promise<T | undefined> => {
    setSaves((s) => ({ ...s, [key]: "saving" }));
    try { const r = await api<T>(path, { method: "PUT", body: JSON.stringify(body) }); setSaves((s) => ({ ...s, [key]: "saved" })); return r; }
    catch { setSaves((s) => ({ ...s, [key]: "error" })); }
  }, []);

  const saveQuestions = useCallback(async (qs: Question[]) => {
    setQuestions(qs);
    const r = await persist<{ uncovered_requirement_ids: string[] }>("questions", `/api/kits/${id}/questions`, { questions: qs });
    if (r) setUncovered(r.uncovered_requirement_ids);
  }, [id, persist]);
  useDebouncedSave(cards, (c) => persist("flashcards", `/api/kits/${id}/flashcards`, { flashcards: c }));

  const regenerate = (category: Category) =>
    api<Question[]>(`/api/kits/${id}/regenerate`, { method: "POST", body: JSON.stringify({ section: "questions", category }) });
  const regenerateBrief = () => api<Brief>(`/api/kits/${id}/regenerate`, { method: "POST", body: JSON.stringify({ section: "brief" }) });
  async function rebuildSchedule() {
    setScheduleBusy(true);
    try { setSchedule(await api<Schedule>(`/api/kits/${id}/regenerate`, { method: "POST", body: JSON.stringify({ section: "schedule" }) })); }
    catch { setSaves((s) => ({ ...s, schedule: "error" })); }
    finally { setScheduleBusy(false); }
  }
  const savePractice = (r: PracticeRecord) => { setPractice(r); api(`/api/kits/${id}/practice`, { method: "PUT", body: JSON.stringify(r) }).catch(() => {}); };

  const states = Object.values(saves);
  const saveLabel = states.includes("error") ? "Some changes could not be saved. They are still on screen; the next edit retries." : states.includes("saving") ? "Saving…" : "All changes saved";
  const qById = new Map(questions.map((q) => [q.id, q]));
  const reqText = new Map(initial.role.requirements.map((r) => [r.id, r.text]));
  const drillCards = drill ? cards.filter((c) => c.requirement_ids.includes(drill)) : cards;
  const staleSchedule = questions.some((q) => !schedule.days.some((d) => d.question_ids.includes(q.id)));

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link href="/kits" className="text-sm text-teal-800 underline">← All kits</Link>
      <header className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{initial.role.title || initial.source.role || "Role"} at {initial.source.company || "unknown company"}</h1>
        <span role="status" className={`text-xs ${states.includes("error") ? "text-red-800" : "text-stone-600"}`}>{saveLabel}</span>
      </header>

      <div role="tablist" aria-label="Kit sections" className="mt-4 flex gap-1 overflow-x-auto border-b border-stone-300">
        {TABS.map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}
            className={`whitespace-nowrap px-3 py-2 text-sm ${tab === t ? "border-b-2 border-teal-700 font-medium" : "text-stone-600 hover:text-stone-900"}`}>{t}</button>
        ))}
      </div>

      {/* Panels stay mounted (hidden) so in-progress edits and regenerations survive switching tabs. */}
      <div role="tabpanel" id="panel-Overview" aria-labelledby="tab-Overview" hidden={tab !== "Overview"} className="mt-4 space-y-6 text-sm">
        {(initial.notes?.length ?? 0) > 0 && (
          <section className="rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <h2 className="font-medium">What we could and could not find</h2>
            <ul className="mt-1 list-inside list-disc space-y-0.5">{initial.notes!.map((n) => <li key={n}>{n}</li>)}</ul>
          </section>
        )}
        <BriefEditor brief={initial.company_brief} regenerate={regenerateBrief}
          onSave={(b) => persist("brief", `/api/kits/${id}/brief`, b)} />
        <section>
          <h2 className="font-semibold">Requirements from the posting</h2>
          {initial.role.requirements.length < 3 && <p className="mt-1 text-amber-900">This posting gave us very little to work with, so the kit is short on purpose rather than padded with guesses.</p>}
          <ul className="mt-1 space-y-1">{initial.role.requirements.map((r) => (
            <li key={r.id}><span className="mr-2 rounded bg-stone-200 px-1.5 text-xs">{r.priority === "must" ? "Must" : "Nice"}</span><span className="mr-1 text-xs text-stone-500">{r.id} · {r.kind}</span>{r.text}</li>
          ))}</ul>
          {uncovered.length > 0 && <p role="alert" className="mt-2 text-red-800">No question covers: {uncovered.map((u) => reqText.get(u) ?? u).join("; ")}. Add one in the Questions tab.</p>}
          {initial.coverage_log && <details className="mt-2 text-xs text-stone-600"><summary className="cursor-pointer">Coverage passes ({initial.coverage.passes})</summary><ul className="mt-1 list-inside list-disc">{initial.coverage_log.map((l) => <li key={l}>{l}</li>)}</ul></details>}
        </section>
        {initial.source.pages_used.length > 0 ? (
          <section><h2 className="font-semibold">Pages we read</h2><ul className="mt-1 list-inside list-disc break-all">{initial.source.pages_used.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer noopener" className="underline">{u}</a></li>)}</ul></section>
        ) : <p className="text-stone-600">We could not read any pages from the company site, so the kit is based on the job description alone.</p>}
        {warnings.length > 0 && <details className="text-xs text-stone-600"><summary className="cursor-pointer">Research log ({warnings.length})</summary><ul className="mt-1 list-inside list-disc break-all">{warnings.map((w) => <li key={w}>{w}</li>)}</ul></details>}
      </div>

      <div role="tabpanel" id="panel-Questions" aria-labelledby="tab-Questions" hidden={tab !== "Questions"}>
        <QuestionBank initial={initial.questions} onChange={saveQuestions} regenerate={regenerate} />
      </div>

      <div role="tabpanel" id="panel-Flashcards" aria-labelledby="tab-Flashcards" hidden={tab !== "Flashcards"}>
        <FlashcardEditor cards={cards} onChange={setCards} />
      </div>

      {tab === "Practice" && (
        <div role="tabpanel" id="panel-Practice" aria-labelledby="tab-Practice" className="mt-6">
          {!practice ? <p className="text-sm">Loading…</p> : (
            <>
              {drill && <p className="mx-auto mb-3 max-w-xl text-sm">Drilling: <b>{reqText.get(drill)}</b> <button onClick={() => setDrill(null)} className="ml-2 underline">Practise all cards</button></p>}
              <PracticeMode key={drill ?? "all"} cards={drillCards} initial={practice} onSave={savePractice} />
              <WeakSpots requirements={initial.role.requirements} cards={cards} practice={practice} onDrill={setDrill} />
            </>
          )}
        </div>
      )}

      <div role="tabpanel" id="panel-Schedule" aria-labelledby="tab-Schedule" hidden={tab !== "Schedule"} className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-stone-600">{schedule.days_available} day(s), {schedule.days.reduce((t, d) => t + d.minutes, 0)} minutes in total. Hardest and must-have material comes first.</p>
          <button onClick={rebuildSchedule} disabled={scheduleBusy} className="rounded border border-stone-400 px-3 py-1.5 text-sm hover:bg-stone-100 disabled:opacity-50">{scheduleBusy ? "Rebuilding…" : "Rebuild schedule"}</button>
        </div>
        {staleSchedule && <p className="mt-2 text-sm text-amber-900">You have added questions since this schedule was built. Rebuild it to include them.</p>}
        <ol className="mt-3 space-y-3">
          {schedule.days.map((d) => (
            <li key={d.day} className="rounded border border-stone-300 bg-white p-3">
              <p className="font-medium">Day {d.day}: {d.focus} <span className="font-normal text-stone-600">({d.minutes} min)</span></p>
              <ul className="mt-2 list-inside list-disc text-sm text-stone-700">{d.question_ids.map((qid, i) => <li key={`${qid}-${i}`}>{qById.get(qid)?.prompt || "(question removed)"}</li>)}</ul>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

function Msg({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <main className="mx-auto max-w-xl px-4 py-16"><div role={tone ? "alert" : "status"} className={tone ? "rounded border border-red-300 bg-red-50 p-4 text-red-900" : "text-stone-700"}>{children}</div></main>;
}
