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

Automatic Cloudflare Workers builds deploy changes merged to the production branch.

Set the Worker secrets through Wrangler's secure prompt because `cf` does not yet support updating one secret at a time. `MCP_AUTH_TOKEN`, `PRINT_AGENT_TOKEN`, `PRINT_CAPABILITY_SECRET`, and `REPLICATE_API_TOKEN` must be independent random values. `PRINT_CAPABILITY_SECRET` signs short-lived attendee print authorization. Use the same `PRINT_AGENT_TOKEN` in the local print-agent environment, but never commit or print any secret value.

```sh
pnpm exec wrangler secret put PRINT_AGENT_TOKEN
pnpm exec wrangler secret put PRINT_CAPABILITY_SECRET
pnpm exec wrangler secret put REPLICATE_API_TOKEN
pnpm exec wrangler secret put MCP_AUTH_TOKEN
pnpm exec cf deploy
pnpm db:migrate:remote
```

Run `pnpm exec cf auth whoami` first if `cf` is not authenticated. `cf deploy` is the target deployment path, but the current beta detects multiple frameworks in this pnpm workspace; use the existing Workers Build deployment until that detection issue is resolved. Deploy code that works with both schemas before applying destructive migrations such as `0020_remove_event_accent_color.sql`; apply additive migrations before deploying code that depends on them. Local migrations and seed data both remain on Wrangler so they use the same local D1 state. Do not run `drizzle/seed.local.sql` against the remote database.

## Event MCP server

The stateless MCP endpoint at `/mcp` exposes `list_events`, `get_event`, and `create_event`. Every request requires `Authorization: Bearer <MCP_AUTH_TOKEN>`. Event listing uses bounded cursor pagination. The create tool manages structured event configuration; add or change watermark images through the admin application.

For local development, add an uncommitted `MCP_AUTH_TOKEN` value to `.env`, start `pnpm dev`, and configure an MCP client with the URL `http://localhost:4321/mcp` and that bearer token. You can verify that the HTTP boundary fails closed without displaying the token:

```sh
curl -i http://localhost:4321/mcp
```

The response must be `401 Unauthorized` with a `WWW-Authenticate: Bearer` header. Run `pnpm exec vitest run test/event-mcp.spec.ts test/mcp-auth.spec.ts` for protocol initialization, discovery, tool-call, validation, and authentication coverage.

## Local printer setup for a booth

Run the print agent on the computer connected to the printer. It checks the booth website for queued postcards and sends them to the local printer. The website can stay hosted; you do not need to run `pnpm dev` for this setup. The booth screen can be a separate tablet or laptop using the website over Wi-Fi.

### 1. Have these ready

- A Mac or Linux computer with internet access, Git, Node.js **22.18.0 or newer**, and pnpm. The repository uses pnpm **11.9.0**.
- A DNP printer, such as the DS620/DS620A, with 4x6 media, a power cable, and a USB cable. A USB-C-only computer may need a compatible cable or adapter. Physical printing uses CUPS and the `lp` command.
- The deployed booth website URL, the event slug, and the website's `PRINT_AGENT_TOKEN`. Get these from the deployment owner. The website must already have `PRINT_AGENT_TOKEN` and `PRINT_CAPABILITY_SECRET` configured as described in [Deployment](#deployment).

### 2. Connect and test the printer

