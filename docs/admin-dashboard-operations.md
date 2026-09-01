# Admin dashboard operations

The admin dashboard is available at `/admin`. Cloudflare Access must protect exactly `/admin`, `/admin/*`, `/api/admin`, and `/api/admin/*` on every hostname that serves the application. Attendee routes such as `/`, `/e/*`, and `/p/*` remain public.

## Environment configuration

The Worker requires `PRINT_AGENT_TOKEN`, `PRINT_CAPABILITY_SECRET`, and `REPLICATE_API_TOKEN` secrets. Set them with `pnpm exec wrangler secret put <NAME>` so values do not enter shell history or source control. `PRINT_CAPABILITY_SECRET` signs 2-hour attendee print capabilities and must be an independent random value, not a copy of the print-agent token, Replicate token, or an Access secret. It belongs only in the Worker environment and must not be added to `print-agent/.env`. Keep `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` aligned with the Access application in `wrangler.jsonc`.

The print agent loads these settings from `print-agent/.env` or its service environment:

| Setting | Required | Operation |
| --- | --- | --- |
| `WORKER_URL` | Yes | HTTPS Worker origin. Loopback HTTP is allowed for local development. |
| `EVENT_SLUG` | Yes | Event queue handled by this agent. `--event-slug` overrides it. |
| `PRINT_AGENT_TOKEN` | Yes | Must match the Worker secret. Never log or pass it as a CLI argument. |
| `PRINTER_DRIVER` | No | `mock` by default; `dnp` and `dnp-ds620` use CUPS. |
| `PRINTER_NAME` | For CUPS | Exact CUPS queue name passed to `lp -d`. |
| `PRINT_AGENT_STATE_DIR` | Recommended | Absolute, stable directory for identity, lock, and recovery state. |
| `POLL_INTERVAL_MS` | No | Positive polling interval; defaults to `5000`. |
| `BATCH_SIZE` | No | Jobs handled per poll cycle; defaults to `5`, maximum `20`. Jobs are still claimed one at a time. |

## Access setup

1. In the Cloudflare dashboard, open **Zero Trust** > **Access** > **Applications**, select **Add an application**, and create a **Self-hosted** application. Cloudflare documents this path-specific flow in [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-a-specific-hostname-custom-domain-or-path).
2. Add application domains that protect exactly `/admin`, `/admin/*`, `/api/admin`, and `/api/admin/*` for every production, enabled Preview, `workers.dev`, and Custom Domain hostname that routes to the Worker. Do not include `/`, `/e/*`, or `/p/*`; these attendee routes must remain public.
3. Attach an Allow policy containing the approved admin email addresses or groups.
4. Do not use **Workers & Pages** > select the Worker > **Access** > **Protect this Worker behind Access** for this deployment. Worker-level Access protects the entire Worker across its routes and domains, including the public attendee routes.
5. Copy the self-hosted Access application's AUD tag to `ACCESS_AUD` and set `ACCESS_TEAM_DOMAIN` to the complete `https://<team>.cloudflareaccess.com` origin in `wrangler.jsonc` or the deployment environment.
6. Deploy the Worker, sign in with an allowlisted email, and open `/admin`.
7. In a separate browser session, verify that a non-allowlisted email is denied before a request reaches the Worker. Repeat this check for the production URL and a Preview URL.

The Worker validates `ExecutionContext.access` when it is available. It otherwise verifies `Cf-Access-Jwt-Assertion` against the configured issuer, audience, and Access JWKS. Requests cannot grant themselves access by supplying the internal admin email header.

## Local testing

Run the Astro development server in background mode:

```sh
pnpm astro dev --background
```

Loopback requests from `localhost`, `127.0.0.1`, and `[::1]` receive the development-only `local-admin@localhost` identity. This bypass is excluded from production builds and does not apply to LAN hostnames or non-loopback addresses.

Exercise the Access boundary directly with:

```sh
pnpm test -- admin-access.spec.ts
```

This test covers missing identities, verified identities, JWT validation, same-origin mutations, cross-origin mutation rejection, and loopback behavior. It does not replace the production allowlist checks above.

