# **Tribe AI Exercise 3 — Intake Triage Implementation Plan**

Sep 20, 2026 · @Someone

## **Scope**

A small internal tool that triages inbound project requests. One thin end-to-end slice: frontend, API, persistence, an AI feature, UX states, reproducibility.

**Core requirements**

* Intake creation and persistence: title, description, budget range, timeline, industry, created\_at. SQLite.  
* Three frontend views: list, detail, create form.  
* AI feature on creation: 2–3 sentence summary, three tags, a risk checklist. Stored and displayed.  
* UX states: loading, empty, and at least one clear user-visible error path.

**Bonuses — all of them**

* Dockerize (Dockerfile plus compose)  
* TypeScript  
* Background / async processing for the AI call  
* Tests  
* Dashboard (counts by tag or status) *and* CSV export  
* AI reliability: retries, fallback behavior, guardrails  
* Structured output against a JSON schema, listed as a bonus under the AI feature

**Time:** this plan runs past the stated 2–3 hour expectation. The brief allows that, provided the recording keeps running and the actual total is declared at submission.

**What is actually evaluated:** shipping a coherent end-to-end slice, product sense and UX empathy, judgment and prioritization, verification mindset, and how agents get used in unfamiliar areas. Not pixel-perfect UI, not a specific framework, not writing everything by hand.

## **Stack and architecture**

Option A from the brief, the recommended default, with TypeScript throughout.

| Layer | Choice | Why |
| :---- | :---- | :---- |
| Framework | Next.js 15, App Router | The brief's recommended default |
| Language | TypeScript | Listed bonus, and the Zod schemas pay for themselves |
| API | Route Handlers under /api | A real, inspectable API surface to curl on camera. Server Actions would hide the frontend/backend boundary they ask you to explain |
| ORM / DB | Prisma \+ SQLite at ./data/dev.db, Postgres adapter opt-in | SQLite is the brief's recommendation; the queue is written against an interface so Postgres is a config swap |
| Styling | Tailwind | Fast, and polish is explicitly not evaluated |
| LLM | OpenAI gpt-4o-mini, response\_format: json\_schema, streamed | Structured output is the bonus; the schema doubles as a guardrail; streaming feeds the UI |
| Validation | Zod, shared client and server | One schema for the form and the API |
| Async | Standalone worker processes leasing jobs from the database | Distributed: run N replicas, each with WORKER\_CONCURRENCY jobs in flight |
| Realtime | SSE over an append-only event log | Streaming feedback without introducing a broker |
| Tests | Vitest plus Playwright (chromium) | Unit and API coverage, plus one real end-to-end browser path |

**Triage status on every intake** — NEW / IN\_REVIEW / ACCEPTED / DECLINED, changed with one click on the detail page. This is the product-sense move: without it the app is a list with summaries, not a triage tool. It also feeds the dashboard, which the brief suggests counting by tag *or* status.

## **Data model**

model Intake {  
&nbsp;&nbsp;id          String   @id @default(cuid())  
&nbsp;&nbsp;title       String  
&nbsp;&nbsp;description String  
&nbsp;&nbsp;budgetRange String  
&nbsp;&nbsp;timeline    String  
&nbsp;&nbsp;industry    String  
&nbsp;&nbsp;status      String   @default("NEW")  // NEW | IN\_REVIEW | ACCEPTED | DECLINED  
&nbsp;&nbsp;createdAt   DateTime @default(now())  
&nbsp;&nbsp;enrichment  Enrichment?  
&nbsp;&nbsp;tags        Tag\[\]  
&nbsp;&nbsp;events      Event\[\]

&nbsp;&nbsp;@@index(\[createdAt\])  
&nbsp;&nbsp;@@index(\[status\])  
}

model Enrichment {  
&nbsp;&nbsp;id             String    @id @default(cuid())  
&nbsp;&nbsp;intakeId       String    @unique  
&nbsp;&nbsp;intake         Intake    @relation(fields: \[intakeId\], references: \[id\], onDelete: Cascade)  
&nbsp;&nbsp;state          String    @default("PENDING") // PENDING | PROCESSING | READY | FAILED  
&nbsp;&nbsp;summary        String?  
&nbsp;&nbsp;risks          String?   // JSON array  
&nbsp;&nbsp;source         String?   // LLM | FALLBACK  
&nbsp;&nbsp;model          String?  
&nbsp;&nbsp;attempts       Int       @default(0)  
&nbsp;&nbsp;error          String?

&nbsp;&nbsp;// queue coordination  
&nbsp;&nbsp;nextAttemptAt  DateTime  @default(now())  
&nbsp;&nbsp;lockedBy       String?   // worker id, for debugging  
&nbsp;&nbsp;lockToken      String?   // fencing token — stale workers cannot write  
&nbsp;&nbsp;leaseExpiresAt DateTime?

&nbsp;&nbsp;// for your prompt review afterwards  
&nbsp;&nbsp;promptVersion  String?  
&nbsp;&nbsp;rawResponse    String?  
&nbsp;&nbsp;latencyMs      Int?  
&nbsp;&nbsp;tokensIn       Int?  
&nbsp;&nbsp;tokensOut      Int?

&nbsp;&nbsp;updatedAt      DateTime  @updatedAt

&nbsp;&nbsp;@@index(\[state, nextAttemptAt\])  
&nbsp;&nbsp;@@index(\[state, leaseExpiresAt\])  
}

