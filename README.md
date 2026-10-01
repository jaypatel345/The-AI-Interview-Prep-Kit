# AI Interview Prep Kit

Paste a job description, give the company URL and the days until the interview. The app crawls the company site, looks for its
hiring process and public discussion of its interviews, and builds a structured kit: company brief, role breakdown, categorised
question bank, flashcards and a day-by-day schedule. Everything is editable, one section can be regenerated without losing edits
elsewhere, and a practice mode tracks what you have covered.

## Tech stack
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + Tailwind CSS, TypeScript | Preferred stack. `/api/*` is proxied to Express so the session cookie is first-party. |
| Backend | Node.js + Express, TypeScript | Preferred stack. |
| Database | MongoDB (Mongoose) | Preferred stack; a kit is one document, which suits "save this section" updates. |
| Scraping | `fetch` + `cheerio` | Sites are server-rendered enough for this; a headless browser would blow the time and memory budget. |
| LLM | Google Gemini `gemini-3.8-flash` (free tier) via its OpenAI-compatible endpoint | Generous free tier. Any OpenAI-compatible provider works by changing 3 env vars (Groq example in `.env.example`). |
| Validation | Zod | One schema validates requests, model output and the final kit. |

## Setup (local)
Needs Node 20+ and MongoDB (local or a free Atlas cluster).
```bash
cd backend && npm install && cp .env.example .env    # set MONGODB_URI, JWT_SECRET, LLM_API_KEY
npm run dev                                          # API on :4000
cd ../frontend && npm install && cp .env.example .env.local
npm run dev                                          # app on :3000
```

## Batch entry point
From a clean clone, at the repository root:
```bash
npm install                       # installs the backend too
export LLM_API_KEY=...            # or put it in backend/.env (see backend/.env.example)
npm run evaluate -- --input examples/cases.json --output kits.json
```
Paths are relative to wherever you run it. It also works from `backend/` (`npm run evaluate -- --input ../examples/cases.json --output kits.json`).
It needs no database. It calls the same `runPipeline()` the web app uses, uses each case's `days`, writes the Appendix B shape,
records a failed case and moves on, and rewrites the output file after every case, so a crash never loses finished kits.
Cases run 2 at a time (`EVAL_CONCURRENCY`) sharing one rate-limit pacer. A case goes to `failed` only when no kit could be made at
all (for example, the model is unavailable). An unreachable site or a missing hiring page still gives `ok`, with the gaps recorded in `notes`.
Private and localhost URLs are allowed unless `NODE_ENV=production`, so cases served from `http://localhost:8099/...` work.

Verified run: 4/4 example cases ok in 4m20s (the brief allows fifteen minutes for five), with zero uncovered
must-have requirements and schedules of exactly 1, 3, 5 and 60 days. Note that the full `gemini-*-flash` models
carry a 20-request-per-day free quota that a single case exhausts, which is why the default is a `-lite` model.

Tests: `cd backend && npm test` (schedule allocation, coverage loop, schema validation, extraction grounding and priority, crawler
against a local test site, robots.txt, URL safety, and a full pipeline run with a fake model). `cd frontend && npm test` (edit/regenerate state, weak spots).

