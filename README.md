# Intake Triage

An internal tool for an AI consultancy. Inbound project requests come in through a form, a
background worker has a model summarise and tag each one and list its risks, and the team
triages from a list, a detail page and a dashboard.

## A. How to run

### Prerequisites

- Node 24 (the Docker image and the worker bundle target it; 22+ probably works but isn't tested)
- npm 10+
- Nothing else. The database is a SQLite file under `data/`, so there's no server to install.
- Optional: Docker with Compose v2, to run web and several workers as containers.
- Optional: an OpenAI API key. Without one, run with the mock provider.

### Install

```bash
npm ci                     # also generates the Prisma client
cp .env.example .env       # then edit it, see below
npm run db:deploy          # creates data/dev.db and applies the migrations
npm run db:seed            # 14 sample intakes, optional
```

### Environment variables

Only the first three matter for a first run. Everything is validated at startup, and a bad value
fails loudly with a message naming the variable instead of falling back to a default.

| Variable | Default | What it does |
| --- | --- | --- |
| `DATABASE_URL` | none, required | `file:../data/dev.db`. Relative to `prisma/schema.prisma`, so it lands in `data/`. |
| `AI_PROVIDER` | `openai` | `openai` calls the model. `mock` returns a deterministic analysis with no key and no network. |
| `OPENAI_API_KEY` | none | Required when `AI_PROVIDER=openai`. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any chat model that supports `json_schema` structured output. |
| `AI_TIMEOUT_MS` | `30000` | Per-call timeout. A timeout counts as a retriable failure. |
| `AI_CACHE` | on in dev and test | Caches model responses under `data/ai-cache/`, keyed on model, prompt version and intake. |
| `FORCE_AI_FAILURE` | unset | `retriable`, `unprocessable` or `terminal`. Makes every analysis fail that way, for demoing the error states. |
| `WORKER_IN_PROCESS` | unset | `true` runs a worker inside the Next server, so local dev is one command. |
| `WORKER_CONCURRENCY` | `4` | Jobs each worker runs at once. |
| `WORKER_MAX_ATTEMPTS` | `3` | Attempts before a retriable failure falls back to the heuristic analysis. |
| `WORKER_POLL_MS`, `WORKER_LEASE_MS`, `WORKER_HEARTBEAT_MS`, `WORKER_DRAIN_MS` | `500`, `60000`, `15000`, `10000` | Queue tuning. The heartbeat has to be shorter than the lease. |
| `WORKER_REPLICAS` | `2` | Docker only: how many worker containers to start. |

### Run it

One process, worker included:

```bash
WORKER_IN_PROCESS=true npm run dev
```

Or the way it runs in production, web and worker as separate processes. Start as many workers as
you like, they coordinate through leases in the database:

```bash
npm run dev        # terminal 1, the web app and API
npm run worker     # terminal 2, and again in terminal 3 for a second worker
```

With Docker, from a clean clone:

```bash
docker compose up --build                    # migrates, then web plus two workers
docker compose up --scale worker=3           # or set WORKER_REPLICAS
docker compose run --rm migrate npx prisma db seed
```

Compose runs the workers on the mock provider unless `.env` sets `AI_PROVIDER=openai` and a key.
Run `docker compose down` before applying a new migration, because Prisma can't migrate a SQLite
file other processes have open.

### Open it

- http://localhost:3000, the intake list
- http://localhost:3000/intakes/new, the create form
- http://localhost:3000/dashboard, the dashboard
- http://localhost:3000/api/intakes/export.csv, every intake as CSV

Under Docker, `PORT=3100 docker compose up` publishes on another port.

## B. What I built

### Overview

- A request comes in through a validated form and is saved straight away. Analysis happens in
  the background, so a slow or broken model never loses an intake or blocks the form.
- A durable, SQLite-backed job queue with leases, heartbeats, fencing tokens, jittered retries
  and graceful drain. Any number of worker processes can run against it, and a worker that dies
  mid-job has its lease swept and the job picked up by another.
- The UI follows each analysis live over Server-Sent Events, and falls back to polling if the
  stream won't stay up.

### The flow

1. **Create** (`/intakes/new`). Title, description, budget range, timeline, industry. The same
   zod schema validates in the browser and on the server, so they can't disagree. Submitting
   saves the intake, queues its analysis and lands you on its detail page.
2. **List** (`/`). Newest first, ten to a page, with status filter chips that show a count for
   each status. Filter and page live in the URL, so `/?status=NEW&page=2` is shareable and survives
   a reload. Cards update in place as analyses finish.
3. **Detail** (`/intakes/[id]`). The summary, three tags and a risk checklist, plus buttons to
   move the intake through `NEW`, `IN_REVIEW`, `ACCEPTED` and `DECLINED`. While the analysis runs,
   a four-stage stepper (Queued, Analysing, Validating, Ready) moves as events arrive and the
   summary types out as the model writes it.

On top of that there's a **dashboard** (totals, counts by status, top tags, how many analyses
fell back, and queue health: workers online, jobs in flight, median model latency, retries in
the last 24 hours) and a **CSV export** of every intake from the list or the dashboard.