model Tag {  
&nbsp;&nbsp;id       String @id @default(cuid())  
&nbsp;&nbsp;intakeId String  
&nbsp;&nbsp;intake   Intake @relation(fields: \[intakeId\], references: \[id\], onDelete: Cascade)  
&nbsp;&nbsp;label    String

&nbsp;&nbsp;@@index(\[label\])  
}

model Event {  
&nbsp;&nbsp;seq       Int      @id @default(autoincrement())  
&nbsp;&nbsp;intakeId  String  
&nbsp;&nbsp;intake    Intake   @relation(fields: \[intakeId\], references: \[id\], onDelete: Cascade)  
&nbsp;&nbsp;type      String   // QUEUED | CLAIMED | CALLING\_MODEL | PARTIAL | VALIDATING  
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;// | READY | FAILED | FALLBACK | RETRY\_SCHEDULED | STATUS\_CHANGED  
&nbsp;&nbsp;payload   String?  // JSON  
&nbsp;&nbsp;createdAt DateTime @default(now())

&nbsp;&nbsp;@@index(\[intakeId, seq\])  
&nbsp;&nbsp;@@index(\[seq\])  
}

Three decisions worth defending on camera:

* **Enrichment lives in its own table.** It makes "where AI is called and how results are stored" a thirty-second answer, and it gives the queue somewhere to keep leases, tokens and attempt counts without polluting the domain model.  
* **Tags are rows, not a JSON blob.** Five extra minutes buys a real groupBy for the dashboard instead of loading every intake and counting in memory.  
* **Risks stay JSON.** Display-only, nothing queries them, so a table would be ceremony.  
* **Event is an append-only log with a monotonic seq.** It is the backbone of the streaming UI: seq doubles as the resume cursor, so a dropped SSE connection reconnects with Last-Event-ID and misses nothing. It is also a free audit trail of what the worker did and when.  
* **rawResponse and promptVersion are stored deliberately** so prompt quality can be reviewed after the build rather than guessed at during it.

## **Distributed queue design**

No broker, no Redis. The Enrichment row *is* the job record and workers compete for it. Job state cannot drift out of sync with domain state, and the whole thing is inspectable with a SELECT.

**Lifecycle:** PENDING → PROCESSING → READY | FAILED, with PROCESSING → PENDING on a retriable failure or an expired lease.

### **The SQLite tension, stated plainly**

A genuinely distributed queue wants Postgres. SQLite has a single writer and no cross-process notification, so "distributed" on SQLite means *multiple worker processes on one host sharing a file*, which works but does not survive being spread across machines. The brief recommends SQLite and requires emailing them before switching to Postgres.

Resolution: write the claim protocol against a JobStore interface, ship the SQLite adapter as the default, and provide the Postgres adapter as an opt-in compose profile. The distribution model is real and demonstrable either way; only the ceiling changes. This is a good thing to say out loud in the wrap-up — it shows the constraint was noticed rather than tripped over.

|  | SQLite (default) | Postgres (\--profile postgres) |
| :---- | :---- | :---- |
| Claim | updateMany compare-and-swap | SELECT … FOR UPDATE SKIP LOCKED |
| Workers | N processes, one host | N processes, any host |
| Event notify | Server-side tail of Event | LISTEN / NOTIFY |
| Writer | Single, WAL \+ busy\_timeout | Concurrent |

### **Claiming, with a lease and a fencing token**

Each worker claims up to WORKER\_CONCURRENCY \- inFlight jobs per tick. The claim is a compare-and-swap, so two workers racing the same row cannot both win.

const token \= crypto.randomUUID();