## Deployment
Order matters: the backend needs the database URL, and the frontend needs the backend URL.
1. **Database:** MongoDB Atlas free (M0) cluster. Create a database user, and under Network Access allow
   `0.0.0.0/0` (Render's free tier has no static egress IP). Copy the SRV connection string.
2. **Backend:** Render > New > Blueprint, pointed at this repo: `render.yaml` sets the root directory, build and
   start commands, and the health check. The build runs `npm install --include=dev`, because `NODE_ENV=production`
   otherwise makes npm skip the devDependencies that `tsc` needs. Render prompts for `MONGODB_URI`, `LLM_API_KEY` and `FRONTEND_ORIGIN`,
   and generates `JWT_SECRET` itself. Leave `FRONTEND_ORIGIN` blank until step 3, then fill it in.
3. **Frontend:** Vercel, root directory `frontend`, env `API_URL=https://<your-render-service>.onrender.com`.
4. Go back to Render and set `FRONTEND_ORIGIN` to the exact Vercel URL, scheme included. The CSRF origin check
   compares it literally, so a trailing slash or a `www.` difference rejects every write with `BAD_ORIGIN`.
- Secrets live only in the host's env settings; `.env` is git-ignored. Each variable is documented in the `.env.example` files.
- Free Render instances sleep when idle, so the first request after a pause can take ~30-50 s.

## Architecture
```
frontend (Next.js) ──/api proxy──> Express API ──> MongoDB (users, kits: status, progress, kit, research, practice)
                                        │
                                        └─ jobs.ts (in-process runner) ─> pipeline.ts ─┬─ retrieval/  safe-url, fetcher, robots, clean, crawl, discussion
  npm run evaluate ─> evaluate.ts ───────────────────────────────────────┘             ├─ generation/ extract, brief, questions, coverage, flashcards
                                                                                        ├─ schedule.ts (deterministic)
                                                                                        └─ kit-schema.ts (Zod, Appendix A + cross-reference checks)
```
Retrieval, extraction, generation, scheduling and persistence are separate modules. `llm.ts` is the only place that talks to the provider.

## Retrieval and sources
- **Company site:** fetch the given URL, collect every same-site link (relative links resolved against the page) plus sitemap entries,
  **score** each by path and anchor text (interview, hiring, careers, handbook, about, and so on; login, legal and files score negative),
  fetch the best, and follow links one level further from pages that look relevant. There is no fixed list of paths: the test crawls
  `home -> handbook -> ../hiring/how-we-interview`. Up to `CRAWL_MAX_PAGES` (8). The hiring page is whichever fetched page describes
  the most interview-process ideas (stages, take-home, system design, and so on), picked by code.
- **Public discussion:** Hacker News via the Algolia search API (free, keyless, meant for programs). A hit counts only if it names the
  company or domain *and* mentions interviews. I left out Reddit and Glassdoor because their terms forbid scraping.
- **Politeness:** robots.txt (Allow/Disallow, Crawl-delay) checked for every page, at most one request per host every 400 ms,
  3 attempts with backoff on 429/5xx/timeouts. A failed source is recorded in the kit's warnings and notes, and the run goes on.
- **Security:** only http(s); no credentials in URLs; in production, DNS is resolved and private, loopback and link-local addresses
  (including 169.254.169.254) are refused, and every redirect hop is checked again; 10 s timeout; 2 MB cap; only HTML, text, JSON and
  XML accepted. Scripts and hidden elements are removed (a common place to hide prompt injection). All third-party text (JD, pages,
  posts) goes to the model inside `<untrusted>` tags, the system prompt says to treat it as data, and nothing the model returns is
  trusted without checking (see below).

## How the steps are sequenced
Every step is its own module and reacts to what the one before it found:
1. **Extract** (LLM, `extract.ts`): requirements with a verbatim `quote`. Then **code** checks each one: a requirement whose quote is
   not in the posting is dropped as invented, and `must`/`nice` comes from the posting's wording (the line itself, then the heading it
   sits under: "Nice to have", "Bonus", "a plus", "Requirements"). The model's guess is used only when the posting doesn't say.
   Ids `r1..rn` are stable. A short posting is marked `thin` and gets a short kit.
2. **Crawl** (no LLM). Pasted text needed no retrieval; the homepage needs crawling before it's useful.
3. **Discussion search** (no LLM).
4. **Brief** (LLM): only from fetched content; interview stages must cite a URL we actually gave it. No pages means an honest
   "we could not retrieve anything" brief with no model call. **Code** detects format signals (take-home, system design, pair or live
   coding, values round) from the hiring page and discussion text.
5. **Questions, one call per category**, each with its own instructions and its own requirements (`planCategories`): technical and
   domain requirements go to *technical*, behavioural to *behavioural*. *System design* is added only if the company's process mentions it,
   the role is senior, or the requirements are about design. *Company fit* uses only brief facts. The signals change the prompts
   (a published take-home adds a take-home question; a system-design round shapes that category). The model can't claim coverage
   of a requirement id it wasn't given.
6. **Coverage loop** (`coverage.ts`): **code** lists must-haves with no question. The model is asked for *only those gaps*, then code
   checks again. At most 3 passes: a gap-targeted prompt almost always closes the gap in one retry, a second catches the odd miss,
   and more passes spend rate-limited tokens for nothing. Anything still uncovered gets a clearly labelled template question, so a
   kit never ships with an uncovered must-have. `coverage.passes` and `coverage_log` record what happened.
