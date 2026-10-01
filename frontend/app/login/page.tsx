"use client";
import { useEffect, useState } from "react";
import { api, markSignedIn } from "../../lib/api";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setExpired(new URLSearchParams(location.search).has("expired")), []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      await api(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify({ email: f.get("email"), password: f.get("password") }) });
      markSignedIn();
      location.href = "/kits";
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold">{mode === "login" ? "Log in" : "Create account"}</h1>
      {expired && <p role="status" className="mt-3 text-sm text-amber-800">Your session expired. Log in again to continue.</p>}
      <form onSubmit={submit} className="mt-6 space-y-4">
        <label className="block text-sm">Email
          <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded border border-stone-400 px-2 py-1.5" />
        </label>
        <label className="block text-sm">Password
          <input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} className="mt-1 w-full rounded border border-stone-400 px-2 py-1.5" />
        </label>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-teal-700 py-2 text-white disabled:opacity-50">{busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}</button>
      </form>
      <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="mt-4 text-sm text-teal-800 underline">
        {mode === "login" ? "Need an account? Register" : "Have an account? Log in"}
      </button>
    </main>
  );
}