const claimed \= await db.enrichment.updateMany({  
&nbsp;&nbsp;where: { id: candidate.id, state: 'PENDING' },   // CAS guard  
&nbsp;&nbsp;data: {  
&nbsp;&nbsp;&nbsp;&nbsp;state: 'PROCESSING',  
&nbsp;&nbsp;&nbsp;&nbsp;lockedBy: WORKER\_ID,  
&nbsp;&nbsp;&nbsp;&nbsp;lockToken: token,  
&nbsp;&nbsp;&nbsp;&nbsp;leaseExpiresAt: new Date(Date.now() \+ 60\_000),  
&nbsp;&nbsp;&nbsp;&nbsp;attempts: { increment: 1 },  
&nbsp;&nbsp;},  
});  
if (claimed.count \=== 0\) return null;  // lost the race, loop again

Three properties fall out of this:

* **Leases, not locks.** A heartbeat extends leaseExpiresAt by 60s every 15s while the job is in flight. A worker that dies simply stops extending, and its lease lapses.  
* **Any worker can reap.** The sweep resets rows whose leaseExpiresAt is in the past back to PENDING. No coordinator, no leader election.  
* **The fencing token prevents double writes.** Every terminal write is updateMany({ where: { id, lockToken: token } }). If a slow worker was reaped and another has since picked the job up, its count comes back 0 and the stale result is discarded rather than clobbering the newer one. This is the detail that separates a real distributed queue from a loop with a lock column.

### **Configuration**

| Variable | Default | Meaning |
| :---- | :---- | :---- |
| WORKER\_CONCURRENCY | 4 | Jobs in flight per worker process |
| WORKER\_POLL\_MS | 500 | Claim tick interval |
| WORKER\_LEASE\_MS | 60000 | Lease duration |
| WORKER\_HEARTBEAT\_MS | 15000 | Lease extension interval |
| WORKER\_MAX\_ATTEMPTS | 3 | Attempts before fallback |
| WORKER\_REPLICAS | 2 | Worker containers in compose |

Effective parallelism is WORKER\_REPLICAS × WORKER\_CONCURRENCY. Say that number out loud when demoing; it is the whole point of the design.

### **Retry, exhaustion, recovery**

* **Retriable failure** — write error, set nextAttemptAt \= now \+ 2^attempts × 2s \+ jitter, state back to PENDING, emit RETRY\_SCHEDULED. Backoff lives in the database, so it survives a restart.  
* **Exhausted** at attempts \>= WORKER\_MAX\_ATTEMPTS — run the heuristic fallback, write state: READY, source: FALLBACK, emit FALLBACK. Only a fallback failure yields FAILED.  
* **Expired lease** — the sweep returns the row to PENDING. This is what makes a mid-job crash recoverable, and it is the single most important line of code in the queue.

### **Running the workers**

Workers are a standalone entrypoint, npm run worker, with no Next.js import anywhere under lib/queue/. Compose scales them with deploy.replicas. For local development a WORKER\_IN\_PROCESS=true flag starts one inside instrumentation.ts so there is only one thing to run.

Graceful shutdown on SIGTERM: stop claiming, let in-flight jobs finish, then clear the leases on anything unfinished so another replica picks it up immediately rather than waiting out the lease.

### **SQLite pragmas — not optional**

With several worker processes plus the web process, these are the difference between working and SQLITE\_BUSY:

await db.$executeRawUnsafe('PRAGMA journal\_mode=WAL;');  
await db.$executeRawUnsafe('PRAGMA busy\_timeout=5000;');

## **Streaming feedback design**

Polling is the wrong shape once a worker is a separate process: the browser would be asking a server that does not itself know when anything changed. The fix is an append-only event log plus SSE.

### **The path an update takes**

1. The worker emits an Event row at every stage: CLAIMED, CALLING\_MODEL, PARTIAL, VALIDATING, READY.  
2. GET /api/stream?intakeId=…\&since=\<seq\> holds a text/event-stream open and tails the Event table server-side at 250ms, writing each new row as an SSE frame with id: \<seq\>.  
3. The browser uses EventSource. On a dropped connection it reconnects automatically with Last-Event-ID, and the handler resumes from that seq — no gaps, no duplicates.

The server still polls, but it polls locally, once, on behalf of every connected client, at a much tighter interval than a browser could reasonably manage. The client experience is genuinely streamed. With the Postgres adapter, the tail is replaced by LISTEN/NOTIFY behind the same subscribe() signature and nothing above it changes.

A heartbeat comment every 15s keeps proxies from closing idle streams.

### **Token streaming**

The worker calls OpenAI with stream: true and emits PARTIAL events carrying the summary-so-far, throttled to roughly one every 300ms so the event log does not fill with noise. The detail page renders that as text appearing as it is generated.

Structured outputs stream as JSON deltas, so the accumulated buffer is only valid JSON at the end. Extract the summary field optimistically for display, and treat the final parse as the source of truth. If optimistic extraction proves fiddly, fall back to emitting one PARTIAL when the model finishes and letting the client typewriter it — visually near-identical, ten minutes cheaper.

### **What the user sees**