The API behind it: `GET`/`POST /api/intakes`, `GET`/`PATCH /api/intakes/[id]`,
`POST /api/intakes/[id]/enrich` to retry, `GET /api/intakes/export.csv`, and `GET /api/stream` for
the event stream.

### The AI feature

- **What it returns.** A two or three sentence summary a delivery lead can skim before the first
  call, exactly three lowercase hyphenated tags, and up to five risks specific to the request.
- **How.** One chat completion with OpenAI structured output (`json_schema`, strict), streamed so
  the summary shows up while it's being written. The response is parsed with zod, then guardrails
  strip markdown, clamp the summary to 600 characters, normalise and dedupe the tags (padding to
  three if the model came up short), and cap the risks at five. Prompt version, model, latency,
  token counts and the raw response are stored with each result.
- **When it fails.** Errors are classified, not retried blindly. Timeouts, 429s, 5xx and malformed
  JSON are retriable: the worker backs off and tries again, up to `WORKER_MAX_ATTEMPTS`. Once
  attempts run out, or the model refuses the intake outright (context length, content policy), the
  worker writes a heuristic analysis built from the submitted fields instead. It flags vague
  budgets and timelines, thin briefs, regulated data and legacy integrations. Any other 4xx, like a
  bad model name or key, marks the analysis failed rather than hiding a config mistake behind
  fallback results.
- **Retry.** Failed and fallback analyses both have a Retry button. Retrying doesn't throw the
  previous result away, so if the retry fails for good, the old analysis still shows under the
  failure banner.
- **Mock provider.** `AI_PROVIDER=mock` runs the same pipeline, streaming and all, with a
  deterministic result and no key. It records its results as model output (model `mock`), so it
  exercises the happy path. Use `FORCE_AI_FAILURE` to see the others.

### UX states

- **Loading.** Skeleton blocks for the summary, tags and risks while an analysis runs, and
  buttons that disable and relabel while they submit. There are no route-level skeletons: in a
  production build `loading.tsx` made the router drop query-string navigations and refreshes, so
  pages wait for the server render instead, which is one local SQLite query.
- **Live progress.** The stage stepper, typed-out summary, and a note when an attempt failed and
  is queued to go again. Progress is announced to screen readers through a polite live region.
- **Empty.** "No intakes yet" with a link to create the first one, and a separate "No intakes
  match this filter" that says how many exist in total and offers to clear the filter.
- **Validation.** Inline, per field, with the first failing rule's message, linked to the input
  through `aria-describedby`. Server-side rejections show in a banner above the submit button.
- **Fallback.** An amber "AI unavailable, showing basic analysis" banner that says why, above the
  heuristic result, with a Retry button.
- **Failure.** A red "Analysis failed" banner that says the intake is saved and how many times it
  was tried, with a Retry button. If an earlier result exists it stays visible underneath.
- **Degraded stream.** If the event stream drops three times running, the page switches to
  polling every 3 seconds and tries the stream again after 30. After five minutes with no progress
  it stops polling and says so, with a "Check again" button, rather than looking like it's still
  working.
- **Not found.** A 404 page for an intake id that doesn't exist.
- **Responsive.** Laid out for desktop, tablet and phone widths without sideways scrolling.

## C. Verification

### How I convinced myself it works

- Wrote tests alongside each phase, and for every bug fix a test that fails without the fix. I
  checked the important ones by removing the fix and watching the test go red.