7. **Flashcards** (code, one per question) and the **schedule** (code). The kit is then validated against the schema before saving.

## Generated, edited and pinned state
Each question carries `origin: generated | edited | manual` and `pinned` (extensions to Appendix A). Any human edit turns
`generated` into `edited`; hand-written questions are `manual`. Regenerating a category replaces only questions that are
`generated` and not pinned. The server returns *candidates only*; the client merges them in a reducer against its **latest** state,
so an edit made while the request was in flight is still protected. Duplicates of kept questions are dropped (`lib/question-state.ts`, tested).
Questions and flashcards both reorder with buttons or Alt+Arrow keys. Each section saves to its own endpoint (`PUT /questions`, `/flashcards`, `/brief`) and regenerating the brief or schedule writes only
that field, so no section can overwrite another. Edits are debounced (600 ms) and flushed if you navigate away; tab panels stay mounted.
Regenerating a brief you edited asks for confirmation first.

## Schedule allocation (`schedule.ts`, no model)
Each question gets a score: +10 if it covers a must-have, plus its difficulty. The ranked list is cut into contiguous, near-equal
chunks, one per day, with any remainder going to the earliest days. So day 1 gets the hardest must-have material and the last day
the lightest. Minutes are integers (10/15/25 by difficulty). There are always exactly `days` entries: with fewer questions than days,
the extra days become review days that revisit the top-ranked questions (so 60 days works), and 1 day holds everything.
Every covered must-have therefore shows up in the schedule. **Rebuild schedule** re-runs this on your edited questions.

## Practice mode
Step through cards, reveal (Space), rate 1-3. Order: unseen first, then lowest confidence, then least recently seen. I chose this
over spaced repetition because a kit is studied for a few days before a fixed date, so SR intervals never come into play. The order
is fixed per session so cards don't jump around while you rate them.

## Creative feature: Weak spots
Practice shows your weakest **job requirements** (not cards): unpractised cards count as 0, must-haves count double. **Drill** starts a
session with only that requirement's cards. Card-level scores don't tell you "I'm still weak on the PostgreSQL requirement, the one the
interviewer will test", and this does.

## Edge cases
| Case | Behaviour |
|---|---|
| Invalid URL, 404, timeout | Retried where it makes sense, recorded as skipped; the brief says the site could not be read; kit still `ok`. |
| No hiring/about page | `hiring_page_found: false`, stated in the brief and notes; questions come from the JD alone. |
| Two-line JD | Few requirements, `thin` flag, smaller question counts, and a banner saying the kit is short on purpose. |
| No public discussion | Recorded in notes; nothing invented. |
| Invalid JSON / incomplete output | Zod validation, up to 2 repair round-trips, then a clear error. A failed category is skipped and the coverage loop fills must-haves. |
| Rate limits / brief outages | Requests paced to `LLM_RPM`; 429/5xx retried with exponential backoff, honouring `Retry-After`. |
| Same JD + company submitted twice | Unique index on (user, hash): returns the existing kit; a second trigger of a running job does nothing. |
| 1-day or 60-day schedule | Exactly that many days (tested for 1, 2, 5, 12, 20, 60). |
| 90-second generation / restart mid-run | Runs in the background; progress and warnings go to MongoDB, the UI polls and you can leave. Jobs still running after a restart are marked failed with a retry button. |

## Key decisions, trade-offs and known limitations
- **Code decides what can be checked:** grounding, priority wording, coverage, hiring-page choice, format signals and scheduling.
  The model writes text; it doesn't grade itself.
- The job runner is in-process (fine for one free instance); a queue such as BullMQ is the upgrade path. Sessions are JWTs in an httpOnly
  cookie, so logout can't revoke a stolen token before it expires.
- The SSRF check resolves DNS before connecting, so DNS rebinding between check and connect is still possible (pinning the IP is the fix).
- JavaScript-only sites (client-side rendering) give little text without a headless browser. Only one public-discussion source.
- Schedule minutes are estimates by difficulty, not a model of the user's speed.