A stage stepper on the detail page — Queued → Analyzing → Validating → Ready — with real elapsed times pulled from the event log, and the summary filling in as it streams. The list view subscribes to a single stream for all non-terminal rows on the current page and updates badges in place.

**Degradation:** if EventSource fails or the stream drops repeatedly, fall back to the polling hook. Keeping both is about twenty lines and makes for a strong reliability answer.

**Bad-input UX:** the stepper also has to handle the empty case honestly — if the model returns nothing usable, the stepper resolves to the fallback banner rather than spinning forever. A progress indicator that cannot fail is a lie.

## **Phase 0 — Setup**

The queue and the AI pipeline now sit ahead of the UI, which pushes the first *polished* slice out to around T+3:50. That is a long time to go without something on screen, so insert a deliberate checkpoint: after Phase 1, spend fifteen minutes on an unstyled list page and form that hit the real API. Ugly is fine. It proves the slice end to end, it gives the recording something to show early, and it means an unexpected disaster still leaves a working application.

* ☐ **T0.1 — Scaffold the project and start the git history.** Run create-next-app with TypeScript, Tailwind and the App Router, then git init and commit before writing anything else. The submitted zip has to contain .git, so the commit history is itself part of the deliverable and shows how the build was sequenced.  
* ☐ **T0.2 — Install dependencies.** prisma, @prisma/client, zod, openai, vitest.  
* ☐ **T0.3 — Write the Prisma schema and run the first migration.** Model Intake, Enrichment, Tag and Event as laid out in the data model section. Commit the generated migration file rather than relying on db push, since a reviewer will look for it.  
* ☐ **T0.4 — Seed fourteen sample intakes.** Enough rows that pagination is visible on the first page and the dashboard has real shape. Vary industry, budget and status so filters and counts have something to show rather than returning uniform results.  
* ☐ **T0.5 — Set up the Prisma client singleton with SQLite pragmas.** lib/db.ts exports one client and enables WAL plus a busy timeout on startup. Several worker processes will share this file later; without these two pragmas they collide under load.  
* ☐ **T0.6 — Establish environment handling.** .env.example listing OPENAI\_API\_KEY and DATABASE\_URL, with .env and data/\*.db\* gitignored. Done when a fresh clone can be configured from the example alone.

## **Phase 1 — API and persistence**

* ☐ **T1.1 — Define the shared validation schema.** lib/schemas.ts exports CreateIntakeSchema, imported by both the create form and the route handler. One definition means the client and the server cannot drift apart about what a valid intake looks like.  
* ☐ **T1.2 — Build the create endpoint.** POST /api/intakes validates the body, then creates the intake and its PENDING enrichment row in a single transaction and returns 201 immediately. There is no enqueue call anywhere: writing the row *is* the enqueue, which is worth pointing out explicitly during the walkthrough.  
* ☐ **T1.3 — Build the list endpoint with pagination and filtering.** GET /api/intakes?page\&pageSize\&status returns { items, page, pageSize, total, totalPages } with tags and enrichment state attached to each item. Clamp pageSize to a maximum of 50 so the endpoint cannot be used to dump the whole table in one request.  
* ☐ **T1.4 — Build the detail endpoint.** Returns one intake with its tags, risks, enrichment state, attempt count and error message, which is everything the detail page and its error banner need.  
* ☐ **T1.5 — Build the triage status endpoint.** PATCH /api/intakes/\[id\] accepts a status only, validated against the four allowed values, and emits a STATUS\_CHANGED event so the change flows through the same stream as everything else.  
* ☐ **T1.6 — Verify the API with curl before touching the UI.** Exercise all five endpoints, including the invalid-body case. This is the cheapest verification loop available and it makes a good beat in the recording: it shows the boundary being tested before anything is built on top of it.  
* ☐ **T1.7 — Put up an ugly slice.** An unstyled list page and form wired to the real endpoints, with no states and no styling. It proves the slice end to end, gives the recording something working to show early, and means a later disaster still leaves a functioning application.

## **Phase 2 — Distributed queue**

Build the queue before the AI call, with a stub processor that sleeps two seconds and writes a canned result. That way the whole async path — claim, poll, terminal state — is provably working before any LLM variability enters the picture.