- Drove every flow in a real browser against the mock provider at desktop, tablet and phone
  widths: create, list, filter, paginate, detail, status changes, retry, dashboard, export, plus
  `FORCE_AI_FAILURE` to bring up the fallback and failure banners.
- Ran the e2e specs repeatedly against a production build, which is where the dropped-navigation
  bug showed up (`next dev` never shows it). After removing the loading boundaries, 60 of 60 list
  runs and 30 of 30 retry runs passed.
- Stopped a worker with SIGTERM mid-run and checked it drained, handed its jobs back and dropped
  off the dashboard. The crash path (a lease that lapses under a dead worker) is covered by the
  queue tests, including two workers racing for the same job.
- Ran the CSV export through Python's `csv` module and checked every row parsed to the same 13
  columns, and that it ignores the list's filter and page.

### Tests

Two suites. Vitest runs unit and integration tests against a real SQLite database
(`data/test.db`, recreated from the migrations on every run). Playwright drives the app in
Chromium against a production build, a separate `data/e2e.db` and a real worker process on the
mock provider.

```bash
npm test                          # Vitest
npx playwright install chromium   # once, before the first e2e run
npm run test:e2e                  # Playwright, builds and serves on port 3217 (E2E_PORT to move it)
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint
```

The e2e run sets its own env, so a `.env` with `WORKER_IN_PROCESS=true` or a real OpenAI key
doesn't leak into it. Its specs (`tests/e2e`) cover the happy path from the form to a finished
analysis, a list card updating itself live, both empty states, field-by-field validation, the
404, a hard failure recovered by Retry, and page 2 surviving a reload.

The Vitest suite covers:

- **Queue** (`tests/queue`): claiming (one winner when two workers race), leases and heartbeats,
  the expired-lease sweep, fencing so a worker that lost its lease can't write a result, retry
  backoff, handing jobs back on shutdown, worker presence, config validation.
- **AI** (`tests/ai`): error classification, partial summary parsing from a stream, guardrails, the
  heuristic fallback, the enrichment processor end to end with a stubbed provider, config
  validation, and the eval dump.
- **Durable retry** (`tests/queue/durable-retry.test.ts`): a retriable failure going back through
  the database and succeeding on the third attempt, running out of attempts and saving the
  fallback, and a worker that keeps going after a job blows up.
- **API** (`tests/api`): creating an intake (201 with its job and QUEUED event, trimming, a
  message per bad field, non-JSON bodies), pagination boundaries with and without a filter, the
  retry endpoint, where the event stream resumes from, and the CSV
  export (quoting, formula injection, BOM, batching over 1,000 rows, a failure mid-download, a
  cancelled download).
- **UI logic** (`tests/ui`): list pagination and filtering, the stepper's state machine, stream
  frame parsing and payload projection (so raw provider errors never reach the browser),
  dashboard aggregates, time formatting.

### Manual checklist

With `WORKER_IN_PROCESS=true AI_PROVIDER=mock npm run dev` and the seed loaded:

- [ ] Submit the form empty. Every field shows its own message and nothing is saved.
- [ ] Submit a valid intake. The detail page opens, the stepper runs through to Ready, the summary
      types out, and three tags and a risk list appear.
- [ ] Back on the list, the new intake is at the top with its tags.
- [ ] Filter by a status with no intakes to see the filtered empty state, then clear it.
- [ ] Go to page 2 and reload. You're still on page 2.
- [ ] Change an intake's status on its detail page, and check the list's chip counts moved.
- [ ] Restart with `FORCE_AI_FAILURE=unprocessable` and submit. The amber fallback banner appears
      with a heuristic analysis.
- [ ] Restart with `FORCE_AI_FAILURE=terminal` and submit. The red failure banner appears. Restart
      without it and press Retry. The analysis runs and completes.
- [ ] Open the dashboard. Totals match the list, and one worker is online.
- [ ] Export the CSV from the list. It opens in a spreadsheet with one row per intake and a
      description containing a comma stays in one cell.
- [ ] Run `npm run eval:dump`. It writes every finished analysis (input, raw response, saved
      result, latency and tokens) to `evals/runs-<timestamp>.jsonl` for scoring.
- [ ] With an empty database (`rm data/dev.db*`, then `npm run db:deploy`), the list shows
      "No intakes yet".