Apply local migrations and optional sample data separately before starting Astro:

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm astro dev --background
```

Migrations change the schema and may migrate existing production rows. They do not run `drizzle/seed.local.sql`.

## Dashboard filters

The dashboard updates the URL as filters change, so a filtered view can be bookmarked or shared with another authorized admin.

- **Event** limits results to one event.
- **Status** limits results to one generation stage.
- **From** and **To** apply an explicit UTC date range.
- **Reset** clears filters and returns to the first page.

The dashboard polls every 15 seconds while the tab is visible. A failed refresh keeps the last successful snapshot, marks it as stale, and provides **Retry now**. The timestamp identifies the last successful update.

## Session statuses

- `pending`: the session exists, but upload processing has not started.
- `uploading`: the selfie is being stored.
- `moderating`: the selfie is being checked before generation.
- `generating`: the caricature is being generated.
- `compositing`: the final postcard is being assembled.
- `completed`: the postcard was stored successfully.
- `errored`: processing stopped after a failure. Open the session detail for the stored safe error message and available artifacts.

## Print operation

Start the agent from a stable installation directory with `pnpm print-agent:start`. Run only 1 process for the same state directory. The singleton lock rejects a second process.

- `mock` validates the full download, PDF, archive, and acknowledgement path without CUPS. It writes the submitted PDF to `print-agent/spool/`.
- `dnp` and `dnp-ds620` submit through `lp` with 4x6 media and fit-to-page options. Confirm the queue first with `lpstat -p` and run a controlled test print before an event.
- `pending` means the Worker has queued the request but no agent owns it.
- `printing` means an agent claimed the request. It includes download, PDF creation, archive creation, CUPS submission, and pending acknowledgement time.
- `printed` means CUPS accepted the submission and the agent acknowledged that result. It does not guarantee paper exited the printer.
- `failed` means processing failed before a successful CUPS acceptance was established. The stored message is sanitized and limited.

The agent archives a PDF before invoking the printer. An archive proves which bytes were prepared, not that CUPS accepted them.

### Admin Retry and Reprint

Use **Retry** only for a job whose status is `failed`. Retry returns that failed job to `pending`; it does not create another history row. Verify the failure occurred before CUPS acceptance before retrying.

Use **Reprint postcard** to create an intentional new print job after the previous job reached a terminal state. This can produce another physical copy. Never use Reprint to work around `printing`, an unresolved local `submitting` marker, a stale dashboard, or an uncertain CUPS result. Resolve the original job first.

### Orphaned printing job resolution

This procedure is mandatory when a job remains `printing` but the owning agent's local claim state is unavailable. Do not use Retry or Reprint first.

1. Stop the affected print agent and preserve its state directory, archives, and logs.
2. Inspect CUPS queue/history, printer logs, physical output, and the matching archived PDF. If the local `submitting` marker still exists, use the submitting-marker recovery procedure instead of the admin action.
3. Choose `printed` only when CUPS accepted the job or the physical copy exists. Choose `not-submitted` only when evidence proves CUPS did not accept it. If uncertain, preserve the job as `printing` and escalate.
4. From the authenticated `/admin` origin, use browser developer tools to run the same-origin request below with the exact job and session IDs. Set `outcome` to the investigated result. The confirmation phrase is deliberately derived from the exact job ID and outcome.

```js
const sessionId = '<session-uuid>';
const jobId = '<32-character-job-id>';
const outcome = 'printed'; // or 'not-submitted'