The [DNP DS620/DS620A](https://dnpphoto.com/products/printers/ds620a) connects by USB and does not have built-in Bluetooth printing. Connect it directly to the computer that will run the print agent.

1. Install a compatible printer driver before the event. On a Mac, get the DS620/DS620A driver for your macOS version from [DNP's downloads page](https://dnpphoto.com/downloads) and follow its installation instructions. Do not rely on an automatic driver-install prompt when USB is connected. On Linux, install a compatible CUPS driver.
2. Plug the printer into power, load the 4x6 media, turn it on, and connect its USB cable to the printer computer.
3. Add the printer in the computer's printer settings. On a Mac, use **System Settings → Printers & Scanners → Add Printer**, and select the installed DNP driver if prompted.
4. Print a test image from the computer before starting the booth app. Confirm a physical 4x6 print comes out correctly.
5. Open a terminal on that same computer and find its CUPS queue name:

```sh
lpstat -p -d
```

Use the name immediately after `printer` in the output, not the printer's display name. For example:

```text
printer DNP_DS620 is idle.
```

In this example, the queue name is `DNP_DS620`. Save your actual queue name for step 4. If no printer appears, check that the driver is installed and the printer has been added in the computer's settings.

### 3. Install the app

If the repository is not already on the printer computer:

```sh
git clone --branch main https://github.com/jamesqquick/ai-caricature-booth.git
cd ai-caricature-booth
```

Run all remaining commands from the repository root:

```sh
pnpm install
```

### 4. Configure the booth

Copy `print-agent/.env.example` to `print-agent/.env` if that file does not already exist, then open `print-agent/.env` in a text editor. The start command loads this file, so put the printer settings here.

For Hack Alcatraz with a DNP DS620/DS620A, use this example. For another event, replace the website URL and event slug:

```dotenv
WORKER_URL=https://ai-caricature-booth-v2.examples.workers.dev
EVENT_SLUG=hack-alcatraz-2026
PRINT_AGENT_TOKEN=replace-with-the-token-from-the-deployment-owner
PRINTER_DRIVER=dnp-ds620
PRINTER_NAME=your-cups-printer-name
POLL_INTERVAL_MS=5000
BATCH_SIZE=5
```

- `WORKER_URL` is the website origin only, without `/e/...`.
- `EVENT_SLUG` is the part after `/e/` in the booth URL. For `/e/hack-alcatraz-2026`, use `hack-alcatraz-2026`.
- `PRINT_AGENT_TOKEN` must match the website's secret exactly. Keep `.env` private and uncommitted. `PRINT_CAPABILITY_SECRET` stays on the website and does not belong in this file.
- `PRINTER_DRIVER=dnp` is also supported. The example file defaults to `mock`, so change it for physical printing.
- `PRINTER_NAME` is the exact queue name from step 2. If your output showed `printer DNP_DS620`, set `PRINTER_NAME=DNP_DS620`.

Leave the polling settings at their defaults. The agent checks every five seconds. It saves recovery state under `~/.ai-caricature-booth/print-agent/` by default. Keep that state between restarts. A service installation can set `PRINT_AGENT_STATE_DIR` to a stable absolute path owned only by its service account.

### 5. Start and test before opening the booth

```sh
pnpm print-agent:start
```

The terminal should show `Caricature Booth Print Agent` and the expected website, event, and `printer=CUPS(...)` name.

1. Open the event's booth page at `WORKER_URL/e/EVENT_SLUG`, such as [Hack Alcatraz](https://ai-caricature-booth-v2.examples.workers.dev/e/hack-alcatraz-2026), and create a postcard.
2. On the completed postcard page in the same browser, click **Print**. An admin can also open a completed session's **Print history** and click **Queue first print** or **Reprint postcard**.
3. Look for `[job ...] printed and acknowledged.` in the terminal and collect the physical postcard. This message means CUPS accepted the job. Check that the physical print is 4x6, landscape, and has no unwanted clipping before calling the booth ready.

Keep the terminal open, the computer awake, and the printer connected throughout the event. Run one agent process for this installation. Stop it with `Ctrl-C` and let the active job finish before closing the terminal. Start it again with the same command and configuration next time.

### Testing without a printer

Set `PRINTER_DRIVER=mock` in `print-agent/.env` and restart the agent. It writes PDFs to `print-agent/spool/print-<job-id>-<uuid>.pdf` instead of printing. Every processed job also saves a PDF in `print-agent/output/`.

Mock mode consumes real queued jobs and marks them printed, so use a test event. Switch back to `dnp-ds620` and restart before accepting booth prints.

### If printing stops

- Check the terminal for errors. Confirm the website URL, event slug, token, internet connection, and printer queue name. Use `lpstat -p -d` to check the local printer.
- If the agent exited after a connection or authentication error and the terminal returned to its command prompt, fix the problem and run `pnpm print-agent:start` again with the same settings.
- If a session's **Print history** shows **Failed**, fix the reported problem, then click **Retry** on that entry. Restarting the agent alone does not retry failed postcards. Admin access requires an allowlisted login as described in [Admin Access](#admin-access).
- If the agent reports an unresolved `submitting` marker or an uncertain printer outcome, stop it and inspect the CUPS queue and physical printer before retrying. Keep the recovery state intact.

For an unresolved submission, copy the exact 32-character job ID from the agent's terminal error and use it in place of `<job-id>`. This is not the session ID or the CUPS job number. In the computer's printer queue, look for the title `AI Caricature Booth <job-id>`. An empty queue alone does not prove the job was never submitted.

Run recovery with the same computer login and website, event, printer, and state-directory settings as the original agent. Choose one command based on what you verified:

```sh
# The job was accepted by CUPS or already printed; do not print another copy.
pnpm print-agent:resolve -- --job-id <job-id> --outcome printed --confirm

# You confirmed the job was never submitted; allow it to return to the queue.
pnpm print-agent:resolve -- --job-id <job-id> --outcome not-submitted --confirm
```

The recovery command does not print anything. If the outcome is still unknown, leave the agent stopped. After resolving it, run `pnpm print-agent:start` again.

If recovery reports that the printed intent was retained for normal startup replay, restore the connection and start the agent. It will retry notifying the website without printing another copy. If releasing a `not-submitted` job fails, restore the connection and repeat that recovery command. For other recovery errors, keep the state files and ask the deployment owner for help.

## Admin Access

Admin pages and APIs fail closed unless the Worker verifies a Cloudflare Access identity. The Worker prefers `ExecutionContext.access` when available and otherwise validates the signed `Cf-Access-Jwt-Assertion` header against the configured Access application audience, issuer, and remote JWKS. It ignores caller-supplied admin email headers and forwards only the email from a verified identity.

The deployment owner must create and maintain a self-hosted application in **Zero Trust** > **Access** > **Applications**. On every production, enabled Preview, `workers.dev`, and Custom Domain hostname, set application domains that protect exactly `/admin`, `/admin/*`, `/api/admin`, and `/api/admin/*`. Limit Access to those paths; attendee routes including `/`, `/e/*`, and `/p/*` must remain public. Do not enable whole-Worker protection from the Worker's **Access** tab because it also protects the attendee routes. The Access policy is the email allowlist; the application does not provide a separate login or authorization policy.

Astro development builds inject `local-admin@localhost` only for loopback requests (`localhost`, `127.0.0.1`, or `[::1]`). Production builds never enable this fallback. Use `pnpm test -- admin-access.spec.ts` to exercise authenticated, unauthenticated, JWT, and local-development requests. For a protected deployment smoke test, confirm an allowlisted email reaches an admin route without the Worker's `403` response and confirm a non-allowlisted email is stopped by Access before it reaches the Worker.

Workers Static Assets does not propagate `ExecutionContext.access` to the user Worker. The JWT fallback handles that deployment path without trusting unsigned identity headers. Keep `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` aligned with the self-hosted Access application whenever that application is replaced. The `assets.run_worker_first` rules ensure admin paths cannot bypass the Worker through a matching static asset.

## Verification

```sh
pnpm test
pnpm print-agent:typecheck
pnpm check
pnpm build
```