* ☐ **T2.1 — Define the JobStore interface.** claim(n), heartbeat(id, token), complete(id, token, result), fail(id, token, err), reap(), subscribe(sinceSeq). Every storage-specific detail lives behind this boundary, which is what makes swapping in Postgres a configuration change rather than a rewrite.  
* ☐ **T2.2 — Implement the SQLite adapter.** Compare-and-swap claim, lease extension, fencing-token-guarded terminal writes, and the expired-lease sweep. This is the heart of the queue; take the time to get the four operations right before building anything on them.  
* ☐ **T2.3 — Centralise worker configuration.** lib/queue/config.ts reads and validates the six WORKER\_\* variables against the documented defaults, failing loudly on a nonsense value rather than silently falling back. Misconfigured concurrency is otherwise invisible until the demo.  
* ☐ **T2.4 — Build the worker loop.** Claims up to WORKER\_CONCURRENCY jobs per tick, heartbeats their leases while they run, and on SIGTERM stops claiming, drains in-flight work, then releases any remaining leases so another replica can pick them up immediately instead of waiting out the lease.  
* ☐ **T2.5 — Add the event emitter.** emit(intakeId, type, payload) appends a row to Event, called at every stage transition. Getting this in now means the streaming work in Phase 5 is only rendering, and it gives you a readable audit trail while debugging the queue.  
* ☐ **T2.6 — Create the worker entrypoint.** An npm run worker script for the standalone process, plus a WORKER\_IN\_PROCESS=true path in instrumentation.ts for local convenience. Nothing under lib/queue/ may import Next.js — that constraint is what keeps the process boundary real.  
* ☐ **T2.7 — Write a stub processor.** Sleeps, emits the full event sequence, writes a canned result. The whole async path becomes provable before LLM variability is anywhere near it, so a later failure has an unambiguous cause.  
* ☐ **T2.8 — Verify distribution.** Run two workers at concurrency 2 against six intakes, then check lockedBy to confirm both workers took work and nothing was processed twice.  
* ☐ **T2.9 — Verify crash recovery.** SIGKILL a worker mid-job and confirm the other reaps the expired lease and completes it. Rehearse this one; it becomes a demo clip later.  
* ☐ **T2.10 — *Optional:* build the Postgres adapter.** SELECT … FOR UPDATE SKIP LOCKED behind the same interface, plus a postgres compose profile. Worth doing only if this phase ran clean, and it lifts the distribution ceiling off a single host.

## **Phase 3 — AI pipeline**

Swap the stub processor for the real thing.

* ☐ **T3.1 — Define the output contract.** The JSON schema sent to the model and a matching Zod schema for parsing the response back: summary, exactly three tags, a risks array, optionally priority. Shape gets enforced twice, once by the model and again on the way in.  
* ☐ **T3.2 — Write the prompt.** A system prompt framing the model as a triage analyst at a consulting firm, and a user message assembled from the intake fields. Export a PROMPT\_VERSION constant so every stored output is attributable to a specific prompt when you review quality afterwards.  
* ☐ **T3.3 — Build the client.** OpenAI call with the json\_schema response format, stream: true, and an AbortController timeout so a hung request cannot sit on a lease indefinitely.  
* ☐ **T3.4 — *Optional:* emit partial summary events.** Throttle to roughly one PARTIAL event per 300ms as deltas arrive, so the event log carries progress without filling with noise.  
* ☐ **T3.5 — Write the guardrails.** Normalize after parsing: exactly three tags, lowercased and kebab-cased and deduped; summary clamped; at most five risks; markdown stripped. The schema constrains the shape, these constrain the content — both are needed.  
* ☐ **T3.6 — Write the fallback.** A deterministic heuristic: keyword-to-tag mapping, a templated summary built from the structured fields, and rule-based risks triggered by a missing budget or a vague timeline. Marked source: FALLBACK so the interface can be honest about what the user is looking at.  
* ☐ **T3.7 — Persist the call metadata.** rawResponse, promptVersion, latencyMs, tokensIn and tokensOut on every call. This is the task that makes your post-build prompt review possible at all, and it is easy to skip and impossible to backfill.  
* ☐ **T3.8 — Wire into the worker and classify errors.** Timeouts, 5xx responses and schema parse failures are retriable; 4xx and auth errors are terminal and should fail fast rather than burning three attempts on a bad key.  
* ☐ **T3.9 — Add a mock provider.** AI\_PROVIDER=mock returns a canned result after an 800ms delay with a fake token stream. Deterministic Playwright runs, no API spend, no flake — this pays for itself the first time the e2e suite runs.  
* ☐ **T3.10 — Add a failure switch.** FORCE\_AI\_FAILURE=1 makes the client throw, so the error and fallback paths can be demonstrated on camera without disconnecting the network.  
* ☐ **T3.11 — *Optional:* have the model propose a triage priority.** HIGH / MEDIUM / LOW alongside the existing fields, which makes the AI feature feel like it is doing triage work rather than just summarizing.

## **Phase 4 — Frontend**