await fetch(`/api/admin/sessions/${sessionId}/print-jobs`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    action: 'resolve-orphan',
    jobId,
    outcome,
    confirmation: `resolve print job ${jobId} as ${outcome}`,
  }),
}).then(async (response) => ({ status: response.status, body: await response.json() }));
```

5. Require a `200` response and verify the dashboard history now shows `printed` or `failed`. `not-submitted` resolves to `failed`, after which Retry can safely return that exact job to `pending`.

The endpoint resolves only a currently `printing` job belonging to the specified session. It clears active claim state and never returns claim or capability tokens. A missing job returns `404`; a terminal or otherwise non-printing job returns `409` without changing it.

## Local files and retention

Keep the installation and state paths stable across restarts and deployments:

| Path | Contents | Required handling |
| --- | --- | --- |
| `$PRINT_AGENT_STATE_DIR/installation-id` | Stable local installation UUID | Mode `0600`; do not copy between installations or delete during recovery. |
| `$PRINT_AGENT_STATE_DIR/pending-acks.json` | Claims, `submitting` markers, and terminal ACK intents | Mode `0600`; contains claim credentials. Never edit, print, or upload it. |
| `$PRINT_AGENT_STATE_DIR/agent.lock` | Active process PID | Mode `0600`; let the process release it. Stale locks are reclaimed conservatively. |
| `print-agent/output/` | Archived PDFs created before submission | Private operational data. Apply the event's approved retention policy. |
| `print-agent/spool/` | Mock-mode submitted PDFs | Private test output. Clear it under the approved retention policy when the mock agent is stopped. |
| OS temp `ai-caricature-booth-print-agent/` | CUPS submission PDF | The agent removes each temporary file after `lp` returns or times out. |

Without `PRINT_AGENT_STATE_DIR`, the state directory is `~/.ai-caricature-booth/print-agent/<event-slug>-<config-hash>/`. The hash changes when the Worker origin, event, printer driver, or printer name changes. Set an absolute service path such as `/var/lib/ai-caricature-booth/print-agent/<event-slug>` to avoid accidental identity changes during production reconfiguration.

Create the state, archive, and mock spool directories as the dedicated service account with directory mode `0700`. Files created by the agent use mode `0600`. Do not grant the web server or dashboard users filesystem access. Back up or retain archives only if the event's privacy policy requires them. Do not delete `pending-acks.json` to clear an incident.

## Crash and acknowledgement recovery

On normal startup, the agent reconciles its persisted claim identities with the Worker before it releases claims, replays terminal acknowledgements, or polls for new work.

- A `claimed` marker is safe to release because printer submission did not start.
- A `printed` or `failed` intent is replayed before new work. A network failure retains it for the next startup.
- A `submitting` marker means the process reached the boundary immediately before invoking CUPS. A crash or timeout can leave CUPS acceptance uncertain. Startup stops without polling or printing so an operator can inspect the physical system.
- A failed printed ACK does not turn into a failed print. The agent retains and replays the printed intent.

### Submitting marker recovery

Use this procedure only for the exact job named in the fatal startup message. The command accepts a job ID and outcome, but it reads the claim token only from the local marker. It cannot accept a caller-supplied token.

1. Stop the print-agent service. Do not delete its lock or state files. The recovery command takes the same singleton lock and fails if the agent is running.
2. Identify the 32-character job ID from the fatal log. To list marker status without displaying claim tokens, run `jq '.intents[] | {jobId: .job.id, status}' "$PRINT_AGENT_STATE_DIR/pending-acks.json"` as the service account.
3. Inspect CUPS with `lpstat -W all -o "$PRINTER_NAME"`, the printer queue/history, printer logs, and the physical output. Match timestamps and the archived PDF. CUPS history availability depends on the host configuration.
4. Choose `printed` if CUPS accepted the job or the physical copy exists. This means "CUPS accepted," not "paper delivery guaranteed."
5. Choose `not-submitted` only when evidence proves CUPS did not accept the job. The command releases the exact persisted claim so normal polling can claim it again.
6. If the result remains uncertain, do not run recovery, Retry, or Reprint. Preserve the marker and escalate for manual queue/log investigation.
7. Run exactly 1 confirmed command with the same environment and `PRINT_AGENT_STATE_DIR` as the service:

```sh
pnpm print-agent:resolve -- --job-id <32-character-job-id> --outcome printed --confirm
```

or:

```sh
pnpm print-agent:resolve -- --job-id <32-character-job-id> --outcome not-submitted --confirm
```

The command has no interactive prompt. `--confirm` asserts that the operator completed the investigation and accepts the selected physical outcome.

For `printed`, the command atomically replaces `submitting` with a printed ACK intent before contacting the Worker. It removes the intent only after a definitive successful or idempotent ACK response. A network failure leaves the printed intent for normal startup replay.

For `not-submitted`, the command releases the exact persisted claim. It removes the marker only after success or an idempotent already-resolved response. A network failure leaves the `submitting` marker unchanged. The command never downloads, polls, invokes CUPS, or prints.

## Event lifecycle

1. Create an event as `draft`.
2. Configure event details, prompts, scenes, and an optional PNG watermark.
3. Add at least one scene before changing the event to `active`.
4. Use the attendee link to verify the active event flow.
5. Change the event to `archived` when it should no longer accept new attendee sessions.

`draft` and `archived` events do not appear as active attendee experiences. They cannot create attendee print jobs, including idempotent replay of an earlier attendee print request. Existing postcard links and print-status reads remain available as read-only history. Archiving is reversible and does not delete sessions or image objects.

## Image privacy

Selfies, caricatures, postcards, and watermarks remain private in R2. Admin pages receive application proxy URLs, never raw R2 object keys. The proxy resolves the key from D1, verifies that it belongs to the requested session or event, allows only the expected image MIME types, and returns `Cache-Control: private, no-store`.

Treat downloaded images as private attendee data. Store them only where the event's retention and access policies permit.

## Troubleshooting

### Print agent exits during startup

- Read the typed fatal error and keep the state directory intact.
- If another process owns `agent.lock`, stop the duplicate service instead of deleting the lock.
- If `pending-acks.json` is invalid or unreadable, restore its permissions and investigate disk corruption. Do not replace it with an empty file.
- If startup names an unresolved `submitting` marker, follow the decision procedure above.

### Print agent cannot reach the Worker

- Confirm `WORKER_URL` is the correct origin and uses HTTPS outside loopback.
- Confirm the Worker and local service use the same `PRINT_AGENT_TOKEN` without displaying either value.
- Check DNS, TLS, and Worker logs. Repeated claim failures stop new work until owner reconciliation succeeds.
- Leave pending local markers in place while the network is unavailable. The agent replays them after connectivity returns.

### CUPS submission fails or times out

- Run `lpstat -p` and `lpstat -W all -o "$PRINTER_NAME"` as the service account.
- Confirm `PRINTER_NAME` exactly matches the queue and the account can run `lp`.
- Treat a failure after `lp` invocation as uncertain. Do not Retry or Reprint until you determine whether CUPS accepted it.
- Check media, paper, printer status, and CUPS logs. A Worker `printed` status records CUPS acceptance, not paper completion.

### Recovery command fails

- `USAGE`: provide the exact job ID, one valid outcome, and `--confirm`.
- `MARKER_NOT_FOUND`: verify the state directory and job ID. Do not create or edit a marker manually.
- Lock error: stop the running agent and retry; do not race recovery against polling.
- `ACK_FAILED` or `RELEASE_FAILED`: fix connectivity and rerun the same decision. The command retained safe local state.
- `STATE_FAILED`: check disk space, ownership, and `0700`/`0600` permissions before proceeding.

Recovery CLI exit codes are stable for service automation: `1` unexpected failure, `2` usage, `3` marker not found, `4` printed ACK failure, `5` release failure, and `6` local state failure. Logs and successful output include only the job ID and chosen outcome, never claim credentials.

### Access returns 403

- Confirm the identity is included by the Access Allow policy.
- Confirm `ACCESS_AUD` matches the protected Access application.
- Confirm `ACCESS_TEAM_DOMAIN` includes `https://` and matches the JWT issuer.
- Confirm Access protects all four admin path patterns on the exact production, preview, `workers.dev`, or Custom Domain hostname being tested while `/`, `/e/*`, and `/p/*` remain public.
- Confirm `assets.run_worker_first` still includes `/admin`, `/admin/*`, `/api/admin`, and `/api/admin/*`.

### Dashboard data does not refresh

- Select **Retry now** and check whether the last-successful-update timestamp changes.
- Check Worker logs for D1 query failures.
- Confirm the browser tab is visible. Polling pauses while it is hidden.
- Reset filters to rule out an empty valid result.

### An event cannot be activated

- Add at least one valid scene.
- Correct any field-level validation messages in Event details, Scenes, or Prompts.

### An image returns 404

- Confirm the session reports that artifact as available.
- Confirm the D1 image key uses `sessions/{sessionId}/{kind}.jpg` for the requested session and kind.
- For watermarks, confirm the key uses `events/{eventId}/watermarks/` and the object metadata is `image/png`.
- Check R2 for a missing object. The proxy intentionally returns the same 404 for missing, malformed, and cross-owned keys.

### A form save fails

- Correct highlighted fields and retry. Entered values remain in the form.
- Check Worker logs for D1 or R2 failures if no field is highlighted.
- Cross-origin admin mutations are rejected. Submit changes from the protected admin origin.
