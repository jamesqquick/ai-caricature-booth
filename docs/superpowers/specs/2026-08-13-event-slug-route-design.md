# Event Slug Route Design

## Goal

Make event landing pages resolve through `/e/[slug]` while supporting only the existing `nyc-tech-week-2026` event for now. Unknown event slugs must show a custom 404 page with a link back to the home page.

## Architecture

- Replace the current hard-coded event page with the Astro dynamic route `src/pages/e/[slug].astro`.
- Use `getStaticPaths` to generate the single supported slug, `nyc-tech-week-2026`.
- Render the existing `BoothLayout` and `Photobooth` unchanged for the supported slug.
- Render the custom not-found experience from `src/pages/404.astro` for unsupported event slugs.
- Keep the home page event link pointed at `/e/nyc-tech-week-2026`.

## Error Handling

The static route will generate every supported slug and no others. Requests for unknown event slugs will fall through to Astro's custom 404 page, which will use the existing site layout and provide a clear link to `/`.

## Verification

- `npm run check`
- `npm run build`
- Confirm the supported event route remains available in the generated output.
- Confirm Astro generates the custom 404 page.

## Scope Boundaries

This change does not introduce an event data collection, multiple event configurations, event-specific metadata, or runtime/server rendering. Those can be added when a second event is needed.