* ☐ **T4.1 — Build the app shell.** Navigation, layout and base styling, enough to hang the three views off without thinking about it again.  
* ☐ **T4.2 — Build the list view.** Cards showing title, industry, budget, status badge, tag chips and a relative timestamp. Read page and status from searchParams rather than component state, so paging is shareable by URL and the back button behaves the way people expect.  
* ☐ **T4.3 — Add pagination controls.** Previous and next, a "Page 2 of 3" indicator and a total count, with both buttons correctly disabled at the ends of the range.  
* ☐ **T4.4 — Build two distinct empty states.** "No intakes yet" with a create call to action, and "nothing matches this filter" with a clear-filter action. The difference costs almost nothing to build and is precisely the UX empathy the exercise is scoring.  
* ☐ **T4.5 — Add loading skeletons** for the list and the detail view, sized to the real content so the page does not jump when data arrives.  
* ☐ **T4.6 — Build the create form.** All five fields, inline validation from the shared Zod schema, a disabled submitting state, and a redirect to the detail page on success so the user lands where the AI result will appear.  
* ☐ **T4.7 — Build the detail view.** Intake fields, AI summary, tag chips, risk checklist, and triage status buttons wired to the PATCH endpoint.  
* ☐ **T4.8 — Add the pending treatment.** An "Analyzing…" state on both list rows and the detail page, which the stage stepper replaces in the next phase.  
* ☐ **T4.9 — *Optional:* add status filter chips,** which pair naturally with the dashboard counts.

## **Phase 5 — Streaming, retry, error UX**

This is where the required error path gets built. Treat it as a feature, not a catch block — and make sure the stepper can reach a terminal failure state rather than spinning forever.

* ☐ **T5.1 — Build the SSE endpoint.** GET /api/stream tails the Event table at 250ms and writes each new row as a frame carrying id: \<seq\>, resumes from Last-Event-ID on reconnect, sends a heartbeat comment every 15s to stop proxies closing idle streams, and cleans up when the client disconnects.  
* ☐ **T5.2 — Build the stream hook.** useIntakeStream wraps EventSource with a reducer over the event types and automatic reconnection, exposing one piece of state the components can render from.  
* ☐ **T5.3 — Build the stage stepper.** Queued → Analyzing → Validating → Ready, with elapsed times pulled from the event log. It has to be able to reach a terminal failure state: a progress indicator that cannot fail is a lie, and a stepper that spins forever is worse than no stepper.  
* ☐ **T5.4 — Stream the summary in.** Render PARTIAL events typewriter-style as they arrive, treating the final parse as the source of truth.  
* ☐ **T5.5 — Subscribe from the list view.** One stream covering all non-terminal rows on the current page, updating badges in place, and no subscription opened at all when nothing on the page is pending.  
* ☐ **T5.6 — Add the polling fallback.** If EventSource is unavailable or the stream drops repeatedly, fall back to interval polling. Around twenty lines, and it is the difference between degraded and broken.  
* ☐ **T5.7 — Build the retry endpoint.** POST /api/intakes/\[id\]/enrich resets state, attempts, error and nextAttemptAt, clears any lease, and emits QUEUED so the stream shows the retry starting.  
* ☐ **T5.8 — Build the error banner.** The error message, the attempt count, and a retry button. This is the required user-visible error path, so treat it as a feature rather than a catch block.  
* ☐ **T5.9 — Build the fallback banner.** "AI unavailable, showing basic analysis" with the same retry affordance — degraded, clearly labelled, still useful.  
* ☐ **T5.10 — Guard against duplicate enqueues** for an intake already PENDING or PROCESSING, so an impatient double-click cannot queue the same work twice.

## **Phase 6 — Dashboard and CSV**

* ☐ **T6.1 — Build the dashboard.** Total intakes, counts by status, top tags via prisma.tag.groupBy, the enrichment failure count, and the share of results served by the fallback. That last number is the one that makes the reliability work visible.  
* ☐ **T6.2 — Render the bars with plain divs.** No chart library inside this scope; a width percentage and a label communicate everything needed here.  
* ☐ **T6.3 — Build the CSV endpoint.** GET /api/intakes/export.csv with correct escaping for commas, quotes and newlines inside descriptions, and a Content-Disposition filename so the download is named sensibly.  
* ☐ **T6.4 — Make the export ignore the current page and filters.** It exports everything. This is an easy bug to ship by accident and an obvious one to a reviewer who clicks export from page 2\.  
* ☐ **T6.5 — Add export buttons** to both the list view and the dashboard.

## **Phase 7 — Tests**

Vitest for the logic that would actually break, Playwright for the one path a user really takes. Everything runs against AI\_PROVIDER=mock, so the suite is deterministic and costs nothing to run.

