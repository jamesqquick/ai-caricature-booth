# Admin dashboard operations

The admin dashboard is available at `/admin`. Cloudflare Access must protect exactly `/admin`, `/admin/*`, `/api/admin`, and `/api/admin/*` on every hostname that serves the application. Attendee routes such as `/`, `/e/*`, and `/p/*` remain public.

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

## Event lifecycle

1. Create an event as `draft`.
2. Configure event details, prompts, scenes, and an optional PNG watermark.
3. Add at least one scene before changing the event to `active`.
4. Use the attendee link to verify the active event flow.
5. Change the event to `archived` when it should no longer accept new attendee sessions.

`draft` and `archived` events do not appear as active attendee experiences. Archiving is reversible and does not delete sessions or image objects.

## Image privacy

Selfies, caricatures, postcards, and watermarks remain private in R2. Admin pages receive application proxy URLs, never raw R2 object keys. The proxy resolves the key from D1, verifies that it belongs to the requested session or event, allows only the expected image MIME types, and returns `Cache-Control: private, no-store`.

Treat downloaded images as private attendee data. Store them only where the event's retention and access policies permit.

## Troubleshooting

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
