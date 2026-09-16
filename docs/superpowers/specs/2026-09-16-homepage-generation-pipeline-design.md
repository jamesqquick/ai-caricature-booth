# Homepage Generation Pipeline Design

## Goal

Redesign the homepage's animated image-generation explanation so the visual transformation and technical pipeline tell one synchronized, understandable story. Use official Cloudflare product icons wherever a named Cloudflare product appears.

## Scope

- Update only the homepage pipeline section and its supporting styles and behavior.
- Replace the current six-node sequence with five focused stages.
- Preserve the existing selfie and caricature demo assets.
- Keep the section responsive and fully understandable without animation.
- Do not change the attendee booth flow or generation backend.

## Sequence

1. **Capture**: show the source selfie and explain browser camera capture.
2. **Store**: show Cloudflare R2 while describing the private photo upload.
3. **Check**: show Workers AI while describing the safety check, then retain the selfie when the scan finishes.
4. **Create**: begin with the selfie and a loader, then reveal the generated caricature while showing Cloudflare Workflows and a restrained Replicate label.
5. **Overlay**: show Cloudflare Images while the watermark and final postcard treatment appear. The completed result remains ready to download or share.

## Visual Design

Use the selected Stage Rail direction. The top area remains a wide two-column composition with the changing image preview on the left and active-stage explanation on the right. A five-item rail sits beneath it.

The active stage uses Cloud Orange, a clear state label, and stronger contrast. Completed stages retain a visible completion mark. Pending stages use quiet neutral treatment. Orange remains a functional signal rather than decoration.

Do not print `QUEUED`, `ACTIVE`, or `COMPLETE` inside the rail cards. Communicate state through the active outline and elevation, completed treatment, and rail progress. Remove the `SELFIE · CARICATURE · POSTCARD`, `selfie.jpg → postcard.png`, and bottom-left status callouts from the preview so the image transformation remains the focus.

Remove the stage-status footer and the `BEHIND THE SCENES` divider with its horizontal lines. Place the icon-only play/pause control inside the bordered pipeline container at its top-right, above the image and stage rail without affecting their layout. In the final Overlay preview badge, use `WATERMARK` instead of `CARICATURE`.

During Capture, overlay a scaled version of the real camera screen's shutter button at the bottom center of the selfie. The shutter depresses about 35% into the stage and triggers a restrained white capture flash, leaving the captured image visible before Store begins.

Vendor the official SVGs from the Cloudflare Docs icon collection into a local public asset directory:

- `r2.svg`
- `workers-ai.svg`
- `workflows.svg`
- `images.svg`

Use existing generic iconography for camera capture. Replicate is represented by text rather than an invented product mark.

On viewports below 800 pixels, the stage rail becomes a two-column grid. On narrow phones it remains two columns with compact content, with the final Overlay card spanning both columns.

## Animation

Use one JavaScript stage index as the source of truth. Each stage lasts 3.4 seconds for a 17-second loop. Updating the stage sets one data attribute on the pipeline root; CSS selectors derive image visibility, active rail state, active copy, and transition treatment from that value.

Transitions use opacity and transforms with the existing exponential easing vocabulary, except the long Create crossfade uses linear timing so neither image change is front-loaded. The animation does not modify layout-driving properties.

Use CSS keyframes tied to the Capture stage for the shutter press and flash rather than adding another JavaScript timer. The press happens about 35% into the 3.4-second stage so the capture interaction is visible sooner.

During Store, place a loading spinner over the selfie for roughly the first two-thirds of the stage. During the final third, move the selfie upward and fade it out to simulate the completed cloud upload. When Check begins, return the selfie from below over approximately 400 milliseconds, run the safety scan, and retain the selfie through the end of the stage. Create begins with a brief hold on that selfie and a loading spinner, then uses a long crossfade spanning roughly 70% of the stage: the selfie slowly fades out while the generated caricature slowly fades in with substantial visual overlap and no snap between images. Implement these as stage-scoped CSS keyframes so pause, resume, restart, and reduced-motion behavior remain synchronized with the existing stage index.

When `prefers-reduced-motion: reduce` is active, do not start the interval. Render the completed postcard and show all five stages as a static overview.

## Accessibility

- Keep the pipeline as a labeled region and the rail as a semantic list.
- Product SVGs are decorative because adjacent text names each product.
- Never rely on color alone: active and completed stages receive distinct outlines, elevation, and progress treatment.
- Provide one icon-only play/pause control inside the bordered pipeline container at its top-right with a visible focus state, a minimum 44-pixel target, an accurate accessible label, and the corresponding play or pause icon. Do not show a `PAUSE ANIMATION` text button.
- Preserve readable contrast in light and dark themes.

## Implementation Boundaries

- Keep the stage configuration in `src/pages/index.astro` because it is static homepage content.
- Keep pipeline-specific presentation in `src/styles/global.css` to match the existing implementation.
- Do not introduce a framework component or client dependency for the animation.
- Clear the interval when the page is removed to avoid duplicate timers during Astro navigation.

## Verification

- Add focused source-level coverage for the five stages, official asset references, control placement, Store upload treatment, and reduced-motion behavior where practical.
- Run `pnpm test`.
- Run `pnpm check`.
- Run `pnpm build`.
- Inspect desktop and mobile renderings in both normal and reduced-motion modes.
