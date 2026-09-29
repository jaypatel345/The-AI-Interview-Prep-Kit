"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, KitSummary } from "../../lib/api";

export default function KitsPage() {
  const [kits, setKits] = useState<KitSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<KitSummary[]>("/api/kits").then(setKits).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      // The backend de-duplicates identical jd + company_url and returns the existing kit id.
      const { id } = await api<{ id: string }>("/api/kits", {
        method: "POST",
        body: JSON.stringify({ jd: f.get("jd"), company_url: f.get("company_url"), days: Number(f.get("days")) }),
      });
      location.href = `/kits/${id}`;
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  // Batch: a JSON file shaped [{ jd, company_url, days }]
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const cases = JSON.parse(await file.text());
      if (!Array.isArray(cases)) throw new Error("File must be a JSON array of { jd, company_url, days }.");
      for (const c of cases) await api("/api/kits", { method: "POST", body: JSON.stringify(c) });
      load();
    } catch (err) { setError(`Upload failed: ${(err as Error).message}`); }
    e.target.value = "";
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your prep kits</h1>
        <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); location.href = "/login"; }} className="text-sm underline">Log out</button>
      </div>

      <form onSubmit={create} className="mt-6 space-y-3 rounded border border-stone-300 p-4">
        <label className="block text-sm">Job description
          <textarea name="jd" required rows={6} className="mt-1 w-full rounded border border-stone-400 p-2" placeholder="Paste the full posting" />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="min-w-0 flex-1 text-sm">Company website
            <input name="company_url" type="url" required placeholder="https://example.com" className="mt-1 w-full rounded border border-stone-400 px-2 py-1.5" />
          </label>
          <label className="text-sm">Days until interview
            <input name="days" type="number" required min={1} max={60} defaultValue={5} className="mt-1 block w-28 rounded border border-stone-400 px-2 py-1.5" />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy} className="rounded bg-teal-700 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? "Starting…" : "Build my kit"}</button>
          <label className="cursor-pointer text-sm underline">Upload several roles (.json)
            <input type="file" accept="application/json" onChange={upload} className="sr-only" />
          </label>
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}

      <ul className="mt-8 divide-y divide-stone-200">
        {kits === null && !error && <li className="py-3 text-sm text-stone-600">Loading…</li>}
        {kits?.length === 0 && <li className="py-3 text-sm text-stone-600">No kits yet. Paste a job description above to make your first one.</li>}
        {kits?.map((k) => (
          <li key={k.id} className="flex items-center justify-between py-3">
            <Link href={`/kits/${k.id}`} className="font-medium hover:underline">{k.role || "Untitled role"} at {k.company || "unknown company"}</Link>
            <span className="text-xs text-stone-600">{k.status}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
