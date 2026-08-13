---
name: Kinetic Cloud Studio
description: A polished, kinetic, and magical event photo booth built for an effortless one-minute transformation.
colors:
  cloud-orange: "#f6821f"
  cloud-orange-deep: "#d96816"
  studio-black: "#17191b"
  lifted-black: "#25282b"
  warm-paper: "#f4f2ed"
  quiet-ink: "#aaa9a5"
  ghost-line: "#ffffff1f"
  success-green: "#72c98d"
  error-red: "#e16d65"
typography:
  display:
    fontFamily: "Space Grotesk Variable, Space Grotesk, sans-serif"
    fontSize: "clamp(2.75rem, 7vw, 6.5rem)"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.06em"
  body:
    fontFamily: "Inter Variable, Inter, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.14em"
rounded:
  control: "999px"
  surface: "18px"
  media: "22px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "clamp(1.5rem, 4vw, 4rem)"
components:
  button-primary:
    backgroundColor: "{colors.cloud-orange}"
    textColor: "{colors.studio-black}"
    rounded: "{rounded.control}"
    padding: "0.875rem 1.5rem"
    height: "3rem"
  button-secondary:
    backgroundColor: "{colors.lifted-black}"
    textColor: "{colors.warm-paper}"
    rounded: "{rounded.control}"
    padding: "0.875rem 1.5rem"
    height: "3rem"
  card:
    backgroundColor: "{colors.lifted-black}"
    textColor: "{colors.warm-paper}"
    rounded: "{rounded.surface}"
    padding: "1rem"
---

# Design System: Kinetic Cloud Studio

## 1. Overview

**Creative North Star: "The Kinetic Cloud Studio"**

The interface is a compact creative studio in motion: dark, focused, and precise at rest, then bright and expressive in response to an attendee. Cloud orange acts like an active signal through a near-black environment, while oversized geometric type and tactile controls keep every step immediate.

This is a kiosk product, not a dashboard. The system hides infrastructure and configuration behind a single obvious path. Desktop and tablet compositions can use cinematic negative space; mobile stacks the same hierarchy without shrinking controls or reducing clarity.

**Key Characteristics:**
- Dark-first, with an equally intentional light theme.
- One dominant action per state.
- Large geometric headlines paired with quiet, practical body copy.
- Ambient depth and controlled glow rather than decorative glass effects.
- Responsive motion that confirms progress without blocking interaction.

## 2. Colors

The palette combines warm near-black studio surfaces with a rare, high-energy orange signal and paper-toned text.

### Primary
- **Cloud Orange:** The active signal for primary actions, current progress, focus, and moments of creative energy.
- **Cloud Orange Deep:** The pressed and high-contrast companion to Cloud Orange.

### Secondary
- **Success Green:** Completed steps and confirmed outcomes, always paired with an icon or label.
- **Error Red:** Camera and validation failures, always paired with explanatory copy.

### Neutral
- **Studio Black:** The dark-theme canvas.
- **Lifted Black:** Interactive surfaces and framed media.
- **Warm Paper:** Primary text and light-theme canvas.
- **Quiet Ink:** Supporting text.
- **Ghost Line:** Hairline boundaries and progress connectors.

**The Signal Rule.** Cloud Orange occupies less than 12 percent of a screen. Its rarity makes the next action unmistakable.

**The Theme Rule.** Dark mode is the expressive default, but every semantic role must map cleanly to a deliberate light-mode value.

## 3. Typography

**Display Font:** Space Grotesk Variable (with a geometric sans-serif fallback)
**Body Font:** Inter Variable (with a system sans-serif fallback)
**Label/Mono Font:** IBM Plex Mono (with a system monospace fallback)

**Character:** Space Grotesk gives the booth its technical confidence and kinetic scale. Inter keeps instructions effortless to scan, while mono labels add a restrained operational layer.

### Hierarchy
- **Display** (600, fluid 2.75rem to 6.5rem, 0.92): One short statement per step, limited to roughly 12 characters per line where practical.
- **Headline** (600, fluid 2rem to 4.5rem, 1): Compact step and result headings.
- **Title** (600, 1rem to 1.25rem, 1.2): Scene names and status titles.
- **Body** (400, 1rem, 1.6): Instructions and supporting copy, limited to 65 characters per line.
- **Label** (600, 0.6875rem, 0.14em, uppercase): Eyebrows, step metadata, privacy notes, and operational status.

