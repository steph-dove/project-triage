# Intake Triage — build checklist

Internal tool that triages inbound project requests. One end-to-end slice: Next.js 15 (App
Router, TS, Tailwind), Route Handlers under `/api`, Prisma + SQLite, an OpenAI enrichment step
run by standalone worker processes leasing jobs from the database, and an append-only event log
streamed to the browser over SSE.

Source of truth: "Tribe AI Exercise 3 — Intake Triage Implementation Plan" (docx). This file is
the resumable checklist — work unchecked boxes top to bottom.

## Decisions (carried from the plan doc, not re-litigated)
- Framework: Next.js 15 App Router, Route Handlers (not Server Actions) so the API is curl-able.
- DB: Prisma + SQLite at `./data/dev.db`; queue written against a `JobStore` interface so the
  Postgres adapter is an opt-in compose profile rather than a rewrite.
- Queue: no broker. The `Enrichment` row is the job record; CAS claim, lease + heartbeat,
  fencing token, expired-lease sweep.
- Realtime: SSE tailing the `Event` table, `seq` doubles as the `Last-Event-ID` resume cursor.
- AI: `gpt-4o-mini`, `response_format: json_schema`, streamed; Zod re-validates on the way in.
- Triage status (NEW / IN_REVIEW / ACCEPTED / DECLINED) on every intake — without it this is a
  list with summaries, not a triage tool.

## Phase 0 — Setup
- [x] T0.1 Scaffold Next.js 15 + TS + Tailwind + App Router; commit before writing anything else
- [x] T0.2 Install deps: prisma, @prisma/client, zod, openai, vitest
- [x] T0.3 Prisma schema (Intake, Enrichment, Tag, Event) + first migration, committed
- [x] T0.4 Seed 14 sample intakes, varied industry/budget/status
- [x] T0.5 `lib/db.ts` Prisma singleton with `journal_mode=WAL` and `busy_timeout=5000`
- [x] T0.6 `.env.example` (OPENAI_API_KEY, DATABASE_URL); gitignore `.env` and `data/*.db*`

## Phase 1 — API and persistence
- [x] T1.1 `lib/schemas.ts` — `CreateIntakeSchema`, shared by form and route handler
- [x] T1.2 `POST /api/intakes` — validate, create intake + PENDING enrichment in one transaction, 201
- [x] T1.3 `GET /api/intakes` — page/pageSize/status, pageSize clamped to 50
- [x] T1.4 `GET /api/intakes/[id]` — tags, risks, enrichment state, attempts, error
- [x] T1.5 `PATCH /api/intakes/[id]` — status only, emits STATUS_CHANGED
- [x] T1.6 Verify all five endpoints with curl, including the invalid-body case
- [x] T1.7 Ugly slice — unstyled list + form on the real endpoints

## Phase 2 — Distributed queue
- [x] T2.1 `JobStore` interface: claim, heartbeat, complete, fail, reap, subscribe
- [x] T2.2 SQLite adapter — CAS claim, lease extension, fenced terminal writes, sweep
- [x] T2.3 `lib/queue/config.ts` — validate the six WORKER_* vars, fail loudly
- [x] T2.4 Worker loop — claim, heartbeat, SIGTERM drain + lease release
- [x] T2.5 `emit(intakeId, type, payload)` event emitter
- [x] T2.6 Worker entrypoint (`npm run worker`) + `WORKER_IN_PROCESS` dev path; no Next imports under lib/queue
- [x] T2.7 Stub processor — sleep, full event sequence, canned result
- [x] T2.8 Verify distribution: 2 workers x concurrency 2 over 6 intakes, check lockedBy
- [x] T2.9 Verify crash recovery: SIGKILL mid-job, other worker reaps
- [ ] T2.10 Optional: Postgres adapter (FOR UPDATE SKIP LOCKED) + compose profile

## Phase 3 — AI pipeline
- [x] T3.1 Output contract: JSON schema + matching Zod (summary, exactly 3 tags, risks, priority?)
- [x] T3.2 Prompt + exported `PROMPT_VERSION`
- [x] T3.3 OpenAI client — json_schema, stream, AbortController timeout
- [x] T3.4 Optional: throttled PARTIAL summary events (~1/300ms)
- [x] T3.5 Guardrails — 3 tags kebab-cased and deduped, summary clamped, <=5 risks, markdown stripped
- [x] T3.6 Heuristic fallback, marked `source: FALLBACK`
- [x] T3.7 Persist rawResponse, promptVersion, latencyMs, tokensIn, tokensOut
- [x] T3.8 Wire into worker; classify retriable (timeout/5xx/parse) vs terminal (4xx/auth)
- [x] T3.9 `AI_PROVIDER=mock` provider for deterministic e2e
- [x] T3.10 `FORCE_AI_FAILURE=1` switch
- [ ] T3.11 Optional: model-proposed priority HIGH/MEDIUM/LOW (skipped, needs a migration)

## Phase 4 — Frontend
- [x] T4.1 App shell — nav, layout, base styling
- [x] T4.2 List view — cards with status badge, tag chips, relative time; page/status from searchParams
- [x] T4.3 Pagination controls with correct disabled ends
- [x] T4.4 Two distinct empty states (no intakes / no matches)
- [x] T4.5 Loading skeletons sized to real content
- [x] T4.6 Create form — inline Zod validation, disabled submitting, redirect to detail
- [x] T4.7 Detail view — fields, summary, tags, risk checklist, status buttons
- [x] T4.8 Pending "Analyzing…" treatment on list and detail
- [x] T4.9 Optional: status filter chips

