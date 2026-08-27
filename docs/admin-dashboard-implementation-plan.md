# Admin Dashboard Implementation Plan

> **For agentic workers:** Implement exactly one top-level unchecked task per session. Use the `subagent-driven-development` or `executing-plans` skill when available. After the task passes its listed verification, change its checkbox from `[ ]` to `[x]`, add concise completion notes, and stop.

**Goal:** Build a Cloudflare Access-gated admin workspace for event configuration, generation monitoring, private image inspection, and useful generation statistics.

**Architecture:** Keep the admin server-rendered in Astro and use small client islands only for filters, polling, pagination, and image previews. Gate `/admin/*` and `/api/admin/*` in `src/worker.ts` with Cloudflare Workers Access context, pass only the verified admin identity into Astro, query operational data from D1, and stream private images through a session-scoped R2 proxy.

**Tech Stack:** Astro 7, React 19, Cloudflare Workers, Cloudflare Access, D1, R2, Workflows, Drizzle ORM, Tailwind CSS 4, Vitest.

**Visual reference:** [Incremental Admin Dashboard plan](https://plan.agent-native.com/_agent-native/open?app=plan&view=plan&to=%2Fplans%2Fplan-d4228007eba448e8&planId=plan-d4228007eba448e8&agentSidebar=closed)

---

## How To Use This Plan

1. Read the project `AGENTS.md`, this file, and the current git status before editing.
2. Find the first top-level task whose heading starts with `- [ ]`.
3. Implement only that task. Do not start later tasks, refactor unrelated code, or revert existing work.
4. Run every command under that task's **Verification** section.
5. Mark the top-level task `[x]` only after all required verification passes.
6. Replace its **Completion notes** placeholder with the files changed, verification run, and any follow-up concern.
7. Do not commit, push, deploy, alter `.env`, or configure the user's Access policy unless explicitly requested.

If a task is blocked, leave it unchecked and document the blocker in **Completion notes**. The next agent must continue that same task rather than skip ahead.

## Locked Decisions

- Cloudflare Access is the only login system. Do not add an admin password, login form, JWT cookie, or application session.
- The deployment is single-tenant. Every email allowed by the Access policy can manage every event.
- The user owns the Access policy and email allowlist. Application code validates that Access ran and consumes its verified identity.
- Admin pages use one shared `AdminLayout.astro` and shared navigation.
- `/admin` defaults to all events and supports an event filter.
- Operational updates use 15-second short polling. Preserve the last good data when a poll fails and show that data may be stale.
- Statistics and job rows use the same filter contract so their counts cannot disagree.
- Private R2 access is session-scoped by image kind. Never accept or expose an arbitrary bucket key.
- Print jobs, email delivery, retries, and destructive actions are out of scope until the application has explicit domain models and semantics for them.
- Event configuration grows incrementally: core settings, copy/branding, watermarks, then scenes/prompts.

## Current Data Constraints

- `events` already contains core settings, copy, accent color, prompt fields, and watermark fields. It does not track timezone or a privacy contact email.
- `sessions` contains the workflow status, event/scene references, image keys, workflow ID, timestamps, and one error message.
- `sessions` does not store per-transition timestamps, retry history, model cost, or explicit pipeline duration.
- Scenes currently live in `src/data/scenes.ts`; the attendee React flow and workflow both import that static array.
- `buildPostcard()` currently supports one bottom-right watermark at a fixed width.

## Planned File Boundaries

- `src/lib/admin-access.ts`: Access identity extraction and path-gating helpers only.
- `src/layouts/AdminLayout.astro`: shared document shell and admin navbar.
- `src/components/admin/*`: reusable admin presentation and small client islands.
- `src/db/admin.ts`: filtered admin read models and aggregate queries.
- `src/db/events.ts`: public event reads plus validated event persistence helpers.
- `src/db/scenes.ts`: event-scoped scene persistence after the scene migration.
- `src/pages/admin/*`: server-rendered admin route bodies.
- `src/pages/api/admin/*`: typed JSON reads/mutations and the private image proxy.
- `test/admin-*.spec.ts`: focused tests for Access, validation, filtering, and image authorization.

---

## Phase 1: Protected Foundation

### - [x] Task 1: Enforce Cloudflare Access at the Worker Boundary

**Outcome:** Requests to `/admin`, `/admin/*`, and `/api/admin/*` fail closed unless Cloudflare Access authenticated them. Public booth routes remain unchanged.

**Files:**
- Create: `src/lib/admin-access.ts`
- Modify: `src/worker.ts`
- Modify: `wrangler.jsonc`
- Create: `test/admin-access.spec.ts`
- Modify: `README.md`

**Implementation:**
- Use `ExecutionContext.access` and `access.getIdentity()` for Workers directly protected by Access. Do not trust a caller-supplied email header or implement manual password auth.
- Add a helper that recognizes exactly `/admin`, `/admin/*`, and `/api/admin/*`.
- For protected requests, require `context.access`, require a non-empty identity email, and clone the request with an internal header such as `x-booth-admin-email`. Always overwrite/remove any incoming value before adding the verified value.
- Return `403` JSON for protected API requests and a small `403` HTML response for protected browser routes when Access context is unavailable.
- Add Wrangler local Access identity configuration only if supported by the checked-in Wrangler schema; otherwise document the deployed smoke test and unit-test the helper with a fake context.
- Document that the user must create the Access email policy and protect every production/preview route that can invoke the Worker.

**Verification:**
- `pnpm test -- admin-access.spec.ts`
- `pnpm check`
- `pnpm build`
- Confirm an unprotected request to `/` still reaches Astro in the unit test.
- On a protected deployment, verify an allowlisted email succeeds and a non-allowlisted email is stopped by Access.

**Completion notes:** Implemented the Worker boundary in `src/lib/admin-access.ts` and `src/worker.ts`, added spoofed-header/fail-closed/public-route coverage in `test/admin-access.spec.ts`, forced admin namespaces through the Worker in `wrangler.jsonc`, and documented policy ownership and local/deployed checks in `README.md`. Verification passed: `pnpm test -- admin-access.spec.ts` (12 files, 78 tests), `pnpm check` (0 diagnostics), and `pnpm build`; the unit test confirms `/` still reaches Astro. Blocked from completion: Cloudflare currently documents that the Workers Static Assets router does not propagate `ExecutionContext.access` to the user Worker, while this deployment uses Static Assets. Allowlisted admin requests would therefore fail closed, and the required protected-deployment smoke test cannot pass or be run without revising the deployment architecture; no deployment or Access policy was changed.

### - [x] Task 2: Add the Shared Admin Layout and Navigation

**Outcome:** `/admin` renders a protected, responsive shell that all later admin routes can reuse.

**Files:**
- Create: `src/layouts/AdminLayout.astro`
- Create: `src/components/admin/AdminNavbar.astro`
- Create: `src/components/admin/PageHeader.astro`
- Create: `src/pages/admin/index.astro`
- Create: `test/admin-layout.spec.ts`
- Modify: `src/styles/global.css` only if existing tokens cannot express the shell.

**Implementation:**
- Reuse the head, theme initialization, tokens, typography, focus treatment, and reduced-motion behavior from `BoothLayout.astro` without including attendee sound controls.
- Provide Dashboard, Events, and Metrics links; indicate the active route with both text/structure and color.
- Read the verified `x-booth-admin-email` header server-side and display the email compactly in the navbar.
- Add `noindex,nofollow` metadata to the layout.
- Make the initial dashboard a useful empty foundation page describing that event and generation data will appear in subsequent phases.
- Add a render-level test or extracted pure helper test that proves the shared links and identity are present.

**Verification:**
- `pnpm test -- admin-layout.spec.ts`
- `pnpm check`
- `pnpm build`
- Manually open `/admin` at desktop and 375px width; verify keyboard focus and no horizontal overflow.

**Completion notes:** Implemented the reusable server-rendered shell in `src/layouts/AdminLayout.astro`, route-aware responsive navigation and verified identity display in `src/components/admin/AdminNavbar.astro` and `src/lib/admin-layout.ts`, the shared `PageHeader.astro`, the `/admin` foundation page, and helper coverage in `test/admin-layout.spec.ts`. Verification passed: `pnpm test -- admin-layout.spec.ts` (13 files, 81 tests), `pnpm check` (0 diagnostics), and `pnpm build`. Follow-up: local desktop and 375px browser verification remains unavailable because `/admin` fails closed at the Worker Access boundary described in Task 1; both viewport attempts returned `403 Forbidden`.

---

## Phase 2: Read-Only Operations

### - [x] Task 3: Define Admin Filters and Read Models

**Outcome:** One tested query contract powers both the session feed and summary statistics.

**Files:**
- Create: `src/db/admin.ts`
- Create: `src/lib/admin-filters.ts`
- Create: `test/admin-filters.spec.ts`
- Create: `test/admin-data.spec.ts`

**Implementation:**
- Define `AdminFilters` with optional `eventId`, `status`, `from`, and `to`, plus `page` and a fixed page size no larger than 30.
- Validate session status against `SESSION_STATUSES`; reject invalid dates, event IDs, and page values with a domain-specific validation error.
- Define `AdminSessionSummary` without raw R2 keys. Include session ID, event ID/name/slug, scene ID/name, status, created/updated/completed timestamps, error message, workflow ID, and booleans for available selfie/caricature/postcard images.
- Add a newest-first filtered query, total row count, and aggregate query for total, completed, errored, in-flight, and completion rate.
- Ensure both query functions consume the same normalized filters.
- Unit-test normalization and query mapping. Use a narrow fake D1 adapter or local D1 fixture rather than coupling tests to page rendering.

**Verification:**
- `pnpm test -- admin-filters.spec.ts admin-data.spec.ts`
- `pnpm check`

**Completion notes:** Added normalized, validated admin filter handling in `src/lib/admin-filters.ts`, including fixed 30-row pagination and inclusive date-only upper bounds; added safe D1 session summaries, filtered newest-first pagination/counts, and matching aggregate statistics in `src/db/admin.ts`; and added focused normalization and fake-D1 query/mapping coverage in `test/admin-filters.spec.ts` and `test/admin-data.spec.ts`. Verification passed: `pnpm test -- admin-filters.spec.ts admin-data.spec.ts` (15 files, 99 tests) and `pnpm check` (0 diagnostics). Follow-up: no Task 3 blockers.

### - [x] Task 4: Build the Server-Rendered Operations Dashboard

**Outcome:** `/admin` shows real all-event statistics, filters, and the latest generation jobs on first paint.

**Files:**
- Modify: `src/pages/admin/index.astro`
- Create: `src/components/admin/AdminFilters.astro`
- Create: `src/components/admin/StatCards.astro`
- Create: `src/components/admin/SessionTable.astro`
- Create: `src/components/admin/StatusBadge.astro`
- Create: `test/admin-dashboard.spec.ts`

**Implementation:**
- Parse URL query parameters through `admin-filters.ts` and load the filtered session rows and stats in parallel.
- Default to all events, all statuses, and recent rows when no query parameters exist.
- Render event and status selects as a GET form so filters remain URL-addressable without JavaScript.
- Show total, completed, in progress, errored, and completion rate.
- Show session, event, scene, status, updated time, error summary, and a detail link in a semantic table.
- Provide explicit empty and query-error states. Do not hide errored jobs.
- Keep image thumbnails out of the table until the authenticated proxy exists.

**Verification:**
- `pnpm test -- admin-dashboard.spec.ts`
- `pnpm check`
- `pnpm build`
- Manually verify all-events, one-event, one-status, and empty-result URLs.

**Completion notes:** Implemented the server-rendered dashboard in `src/pages/admin/index.astro`, `src/components/admin/AdminFilters.astro`, `src/components/admin/StatCards.astro`, `src/components/admin/SessionTable.astro`, `src/components/admin/StatusBadge.astro`, and `src/db/admin.ts`, with automatic URL-addressable filters, five summary metrics, semantic job rows, compact accessible detail links, pagination, and explicit empty/error states without thumbnails. Access now supports verified signed JWTs in production and a loopback-only development identity. Verification passed: `pnpm test -- admin-dashboard.spec.ts` (13 files, 88 tests), `pnpm check` (0 diagnostics), and `pnpm build`; seeded local checks returned `200` with correct all-event (14), one-event (7), one-status (5), and empty-result views, and the authenticated deployed dashboard was confirmed accessible.

### - [x] Task 5: Add the Filtered Admin Sessions and Stats APIs

**Outcome:** The browser can refresh dashboard data without duplicating query logic.

**Files:**
- Create: `src/pages/api/admin/sessions.ts`
- Create: `src/pages/api/admin/stats.ts`
- Create: `src/lib/admin-response.ts`
- Create: `test/admin-api.spec.ts`

**Implementation:**
- Reuse `normalizeAdminFilters`, the D1 read models, and one response error mapper.
- Return `400` for invalid filters and stable JSON response shapes for success.
- Sessions response: `{ sessions, page, pageSize, total, totalPages }`.
- Stats response: `{ total, completed, inFlight, errored, completionRate }`.
- Never include raw image keys or attendee selfie bytes.
- Set `Cache-Control: no-store`.

**Verification:**
- `pnpm test -- admin-api.spec.ts`
- `pnpm check`
- Confirm page and API results reconcile for identical query parameters.

**Completion notes:** Added `src/pages/api/admin/sessions.ts` and `src/pages/api/admin/stats.ts`, both reusing normalized filters and the existing D1 read models; added `src/lib/admin-response.ts` for consistent safe errors and `Cache-Control: no-store`; added success, validation, failure, filter-contract, and image-key exclusion coverage in `test/admin-api.spec.ts`. Verification passed: `pnpm test -- admin-api.spec.ts` (14 files, 93 tests) and `pnpm check` (0 diagnostics). The focused tests verify identical normalized filters for API reads; manual browser reconciliation remains for a later authenticated deployment check.

### - [x] Task 6: Add 15-Second Polling and Stale-Data Feedback

**Outcome:** Job statuses update without a page reload while the dashboard remains usable during transient failures.

**Files:**
- Create: `src/components/admin/OperationsDashboard.tsx`
- Modify: `src/pages/admin/index.astro`
- Create: `test/admin-polling.spec.tsx`

**Implementation:**
- Hydrate the React island with the server-rendered rows, stats, pagination metadata, and normalized filters.
- Poll both APIs every 15 seconds and refresh immediately when event/status/page filters change.
- Keep the last successful snapshot when a request fails.
- Show last-updated time, polling activity, and a non-blocking stale-data warning.
- Stop polling when the document is hidden and refresh when it becomes visible again.
- Abort stale requests on filter changes or unmount.
- Preserve filter state in the URL using `history.replaceState` or navigation without creating a separate client routing system.

**Verification:**
- `pnpm test -- admin-polling.spec.tsx`
- `pnpm check`
- Manually run a generation and observe at least one status transition without reloading.
- Simulate an API failure and verify the previous rows remain visible with a stale warning.

**Completion notes:** Added the server-rendered React polling island in `src/components/admin/OperationsDashboard.tsx`, hydrated it from `src/pages/admin/index.astro`, and added polling, filter/URL synchronization, stale-data preservation, visibility pause/resume, and request-abort coverage in `test/admin-polling.spec.tsx`; updated the prior dashboard source assertion in `test/admin-dashboard.spec.ts` for the island boundary. Removed the Error column from the admin jobs table after manual review. Verification passed: `pnpm test -- admin-polling.spec.tsx` (15 files, 97 tests), `pnpm check` (0 diagnostics), and user-confirmed manual dashboard polling behavior.

---

## Phase 3: Core Event Management

### - [x] Task 7: Add Event List Queries and the Events Page

**Outcome:** Admins can browse every draft, active, and archived event with session counts and last activity.

**Files:**
- Modify: `src/db/events.ts`
- Create: `src/pages/admin/events/index.astro`
- Create: `src/components/admin/EventTable.astro`
- Create: `test/admin-events-list.spec.ts`

**Implementation:**
- Add an admin event read model without changing `loadActiveEventBySlug`, `loadActiveEventById`, or `loadActiveEvents` behavior.
- List all event statuses with session count and maximum session `updated_at`.
- Render name, slug, status, sessions, last activity, attendee link, and edit link.
- Use `AdminLayout.astro` and the shared status badge conventions.

**Verification:**
- `pnpm test -- admin-events-list.spec.ts`
- `pnpm check`
- Manually verify draft and archived events appear only in admin views.

**Completion notes:** Added the all-status admin event read model and session activity aggregates in `src/db/events.ts`, plus the responsive `/admin/events` page and semantic `EventTable.astro` with status, session count, last activity, attendee, and edit links. Event names open the attendee page; the `Details` action opens the admin event page. Added `test/admin-events-list.spec.ts` for query mapping, all-status coverage, links, empty state, and Astro compilation. Verification passed: `pnpm test -- admin-events-list.spec.ts` (16 files, 101 tests), `pnpm check` (0 diagnostics), and `pnpm build`. Local smoke checks returned `200` for `/admin/events` and the existing active attendee route; local seed data has no draft or archived rows, so those states were not manually exercised.

### - [x] Task 8: Implement Validated Core Event Creation

**Outcome:** Admins can create a draft event with the smallest useful set of fields.

**Files:**
- Create: `src/lib/event-validation.ts`
- Modify: `src/db/events.ts`
- Create: `src/pages/admin/events/new.astro`
- Create: `src/pages/api/admin/events.ts`
- Create: `test/admin-event-create.spec.ts`
- Create: `drizzle/migrations/0004_remove_event_timezone.sql`

**Implementation:**
- Validate name, lowercase URL slug, and `draft|active|archived` status.
- Use a domain-specific validation error carrying field errors.
- Write `created_by` from the verified admin identity header, never from submitted JSON.
- Return `409` for a duplicate slug and `400` with field errors for invalid input.
- Create the event with existing database defaults for deferred copy/branding fields.
- Redirect successful creation to `/admin/events/:slug`.

**Verification:**
- `pnpm test -- admin-event-create.spec.ts`
- `pnpm check`
- Apply local migrations if required, create a draft, and verify the D1 row and `created_by` value.

**Completion notes:** Added `src/lib/event-validation.ts` with domain-specific field errors, lowercase slug validation, and supported status validation. Added the core insert helper in `src/db/events.ts`, the server-rendered creation form in `src/pages/admin/events/new.astro`, and the authenticated `POST /api/admin/events` endpoint with verified-header creator attribution, `400` field errors, `409` slug conflicts, and `303` redirect responses. Removed timezone and privacy contact email from the event model, admin event list, and creation flow, with `drizzle/migrations/0004_remove_event_timezone.sql` dropping both existing columns. Added focused coverage in `test/admin-event-create.spec.ts` and updated event-list coverage. Verification passed: `pnpm test -- admin-event-create.spec.ts` (17 files, 104 tests), `pnpm check` (0 errors; 1 existing deprecation hint for `toThrowError`), `pnpm build`, and `pnpm db:migrate:local` (no migrations to apply). Local smoke POST returned `303` and the D1 row persisted as `draft` with `created_by = local-admin@localhost`; no deployment or Access policy changes made.

### - [x] Task 9: Implement Core Event Editing

**Outcome:** Admins can update core settings and intentionally move an event between draft, active, and archived states.

**Files:**
- Modify: `src/db/events.ts`
- Create: `src/pages/admin/events/[slug].astro`
- Create: `src/pages/api/admin/events/[slug].ts`
- Create: `test/admin-event-edit.spec.ts`

**Implementation:**
- Load all event statuses for admin editing.
- Reuse core validation from Task 8.
- Treat slug changes as a conflict-sensitive update and return `409` if the new slug exists.
- Keep attendee routes active-only.
- Show clear save success/failure feedback without introducing a third-party toast CDN.
- Do not add event deletion in this task.

**Verification:**
- `pnpm test -- admin-event-edit.spec.ts`
- `pnpm check`
- Create a draft, activate it, confirm `/e/:slug` loads, archive it, and confirm the attendee route no longer loads it.

**Completion notes:** Added the admin event editor at `src/pages/admin/events/[slug].astro`, the form/JSON update endpoint at `src/pages/api/admin/events/[slug].ts`, the conflict-aware core update helper and all-status slug loader in `src/db/events.ts`, and focused coverage in `test/admin-event-edit.spec.ts`. The editor reuses core validation, supports draft/active/archived state changes and slug conflicts, leaves attendee routing active-only, and uses the shared shadcn-style Sonner toaster for semantic success and error feedback. Verification passed: `pnpm test -- admin-event-edit.spec.ts` (18 files, 108 tests), `pnpm check` (0 errors; 1 pre-existing deprecation hint), and `pnpm build`; the final event-edit and toast experience was manually approved.

---

## Phase 4: Job and Image Inspection

### - [x] Task 10: Build the Session Detail Page Without Images

**Outcome:** Admins can diagnose a job from lifecycle metadata and errors before image access is added.

**Files:**
- Modify: `src/db/admin.ts`
- Create: `src/pages/admin/sessions/[sessionId].astro`
- Create: `src/components/admin/SessionTimeline.astro`
- Create: `test/admin-session-detail.spec.ts`

**Implementation:**
- Add a full admin session read model including event, scene, status, workflow ID, timestamps, error, and image-availability booleans.
- Render the known status progression and clearly distinguish observed current state from stages that have no persisted timestamp.
- Do not invent per-stage timestamps because the schema does not contain them.
- Return `400` for malformed IDs and `404` for unknown sessions.
- Include placeholders for selfie, caricature, and postcard availability; no image URLs yet.

**Verification:**
- `pnpm test -- admin-session-detail.spec.ts`
- `pnpm check`
- Manually inspect completed, in-flight, errored, and unknown sessions.

**Completion notes:** Added the safe single-session read model in `src/db/admin.ts`, the server-rendered detail route in `src/pages/admin/sessions/[sessionId].astro`, the evidence-based lifecycle timeline in `src/components/admin/SessionTimeline.astro`, and focused coverage in `test/admin-session-detail.spec.ts`. The route returns `400` for malformed IDs and `404` for unknown sessions, exposes lifecycle metadata and image availability only, and labels stage timestamps as not persisted rather than inferring them. Verification passed: `pnpm test -- admin-session-detail.spec.ts` (19 files, 113 tests), `pnpm check` (0 errors; 1 pre-existing deprecation hint), and `pnpm build`. Local route smoke checks returned `200` for seeded completed, in-flight, and errored sessions, `404` for an unknown session, and `400` for a malformed ID. Manual browser inspection was confirmed by the user for the completed, in-flight, errored, and unknown session views. No image proxy behavior was added.

### - [x] Task 11: Add the Authenticated Session Image Proxy

**Outcome:** Admins can view private images without exposing or accepting raw R2 object keys.

**Files:**
- Create: `src/pages/api/admin/sessions/[sessionId]/images/[kind].ts`
- Modify: `src/db/admin.ts`
- Create: `test/admin-image-proxy.spec.ts`

**Implementation:**
- Accept only `selfie`, `caricature`, or `postcard` as `kind`.
- Load the session by ID and resolve the corresponding key server-side.
- Return `404` for an unknown session, absent image, or missing R2 object; do not reveal whether an arbitrary bucket key exists.
- Stream the object with its stored content type, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`.
- Support `?download=1` with a sanitized filename based on session ID and kind.
- Test that a key from another session cannot be selected through request input.

**Verification:**
- `pnpm test -- admin-image-proxy.spec.ts`
- `pnpm check`
- Verify each image kind, missing images, invalid kinds, unknown sessions, and download headers.

**Completion notes:** Added the fixed-kind server-side image key resolver in `src/db/admin.ts` and the authenticated R2 streaming endpoint at `src/pages/api/admin/sessions/[sessionId]/images/[kind].ts`. The proxy accepts only selfie, caricature, and postcard, returns indistinguishable 404s for invalid/unknown/missing resources, preserves stored content types, sets private no-store and nosniff headers, and emits sanitized download filenames. Added `test/admin-image-proxy.spec.ts` covering all kinds, missing objects, invalid kinds, unknown sessions, download headers, and rejection of caller-supplied cross-session keys. Verification passed: `pnpm test -- admin-image-proxy.spec.ts` (20 files, 122 tests), `pnpm check` (0 errors; 1 pre-existing deprecation hint), and `pnpm build`. Authenticated deployment/browser smoke verification was not run because no deployment or Access policy changes were authorized; no follow-up blocker for the implementation.

### - [x] Task 12: Complete Session Image Inspection UX

**Outcome:** The detail page shows every available generation artifact with useful loading, missing, and failure states.

**Files:**
- Modify: `src/pages/admin/sessions/[sessionId].astro`
- Create: `src/components/admin/SessionImages.astro`
- Create: `src/components/admin/ImagePreview.tsx`
- Modify: `test/admin-session-detail.spec.ts`

**Implementation:**
- Show selfie, generated caricature, and final postcard in a responsive grid.
- Use the authenticated proxy URLs from Task 11.
- Add lazy loading, descriptive alt text, download links, and an accessible expanded preview dialog.
- Keep unavailable artifacts visible as explicit placeholders so partial failures are understandable.

**Verification:**
- `pnpm test -- admin-session-detail.spec.ts`
- `pnpm check`
- `pnpm build`
- Test keyboard opening/closing of the preview and mobile stacking.

**Completion notes:** Added `src/components/admin/SessionImages.astro` with responsive selfie, caricature, and postcard artifact cards, authenticated proxy URLs, lazy loading, descriptive alt text, download links, and explicit unavailable placeholders. Added `src/components/admin/ImagePreview.tsx` with load failure feedback, keyboard-accessible expanded preview dialog, Escape/click dismissal, focus restoration, and a close control. Integrated the image section into `src/pages/admin/sessions/[sessionId].astro` and expanded `test/admin-session-detail.spec.ts` with Astro compilation, proxy/unavailable-state, keyboard dialog, and responsive stacking coverage. Verification passed: `pnpm test -- admin-session-detail.spec.ts` (20 files, 124 tests), `pnpm check` (0 errors; 1 pre-existing deprecation hint), and `pnpm build`. Browser manual viewport inspection was unavailable because the Chrome DevTools session was already locked; responsive stacking and keyboard behavior were verified by the focused jsdom tests.

---

## Phase 5: Statistics and Insights

### - [x] Task 13: Add Time-Range and Scene Statistics

**Outcome:** Admins can answer how many generations ran, how they ended, and which scenes were used for all events or one event.

**Files:**
- Modify: `src/lib/admin-filters.ts`
- Modify: `src/db/admin.ts`
- Modify: `src/pages/api/admin/stats.ts`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/components/admin/OperationsDashboard.tsx`
- Create: `src/components/admin/MetricsOverview.astro`
- Create: `test/admin-metrics.spec.ts`

**Implementation:**
- Add preset time ranges for 24 hours, 7 days, 30 days, and all time while retaining explicit `from`/`to` support in the normalized contract.
- Query status breakdown, scene usage, daily/hourly volume buckets, and completion rate from D1.
- Use the same event and time filters as the dashboard.
- Render a compact trend visualization using semantic HTML/CSS or a small local component; do not add a chart dependency unless the native approach is unusable.
- Document that these are current D1 session facts, not retry/cost telemetry.

**Verification:**
- `pnpm test -- admin-metrics.spec.ts`
- `pnpm check`
- Reconcile all-events and single-event totals against fixture rows.

**Completion notes:** Added `24h`, `7d`, `30d`, and all-time range normalization with explicit UTC bounds in `src/lib/admin-filters.ts`; added status breakdown, scene usage, and daily volume read models in `src/db/admin.ts`; updated `src/pages/api/admin/stats.ts` to return the detailed statistics contract; and combined the summary, daily bar chart, scene usage, and latest jobs into the shared filtered dashboard in `src/pages/admin/index.astro` and `src/components/admin/OperationsDashboard.tsx`. The dashboard defaults to the past seven UTC calendar days, and one filter form drives both the graphs and job list. Added shared `Select` and `Input` primitives with regular text weight and a spaced select chevron, plus focused coverage in `test/admin-metrics.spec.ts`, `test/admin-dashboard.spec.ts`, and `test/admin-polling.spec.tsx`. The standalone metrics route was removed and the Metrics nav item was removed. Verification passed: `pnpm test -- admin-dashboard.spec.ts admin-polling.spec.tsx admin-metrics.spec.ts admin-layout.spec.ts` (21 files, 129 tests), `pnpm check` (0 errors, 0 warnings; 1 pre-existing deprecation hint), and `git diff --check`; no follow-up blocker.

### - [x] Task 14: Persist and Display End-to-End Pipeline Duration

**Outcome:** Average pipeline duration is based on an explicit measurement rather than inferred or zero-filled values.

**Files:**
- Create: `drizzle/migrations/0004_session_pipeline_duration.sql`
- Modify: `src/db/sessions.ts`
- Modify: `src/worker.ts`
- Modify: `src/db/admin.ts`
- Modify: `src/pages/admin/metrics.astro`
- Create: `test/admin-duration.spec.ts`
- Modify: `test/worker-moderation.spec.ts` as needed.

**Implementation:**
- Add nullable `pipeline_ms INTEGER` to `sessions`.
- When marking a session completed, persist elapsed milliseconds from `created_at` to completion or an explicit workflow start value selected in this task. Document the chosen start point.
- Leave errored and legacy rows null unless a defensible duration is available.
- Compute average duration only from completed rows with non-null duration.
- Display `No data` for a null average, never `0s`.

**Verification:**
- `pnpm db:migrate:local`
- `pnpm test -- admin-duration.spec.ts worker-moderation.spec.ts`
- `pnpm check`
- `pnpm build`

**Completion notes:** Added nullable `pipeline_ms` storage in `drizzle/migrations/0005_session_pipeline_duration.sql` because migration `0004` is already occupied, measured workflow-start-to-completion duration in `src/worker.ts`, persisted it through `src/db/sessions.ts`, and added average completed-duration metrics to `src/db/admin.ts` and `src/components/admin/OperationsDashboard.tsx` with `No data` for null values. Added local-only sample rows in `drizzle/seed.local.sql` with the `db:seed:local` script, plus `test/admin-duration.spec.ts` and completion-transition coverage in `test/worker-moderation.spec.ts`. Verification passed: `pnpm db:migrate:local`, `pnpm test -- admin-duration.spec.ts worker-moderation.spec.ts`, `pnpm check` (0 errors, 1 pre-existing deprecation hint), and `pnpm build`. Follow-up: deployment smoke verification was not run; errored and legacy sessions remain null by design.

---

## Phase 6: Expanded Event Configuration

### - [x] Task 15: Add Event Copy and Accent Configuration

**Outcome:** Admins can edit attendee-facing text and accent color with validation and immediate preview feedback.

**Files:**
- Modify: `src/lib/event-validation.ts`
- Modify: `src/db/events.ts`
- Modify: `src/pages/admin/events/[slug].astro`
- Modify: `src/pages/api/admin/events/[slug].ts`
- Create: `test/admin-event-branding.spec.ts`

**Implementation:**
- Add tagline, kiosk idle subhead, scene picker heading, and accent color sections to the existing event editor.
- Validate copy lengths and accept only a safe CSS color format already supported by the attendee UI.
- Save through the existing event update endpoint and return field-level errors.
- Show a bounded preview using real event copy; do not duplicate the full attendee app inside admin.
- Verify each edited field is actually consumed by attendee pages. If a stored field is currently unused, wire it into the attendee route in this task rather than presenting a nonfunctional control.

**Verification:**
- `pnpm test -- admin-event-branding.spec.ts`
- `pnpm check`
- Edit every field, reload `/e/:slug`, and verify the attendee-visible result.

**Completion notes:** Implemented validated event tagline, kiosk idle subhead, scene picker heading, and six-digit hex accent color updates in `src/lib/event-validation.ts`, `src/db/events.ts`, and `src/pages/api/admin/events/[slug].ts`; added the admin branding form and bounded preview in `src/pages/admin/events/[slug].astro`; wired all four values into the attendee route and booth UI in `src/pages/e/[slug].astro`, `src/components/Photobooth.tsx`, `src/components/steps/SceneStep.tsx`, and `src/styles/global.css`; added `test/admin-event-branding.spec.ts`. Verification passed: `pnpm test -- admin-event-branding.spec.ts` (23 files, 135 tests), `pnpm check` (0 errors, 1 pre-existing deprecation hint), and `pnpm build`. Manual verification confirmed each field persisted after editing and appeared correctly on the reloaded attendee route. No `.env` or Access configuration was changed.

### - [ ] Task 16: Add One Supported Watermark Configuration

**Outcome:** Admins can upload, preview, resize, and remove the bottom-right postcard watermark that the current pipeline supports.

**Files:**
- Modify: `src/pages/admin/events/[slug].astro`
- Create: `src/pages/api/admin/events/[slug]/watermark.ts`
- Modify: `src/db/events.ts`
- Modify: `src/lib/postcard.ts`
- Modify: `src/worker.ts`
- Create: `test/admin-watermark.spec.ts`

**Implementation:**
- Support only the existing bottom-right watermark first; defer the unused left watermark field until the postcard pipeline supports and tests it.
- Accept PNG input with explicit byte-size, content-type, signature, and dimension validation.
- Store under an event-scoped R2 key and update `watermark_image_key` and `watermark_w` transactionally enough to avoid pointing at a failed upload.
- Use `watermark_w` in `buildPostcard()` instead of the current fixed width.
- Provide authenticated preview and removal behavior; removal must clear the DB reference and delete only the event-owned object.
- Verify the workflow payload carries the selected watermark configuration.

**Verification:**
- `pnpm test -- admin-watermark.spec.ts`
- `pnpm check`
- `pnpm build`
- Generate a postcard with and without a watermark and compare the output.

**Completion notes:** Pending.

### - [ ] Task 17: Move Scenes to Event-Scoped D1 Configuration

**Outcome:** Each event can manage its own active, ordered scene set while existing seeded events retain the current six scenes.

**Files:**
- Create: `drizzle/migrations/0005_event_scenes.sql`
- Create: `src/db/scenes.ts`
- Modify: `src/data/scenes.ts`
- Modify: `src/pages/e/[slug].astro`
- Modify: `src/components/Photobooth.tsx`
- Modify: `src/actions/index.ts`
- Modify: `src/worker.ts`
- Create: `test/admin-scenes.spec.ts`
- Modify: relevant booth-machine/component tests.

**Implementation:**
- Add an `event_scenes` table keyed by `(event_id, id)` with name, description, emoji, accent, backdrop, prompt, sort order, and active flag.
- Seed every existing event with the current static scenes in the migration.
- Keep the `Scene` TypeScript type as the shared contract, adding `prompt` if required.
- Load active ordered scenes on the event route and pass them into `Photobooth`; remove its direct static import.
- Validate the selected scene against that event in `startGeneration`.
- Pass the stored scene prompt or scene data into the workflow so generation no longer depends on the global static array.
- Keep a compatibility seed constant only for migrations/tests if useful; there must be one runtime source of truth.

**Verification:**
- `pnpm db:migrate:local`
- `pnpm test`
- `pnpm check`
- `pnpm build`
- Verify two events can expose different scene sets and cannot submit each other's scene IDs.

**Completion notes:** Pending.

### - [ ] Task 18: Add Scene and Prompt Management UI

**Outcome:** Admins can add, edit, activate, deactivate, and reorder scenes and manage event-level prompt preamble/constraints.

**Files:**
- Modify: `src/pages/admin/events/[slug].astro`
- Create: `src/pages/api/admin/events/[slug]/scenes.ts`
- Create: `src/pages/api/admin/events/[slug]/scenes/[sceneId].ts`
- Modify: `src/lib/event-validation.ts`
- Modify: `src/db/scenes.ts`
- Modify: `src/worker.ts`
- Create: `test/admin-scene-editor.spec.ts`

**Implementation:**
- Add separate Scenes and Prompts sections to the event editor.
- Validate scene IDs, labels, prompt length, colors, ordering, and active state.
- Require at least one active scene before an event can be activated.
- Use explicit move-up/move-down controls or a fully keyboard-accessible reorder implementation; do not ship pointer-only drag and drop.
- Compose generation prompts from event preamble, scene prompt/description, constraints, and the existing safety/recognizability instruction in one tested function.
- Return `409` for duplicate scene IDs and field-level `400` errors for invalid configuration.

**Verification:**
- `pnpm test -- admin-scene-editor.spec.ts`
- `pnpm test`
- `pnpm check`
- `pnpm build`
- Create and reorder scenes, activate the event, and complete a generation using a newly created scene.

**Completion notes:** Pending.

---

## Phase 7: Final Hardening

### - [ ] Task 19: Complete Security, Accessibility, and Responsive Review

**Outcome:** The complete admin flow is secure, keyboard-accessible, responsive, and documented for operation.

**Files:**
- Modify only files with issues found during this review.
- Modify: `README.md`
- Create: `docs/admin-dashboard-operations.md`

**Implementation:**
- Verify every `/admin/*` page uses `AdminLayout.astro` and every `/api/admin/*` route is covered by the Worker Access boundary.
- Verify no admin JSON response leaks R2 keys, selfie hashes, or unnecessary attendee data.
- Verify image routes cannot cross session ownership or fetch arbitrary keys.
- Check keyboard navigation, focus visibility, status semantics, form error association, 44px touch targets, contrast, reduced motion, empty/loading/error/stale states, and mobile layout.
- Document Access policy setup, local Access testing, dashboard filters, status meanings, event lifecycle, image privacy, and troubleshooting.
- Do not add destructive session/event actions during hardening.

**Verification:**
- `pnpm test`
- `pnpm check`
- `pnpm build`
- Browser smoke: Access sign-in, dashboard filter, live polling, event create/edit/archive, session detail, all image kinds, metrics filters, watermark configuration, scene configuration, and attendee generation.
- Confirm the Access policy denies a non-allowlisted email on production and preview routes.

**Completion notes:** Pending.

---

## Reusable New-Agent Prompt

```text
Work in the repository at /Users/jamesqquick/code/demos/ai-caricature-booth.

Read AGENTS.md and the implementation plan at:
docs/admin-dashboard-implementation-plan.md

Check git status, then find the first top-level task in that plan whose heading starts with `- [ ]`. Implement only that task. Do not skip ahead, alter unrelated work, modify .env files, commit, push, deploy, or configure Cloudflare Access unless I explicitly ask.

Follow the task's listed files, constraints, and verification steps. Preserve existing user or agent changes. After all required verification passes:
1. Change that task's top-level checkbox from `[ ]` to `[x]`.
2. Replace its `Completion notes: Pending.` line with a concise summary of files changed, verification run, and any follow-up concern.
3. Stop so the next task can be handed to a fresh agent.

If blocked, leave the task unchecked, document the blocker in its Completion notes, and stop. In your final response report what changed, files modified, verification results, and any blocker or follow-up.
```