**The Short Headline Rule.** Display copy is a visual action cue, not a paragraph. If a headline needs punctuation beyond one period, shorten it.

## 4. Elevation

The system uses a hybrid of tonal layering and broad ambient shadow. Most structure comes from surface contrast and one-pixel borders; shadows are reserved for floating postcards, active media, and orange atmospheric light.

### Shadow Vocabulary
- **Ambient Glow** (`0 0 5rem rgb(246 130 31 / 0.18)`): Creates energy behind the current creative object, never behind ordinary cards.
- **Postcard Lift** (`0 2.5rem 6rem rgb(0 0 0 / 0.55)`): Makes the generated result feel physical and collectible.
- **Focus Ring** (`0 0 0 3px rgb(246 130 31 / 0.35)`): Reinforces the required visible outline on keyboard focus.

**The Flat-at-Rest Rule.** Ordinary surfaces stay flat. Elevation appears only for hierarchy, direct manipulation, or the final artifact.

## 5. Components

Components are tactile and confident: generous targets, direct labels, and fast state feedback. Use shadcn/ui primitives first, then compose signature booth treatments around them.

### Buttons
- **Shape:** Full pill controls with a minimum 44-pixel target and a 48-pixel standard height.
- **Primary:** Cloud Orange with Studio Black text, bold label, and horizontal padding of 24 pixels.
- **Hover / Focus:** Slight brightness and one-pixel lift on hover; a three-pixel high-contrast outline on focus; no layout shift.
- **Secondary / Ghost:** Lifted neutral surface for secondary actions and transparent quiet text for tertiary navigation.

### Chips
- **Style:** Mono or compact sans label, one-pixel Ghost Line border, and restrained neutral fill.
- **State:** Selected chips use Cloud Orange text plus a clear check icon; color never carries selection alone.

### Cards / Containers
- **Corner Style:** Gently rounded studio surfaces (18 pixels) and more generous media frames (22 pixels).
- **Background:** Lifted Black over Studio Black in dark mode, with the inverse paper hierarchy in light mode.
- **Shadow Strategy:** Flat by default; only selected and final-artifact states lift.
- **Border:** One-pixel Ghost Line boundary.
- **Internal Padding:** 16 to 24 pixels based on density and viewport.

### Inputs / Fields
- **Style:** High-contrast neutral fill, one-pixel border, 12-pixel radius, and a minimum 48-pixel height.
- **Focus:** Cloud Orange border and visible outer focus ring.
- **Error / Disabled:** Pair color with text and icon; disabled controls remain legible and clearly inactive.

### Navigation
- The booth header is compact and persistent. Progress uses numbered steps, labels where space permits, and semantic current/completed states. On narrow mobile screens, preserve the numbered rail and hide only redundant labels.

### Viewfinder and Postcard
- The viewfinder is the dominant interactive object in the camera step and keeps a portrait 4:5 ratio.
- The postcard uses a restrained physical tilt, scene-aware accent, broad lift, and paper-like caption area. It is the only element allowed to feel materially elevated.

## 6. Do's and Don'ts

### Do:
- **Do** keep one dominant action per step and place it within easy thumb reach.
- **Do** use Cloud Orange only for active progress, focus, and primary action.
- **Do** keep touch targets at least 44 by 44 pixels across tablet, desktop, and mobile.
- **Do** announce state changes semantically and honor reduced-motion preferences.
- **Do** use shadcn/ui primitives before introducing a custom equivalent.

### Don't:
- **Don't** make this resemble a generic SaaS dashboard: no dense card grids, tiny controls, muted admin styling, or configuration-heavy layouts.
- **Don't** use gradients as decoration. Ambient radial light may clarify focus, but surfaces remain solid.
- **Don't** use excessive rounded containers or place every text group inside a card.
- **Don't** use orange for passive decoration or rely on it alone to communicate state.
- **Don't** shrink the desktop layout into mobile; recompose it into a clear vertical flow.