## Phase 5 — Streaming, retry, error UX
- [x] T5.1 `GET /api/stream` — 250ms tail, `id: <seq>`, Last-Event-ID resume, 15s heartbeat, cleanup
- [x] T5.2 `useIntakeStream` — EventSource + reducer + reconnect
- [x] T5.3 Stage stepper with elapsed times, and a reachable terminal failure state
- [x] T5.4 Typewriter the streamed summary; final parse is authoritative
- [x] T5.5 List view subscribes once for non-terminal rows; no subscription when nothing is pending
- [x] T5.6 Polling fallback when EventSource fails
- [x] T5.7 `POST /api/intakes/[id]/enrich` — reset state/attempts/error/lease, emit QUEUED
- [x] T5.8 Error banner — message, attempt count, retry
- [x] T5.9 Fallback banner — "AI unavailable, showing basic analysis" + retry
- [x] T5.10 Guard duplicate enqueues for PENDING/PROCESSING rows

## Phase 6 — Dashboard and CSV
- [x] T6.1 Dashboard — totals, counts by status, top tags via groupBy, failures, fallback share
- [x] T6.2 Bars as plain divs, no chart library
- [x] T6.3 `GET /api/intakes/export.csv` — escape commas/quotes/newlines, Content-Disposition
- [x] T6.4 Export ignores page and filters
- [x] T6.5 Export buttons on list and dashboard

## Phase 7 — Tests
- [x] T7.1 Vitest setup with a temp DB via DATABASE_URL override
- [x] T7.2 Guardrail tests (tag collapse, dedupe, empty/oversized summary, malformed JSON)
- [x] T7.3 Retry through the durable path (fail twice then succeed)
- [x] T7.4 Fallback applied after exhaustion; worker never throws
- [x] T7.5 Lease expiry returns the row to PENDING
- [x] T7.6 Fencing token rejects a reaped worker's late complete()
- [x] T7.7 Concurrent claims never hand out the same row twice
- [x] T7.8 Pagination boundaries and pageSize clamping
- [x] T7.9 CSV escaping round trip
- [x] T7.10 API surface: 201 + persisted, 400 with field errors
- [x] T7.11 Playwright setup — chromium, webServer, separate DB, worker in the harness
- [x] T7.12 E2E happy path
- [x] T7.13 E2E error path with FORCE_AI_FAILURE, then retry recovery
- [x] T7.14 E2E empty states + form validation
- [x] T7.15 E2E pagination, URL carries ?page=2 and survives reload
- [x] T7.16 `npm run eval:dump` -> evals/runs-<timestamp>.jsonl

## Phase 8 — Docker
- [x] T8.1 `output: 'standalone'` in next.config.ts
- [x] T8.2 Multi-stage Dockerfile; one image, web and worker differ only in command
- [x] T8.3 compose with `deploy.replicas: ${WORKER_REPLICAS:-2}` and a shared ./data volume
- [x] T8.4 One-shot migrate service (`prisma migrate deploy`) that web and worker depend on
- [x] T8.5 Keep Playwright out of the runtime image
- [x] T8.6 Verify a clean clone with `docker compose up`
- [x] T8.7 Verify `--scale worker=3` shows three replicas in lockedBy (lockedBy clears on completion; checked via CLAIMED workerId, PR #7)
- [x] T8.8 Confirm WAL active: dev.db, dev.db-wal, dev.db-shm

## Phase 9 — Submission
- [x] T9.1 README.md — setup, env, run commands, product overview, UX states, verification
- [x] T9.2 DECISIONS.md — plan, decisions, verification, tradeoffs, learnings, next day
- [ ] T9.3 Repo hygiene — .env absent, .env.example present, no db files or node_modules tracked
- [ ] T9.4 Zip including .git as `<First>_<Last>_Tribe_IntakeTriage.zip`; verify history survives
- [ ] T9.5 Assemble submission with Loom link and declared total time
- [ ] T9.6 Record the wrap-up on the end of the same recording

## Out of scope
- Auth, multi-tenancy, rate limiting — internal-tool assumption, stated explicitly.
- Cursor pagination (offset is fine at this scale).
- A prompt scoring harness. Calls are instrumented and `eval:dump` exports them; scoring happens
  after the build, against real output.

## Cut list, in order
Postgres adapter (T2.10) and token streaming (T3.4); status filter chips (T4.9) and LLM priority
(T3.11); Playwright down to T7.12 + T7.13; dashboard visuals, keeping counts and CSV.

Do not cut: the lease sweep and fencing token, the polling fallback, the error and fallback
banners, the mock AI provider, README and DECISIONS.md.

## Verification
- Demo moments: live stepper, both empty states, invalid form, FORCE_AI_FAILURE then retry,
  shareable ?page=2, CSV with a comma in a description, `npm test` and e2e green,
  `docker compose up --scale worker=3` from a clean clone, raw `curl -N` on the SSE endpoint.
- Staged clips: crash recovery mid-analysis, concurrency 1 vs 4, raw SSE beside the browser.
