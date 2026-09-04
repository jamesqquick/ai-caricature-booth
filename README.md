# AI Caricature Booth

An Astro and React event photobooth. Event pages resolve from local D1 at request time, and the booth flow runs in one hydrated React island:

1. Choose a New York scene.
2. Take or retake a photo with the browser camera.
3. Watch the photo upload, caricature generation, and postcard composition progress.
4. Review a postcard-style local preview.

Refreshing the page resets the booth UI. The approved JPEG is validated and uploaded privately to R2, then a Cloudflare Workflow generates the caricature and composes the postcard.

## Development

```sh
pnpm install
pnpm db:migrate:local
pnpm db:seed:local
pnpm dev
```

The server logs are printed in the terminal. Stop it with `Ctrl-C`.

Camera access requires `localhost` or HTTPS. A plain HTTP LAN address will not expose `navigator.mediaDevices` in most browsers.

`db:migrate:local` applies schema migrations only. It does not load sample sessions. Run `db:seed:local` separately when you need the local dashboard fixtures, including `/e/nyc-tech-week-2026` and `/e/cloudflare-connect-2026`.

## Deployment

Set the Worker secrets through Wrangler's secure prompt. `PRINT_CAPABILITY_SECRET` signs short-lived attendee print authorization and must be an independent random value, not a copy of `PRINT_AGENT_TOKEN`, `REPLICATE_API_TOKEN`, or any Access secret. Use the same `PRINT_AGENT_TOKEN` in the local print-agent environment, but never commit or print either value.

```sh
pnpm exec wrangler secret put PRINT_AGENT_TOKEN
pnpm exec wrangler secret put PRINT_CAPABILITY_SECRET
pnpm exec wrangler secret put REPLICATE_API_TOKEN
pnpm exec wrangler d1 migrations apply ai-caricature-booth-db --remote
pnpm build
pnpm exec wrangler deploy
```

Run `pnpm exec wrangler whoami` first if Wrangler is not authenticated. Apply remote migrations before deploying code that depends on them. Do not run `drizzle/seed.local.sql` against the remote database.

## Print agent

Install dependencies from the repository root with `pnpm install`. Configure the print agent in `print-agent/.env` or its service environment without committing secret values:

```dotenv
WORKER_URL=https://booth.example.com
EVENT_SLUG=event-slug
PRINT_AGENT_TOKEN=replace-through-your-secret-manager
PRINTER_DRIVER=mock
PRINT_AGENT_STATE_DIR=/absolute/stable/path/to/print-agent-state
```

Use `PRINTER_DRIVER=dnp` or `dnp-ds620` with `PRINTER_NAME` set to the exact CUPS queue name for physical printing. Optional `POLL_INTERVAL_MS` and `BATCH_SIZE` values default to `5000` and `5`. Start one agent process for an installation:

```sh
pnpm print-agent:start
```

Mock mode writes generated PDFs to `print-agent/spool/print-<job-id>-<uuid>.pdf`. Every processed job also creates `print-agent/output/print-<job-id>-<uuid>.pdf` before submission. The application job ID supports incident correlation while the UUID preserves a unique artifact for each attempt. Production services should use a stable checkout/install path and an absolute `PRINT_AGENT_STATE_DIR` owned only by the service account.

`PRINT_CAPABILITY_SECRET` belongs only in the Worker environment. Do not add it to `print-agent/.env`; the print agent authenticates with `PRINT_AGENT_TOKEN`, which is a separate credential.

If startup reports an unresolved `submitting` marker, stop the agent and follow [Submitting marker recovery](docs/admin-dashboard-operations.md#submitting-marker-recovery). The recovery command never polls or prints:

```sh
pnpm print-agent:resolve -- --job-id <32-character-job-id> --outcome printed|not-submitted --confirm
```

## Admin Access

Admin pages and APIs fail closed unless the Worker verifies a Cloudflare Access identity. The Worker prefers `ExecutionContext.access` when available and otherwise validates the signed `Cf-Access-Jwt-Assertion` header against the configured Access application audience, issuer, and remote JWKS. It ignores caller-supplied admin email headers and forwards only the email from a verified identity.

The deployment owner must create and maintain a self-hosted application in **Zero Trust** > **Access** > **Applications**. On every production, enabled Preview, `workers.dev`, and Custom Domain hostname, set application domains that protect exactly `/admin`, `/admin/*`, `/api/admin`, and `/api/admin/*`. Limit Access to those paths; attendee routes including `/`, `/e/*`, and `/p/*` must remain public. Do not enable whole-Worker protection from the Worker's **Access** tab because it also protects the attendee routes. The Access policy is the email allowlist; the application does not provide a separate login or authorization policy.

Astro development builds inject `local-admin@localhost` only for loopback requests (`localhost`, `127.0.0.1`, or `[::1]`). Production builds never enable this fallback. Use `pnpm test -- admin-access.spec.ts` to exercise authenticated, unauthenticated, JWT, and local-development requests. For a protected deployment smoke test, confirm an allowlisted email reaches an admin route without the Worker's `403` response and confirm a non-allowlisted email is stopped by Access before it reaches the Worker.

Workers Static Assets does not propagate `ExecutionContext.access` to the user Worker. The JWT fallback handles that deployment path without trusting unsigned identity headers. Keep `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` aligned with the self-hosted Access application whenever that application is replaced. The `assets.run_worker_first` rules ensure admin paths cannot bypass the Worker through a matching static asset.

See [Admin dashboard operations](docs/admin-dashboard-operations.md) for Access setup, event and print operations, status definitions, image privacy, local state, recovery, and troubleshooting.

## Verification

```sh
pnpm test
pnpm print-agent:typecheck
pnpm check
pnpm build
```