* ☐ **T7.1 — Set up Vitest.** An npm test script and a temp SQLite database created through a DATABASE\_URL override in global setup, so tests never touch the development data.  
* ☐ **T7.2 — Test the guardrails.** Five tags collapse to three, duplicates dedupe, an empty summary is rejected, an oversized summary is clamped, and malformed JSON is rejected rather than stored.  
* ☐ **T7.3 — Test retry through the durable path.** A mock client that fails twice then succeeds: assert the row returns to PENDING with a future nextAttemptAt between attempts, and reaches READY with three attempts recorded.  
* ☐ **T7.4 — Test the fallback.** Every attempt fails, the fallback is applied, source reads FALLBACK, and the worker never throws.  
* ☐ **T7.5 — Test lease expiry.** A row stuck in PROCESSING with a lapsed leaseExpiresAt returns to PENDING when the sweep runs.  
* ☐ **T7.6 — Test the fencing token.** A reaped worker's late complete() is rejected because its token no longer matches. This is the highest-value test in the suite: it is the property most likely to be subtly wrong and the one whose failure would corrupt results silently.  
* ☐ **T7.7 — Test concurrent claims.** Two store instances claiming at the same time never return the same row twice.  
* ☐ **T7.8 — Test pagination boundaries.** Page 2 returns the remainder, a page past the end returns an empty array rather than a 404, and pageSize clamping holds.  
* ☐ **T7.9 — Test CSV escaping** with a description containing a comma, a quote and a newline, asserting it survives a round trip.  
* ☐ **T7.10 — Test the API surface.** A valid POST returns 201 and persists; an invalid one returns 400 with usable field errors.  
* ☐ **T7.11 — Set up Playwright.** Chromium only, a webServer configuration, a separate test database, and a worker started as part of the harness so the async path actually runs during tests.  
* ☐ **T7.12 — End-to-end happy path.** Create an intake, watch the stepper advance through its stages, and assert the summary and three tags render.  
* ☐ **T7.13 — End-to-end error path.** With FORCE\_AI\_FAILURE=1, assert the fallback banner appears, click retry, and assert recovery.  
* ☐ **T7.14 — End-to-end empty state and form validation,** covering both empty states and an invalid submission.  
* ☐ **T7.15 — End-to-end pagination.** Navigate to page 2, assert the URL carries ?page=2, and reload to prove it survives.  
* ☐ **T7.16 — Build the eval dump script.** npm run eval:dump writes evals/runs-\<timestamp\>.jsonl containing the intake fields, prompt version, raw output, source and latency for every enrichment — the artifact you will actually review prompt quality against afterwards.

## **Phase 8 — Docker**

* ☐ **T8.1 — Switch Next.js to standalone output** in next.config.ts, which is what keeps the runtime image small.  
* ☐ **T8.2 — Write a multi-stage Dockerfile.** Dependencies, then a build stage running prisma generate, then a slim runner. One image serves both roles; the web service and the worker service differ only in their command.  
* ☐ **T8.3 — Write the compose file.** A web service and a worker service with deploy.replicas: ${WORKER\_REPLICAS:-2}, both sharing the ./data:/app/data volume, with the WORKER\_\* variables passed through so parallelism is configurable without a rebuild.  
* ☐ **T8.4 — Add a one-shot migrate service** running prisma migrate deploy, which web and worker both depend on. Without it, several replicas can race the same migration on first boot.  
* ☐ **T8.5 — Keep Playwright out of the runtime image.** Its browser download roughly triples the image size for no runtime benefit; end-to-end tests run locally and in CI only.  
* ☐ **T8.6 — Verify a clean clone.** docker compose up on a machine with no local node\_modules and no existing database, which is the path a reviewer will actually take.  
* ☐ **T8.7 — Verify scale-up.** docker compose up \--scale worker=3, create ten intakes, and confirm all three replicas appear in lockedBy.  
* ☐ **T8.8 — Confirm WAL is active in the container.** After a run, data/ should hold dev.db, dev.db-wal and dev.db-shm. This matters much more now that several processes share the file.

## **Phase 9 — Submission**

Five artifacts are required. All five.

* ☐ **T9.1 — Write README.md.** Prerequisites, install steps, environment variables, the commands to run web and worker, and the local URL. Then a short product overview, the implemented flow from create through list to detail, how the AI feature behaves, which UX states exist, and a verification section covering the tests and how to run them.  
* ☐ **T9.2 — Write DECISIONS.md.** The plan in a few bullets, the key decisions and why, how you verified the thing works, the tradeoffs and what you deliberately skipped, what you learned, and what you would do with one more day. Dictating this is explicitly encouraged — short and concrete beats polished.  
* ☐ **T9.3 — Check repository hygiene.** A final commit with .env absent, .env.example present, and no database files or node\_modules tracked.  
* ☐ **T9.4 — Zip the repository including .git,** named \<FirstName\>\_\<LastName\>\_Tribe\_IntakeTriage.zip. Unzip it somewhere else and confirm the history came along.  
* ☐ **T9.5 — Assemble the submission.** The Loom link and the approximate total time spent, noting the overage explicitly, which the brief says is fine.  
* ☐ **T9.6 — Record the wrap-up** at the end of the same recording, covering product and UX, the system overview, reliability and verification, and tradeoffs with next steps.

