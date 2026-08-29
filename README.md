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
pnpm astro dev --background
```

Use `pnpm astro dev status`, `pnpm astro dev logs`, and `pnpm astro dev stop` to manage the background server.

Camera access requires `localhost` or HTTPS. A plain HTTP LAN address will not expose `navigator.mediaDevices` in most browsers.

Apply the local D1 migration and seed data with:

```sh
pnpm db:migrate:local
```

The seed includes `/e/nyc-tech-week-2026` and `/e/cloudflare-connect-2026`.

## Admin Access

Admin pages and APIs fail closed unless the Worker verifies a Cloudflare Access identity. The Worker prefers `ExecutionContext.access` when available and otherwise validates the signed `Cf-Access-Jwt-Assertion` header against the configured Access application audience, issuer, and remote JWKS. It ignores caller-supplied admin email headers and forwards only the email from a verified identity.

The deployment owner must create and maintain a self-hosted application in **Zero Trust** > **Access** > **Applications**. On every production, enabled Preview, `workers.dev`, and Custom Domain hostname, set application domains that protect exactly `/admin`, `/admin/*`, `/api/admin`, and `/api/admin/*`. Limit Access to those paths; attendee routes including `/`, `/e/*`, and `/p/*` must remain public. Do not enable whole-Worker protection from the Worker's **Access** tab because it also protects the attendee routes. The Access policy is the email allowlist; the application does not provide a separate login or authorization policy.

Astro development builds inject `local-admin@localhost` only for loopback requests (`localhost`, `127.0.0.1`, or `[::1]`). Production builds never enable this fallback. Use `pnpm test -- admin-access.spec.ts` to exercise authenticated, unauthenticated, JWT, and local-development requests. For a protected deployment smoke test, confirm an allowlisted email reaches an admin route without the Worker's `403` response and confirm a non-allowlisted email is stopped by Access before it reaches the Worker.

Workers Static Assets does not propagate `ExecutionContext.access` to the user Worker. The JWT fallback handles that deployment path without trusting unsigned identity headers. Keep `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` aligned with the self-hosted Access application whenever that application is replaced. The `assets.run_worker_first` rules ensure admin paths cannot bypass the Worker through a matching static asset.

See [Admin dashboard operations](docs/admin-dashboard-operations.md) for Access setup, event operations, status definitions, image privacy, and troubleshooting.

## Verification

```sh
pnpm test
pnpm check
pnpm build
```
