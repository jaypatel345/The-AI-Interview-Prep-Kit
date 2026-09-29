"use client";
import { useState } from "react";
import type { Brief } from "../lib/api";
import { useDebouncedSave } from "../lib/use-debounced-save";

interface Props { brief: Brief; onSave: (b: { summary: string; what_they_do: string }) => void; regenerate: () => Promise<Brief> }

/** Inline-editable company brief. Regenerating replaces only the brief; if the user edited it, we ask first. */
export default function BriefEditor({ brief: initial, onSave, regenerate }: Props) {
  const [brief, setBrief] = useState(initial);
  const [edited, setEdited] = useState(!!initial.edited);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ summary: initial.summary, what_they_do: initial.what_they_do });
  useDebouncedSave(draft, onSave);

  const change = (patch: Partial<typeof draft>) => { setDraft((d) => ({ ...d, ...patch })); setEdited(true); };

  async function run() {
    if (edited && !confirming) return setConfirming(true);
    setConfirming(false); setBusy(true); setError(null);
    try {
      const next = await regenerate();
      setBrief(next); setDraft({ summary: next.summary, what_they_do: next.what_they_do }); setEdited(false);
    } catch (e) { setError(`${(e as Error).message} Your brief is unchanged.`); }
    finally { setBusy(false); }
  }

  const field = "w-full resize-y rounded border border-transparent bg-transparent p-1 hover:border-stone-300 focus:border-teal-700 focus:bg-white focus:outline-none";
  return (
    <section aria-labelledby="brief-title" aria-busy={busy}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="brief-title" className="font-semibold">Company brief</h2>
        <div className="flex items-center gap-2">
          {confirming && <span className="text-xs text-amber-900">This replaces your edits to the brief.</span>}
          <button onClick={run} disabled={busy} className="rounded border border-stone-400 px-2 py-1 text-xs hover:bg-stone-100 disabled:opacity-50">
            {busy ? "Regenerating…" : confirming ? "Yes, regenerate" : "Regenerate brief"}
          </button>
          {confirming && <button onClick={() => setConfirming(false)} className="text-xs underline">Cancel</button>}
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
      <label className="mt-2 block text-xs text-stone-600">Summary
        <textarea value={draft.summary} rows={3} onChange={(e) => change({ summary: e.target.value })} className={`${field} text-sm text-stone-900`} />
      </label>
      <label className="mt-1 block text-xs text-stone-600">What they do
        <textarea value={draft.what_they_do} rows={3} onChange={(e) => change({ what_they_do: e.target.value })} className={`${field} text-sm text-stone-900`} />
      </label>
      {brief.hiring_page_found === false && <p className="mt-2 text-sm text-amber-900">No hiring or interview-process page was found on the company site.</p>}
      {brief.interview_process && brief.interview_process.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-medium">Interview process (from their site or public posts)</h3>
          <ol className="mt-1 list-inside list-decimal space-y-1 text-sm">
            {brief.interview_process.map((s, i) => (
              <li key={i}><span className="font-medium">{s.stage}</span>{s.detail ? `: ${s.detail}` : ""} <a href={s.source_url} target="_blank" rel="noreferrer noopener" className="text-xs text-teal-800 underline">source</a></li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