## **Verification and demo moments**

Verification mindset is a scored criterion. Demonstrate these rather than describing them.

* ☐ Create an intake — watch the stepper advance live through Queued, Analyzing, Validating, Ready, with the summary streaming in  
* ☐ Empty state on a fresh database, and the filtered empty state with no matches  
* ☐ Submit an invalid form — inline validation, no request fired  
* ☐ FORCE\_AI\_FAILURE=1 — retries visible in the event log, fallback banner appears; unset it, hit Retry, watch it recover  
* ☐ Page through the list, confirm the URL carries ?page=2, reload to prove it is shareable  
* ☐ Download the CSV and open it, including a row with a comma in the description  
* ☐ npm test and npm run test:e2e green  
* ☐ docker compose up \--scale worker=3 from a clean clone  
* ☐ curl the API directly, and curl \-N the SSE endpoint to show raw frames arriving

**Three clips worth staging deliberately.**

1. **Crash recovery.** Create an intake and, while the stepper reads "Analyzing", SIGKILL the worker holding it. Another replica reaps the expired lease and the stepper resumes in the browser without a reload. Twenty seconds of footage that proves durability, distribution and the streaming layer all at once.  
2. **Parallelism.** Set WORKER\_CONCURRENCY=1 and create six intakes: they resolve one at a time. Raise it to 4, repeat, and watch them resolve together. Makes the configuration variable concrete rather than asserted.  
3. **Raw SSE.** curl \-N http://localhost:3000/api/stream?intakeId=… in a terminal beside the browser, so the frames and the UI update side by side. This answers "how does the frontend talk to the backend" better than any diagram.

## **Tradeoffs to name out loud**

"What you intentionally did not do" is its own section of the wrap-up. Naming limits precisely reads as judgment; discovering them under questioning does not.

* **SQLite caps the distribution at one host.** The protocol is correct — leases, fencing, no coordinator — but the storage is single-writer and workers must share a filesystem. The Postgres adapter lifts the ceiling; shipping SQLite by default was a deliberate choice to stay inside the brief's stack.  
* **SSE is one-directional and the server still tails a table.** A broker or LISTEN/NOTIFY would be less work per event. At this scale the 250ms tail is cheaper than the dependency.  
* **Optimistic partial parsing of streamed JSON is best-effort.** The final parse is authoritative; a mid-stream summary can briefly render truncated.  
* **No auth, no multi-tenancy, no rate limiting.** An internal-tool assumption, made explicit.  
* **Offset pagination, not cursor.** Fine at this scale, drifts under heavy concurrent inserts.  
* **Prompt quality is instrumented but not yet evaluated.** Every call stores its prompt version, raw response and latency, and eval:dump exports them — the judgment call is that a scoring harness is worth building only once there is real output to score against. That review happens after the build.  
* **Playwright covers four paths, not the matrix.** Chosen for the paths a reviewer will actually click.

## **Cut list**

This is more than the brief's 2–3 hour expectation asks for, which is a deliberate choice rather than an accident. The brief permits going over provided the recording runs throughout and the total is declared at submission, so note the actual elapsed time when you submit rather than estimating up front. Worth saying in the wrap-up *why* you overshot: the distributed queue and the streaming layer are the parts of this build that are actually interesting, and both were chosen rather than stumbled into.

**If running long, cut in this order:**

1. Postgres adapter (T2.10) and token streaming (T3.4) — both explicitly optional; the stepper alone already reads as streaming  
2. Status filter chips (T4.9) and the LLM priority field (T3.11)  
3. Playwright down to T7.12 and T7.13 only, keeping the happy path and the error path  
4. Dashboard visuals, keeping the raw counts and the CSV export

**Do not cut:** the lease sweep and the fencing token, or the queue stops being distributed in any meaningful sense and the best demo clip goes with them. The polling fallback, which is the cheap insurance that stops a failed EventSource from looking like a frozen app. The error and fallback banners, since a visible error path is a core requirement rather than a bonus. The AI\_PROVIDER=mock provider, without which the Playwright suite is slow, costly and flaky. And the README and DECISIONS.md — two of the five required artifacts, and the cheapest marks on the sheet.

**Commit as you go.** The .git folder ships with the zip, so the commit history is itself part of the submission and shows how the build was sequenced.