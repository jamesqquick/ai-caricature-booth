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
pnpm dev
```

Camera access requires `localhost` or HTTPS. A plain HTTP LAN address will not expose `navigator.mediaDevices` in most browsers.

Apply the local D1 migration and seed data with:

```sh
pnpm db:migrate:local
```

The seed includes `/e/nyc-tech-week-2026` and `/e/cloudflare-connect-2026`.

## Verification

```sh
pnpm test
pnpm check
pnpm build
```
