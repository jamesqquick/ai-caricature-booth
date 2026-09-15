# Button and icon system implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the app's existing buttons and action icons without changing product behavior.

**Architecture:** `src/components/ui/button.tsx` remains the single class-variance contract for React buttons and Astro-native links or buttons through `buttonVariants`. `lucide-react` supplies icons in both frameworks. Every existing action covered by the design contract must render its mapped icon, including delete, download, share, print, retry, save, upload, external-page, and start-over actions. The migration keeps product-specific attendee action colors as a documented exception while moving repeated shape, focus, disabled, and icon rules into the shared system.

**Tech stack:** Astro 7, React 19, TypeScript 6, Tailwind CSS 4, class-variance-authority, Lucide React, Vitest, Testing Library

---

## File map

**Create**

- `test/button.spec.tsx`: shared variant, size, and `asChild` contract tests.

**Modify**

- `src/components/ui/button.tsx`: canonical variants and the 44px icon size.
- `src/components/steps/GeneratingStep.tsx`: migrate the only explicit `default` variant value before removing that name.
- `src/components/Navbar.astro`: shared outline icon controls and Lucide sound/theme icons.
- `src/components/admin/AdminNavbar.astro`: shared outline icon controls and Lucide menu/close/theme icons.
- Enabled shared buttons use a pointer cursor. Navbar utility icons use a 200ms primary-color hover treatment with 110% scale and 4-degree rotation, disabled under reduced motion.
- `src/components/admin/EventDeleteControl.tsx`: destructive-outline trigger with `Trash2`.
- `src/components/admin/EventTable.astro`: outline edit links with `Pencil`.
- `src/pages/admin/events/index.astro`: primary new-event link with `Plus`.
- `src/pages/admin/events/new.astro`: shared primary submit styling.
- `src/pages/admin/events/[slug].astro`: shared event, watermark, prompt, scene, navigation, and retry controls.
- `src/components/admin/AdminFilters.astro`: shared outline reset link.
- `src/components/admin/SessionTable.astro`: shared outline pagination links.
- `src/components/admin/OperationsDashboard.tsx`: shared outline retry action with `RefreshCw`.
- `src/components/admin/PrintHistory.tsx`: icons for queue and retry actions.
- `src/components/steps/CameraStep.tsx`: icons for camera recovery, capture, use, and retake actions.
- `src/components/steps/GeneratingStep.tsx`: retry and recovery icons after the canonical variant migration.
- `src/components/steps/SceneStep.tsx`: keep scene-card selection behavior and normalize the Continue action only.
- `src/pages/p/[sessionId].astro`: Lucide Download, Share2, and RotateCcw icons.
- `src/components/AttendeePrintControl.tsx`: Lucide Printer icon.
- `src/pages/index.astro`: shared large primary link.
- `src/pages/500.astro`: shared large primary and outline links.
- `src/components/EventNotFound.astro`: shared large primary link.
- `src/pages/admin/sessions/[sessionId].astro`: shared outline back/retry links.
- `src/pages/admin/index.astro`: shared outline retry link.
- `test/sound.spec.ts`: verify the public navbar keeps sound hooks and Lucide imports.
- `test/admin-navbar.spec.ts`: verify mobile behavior plus Lucide and shared-style hooks.
- `test/admin-event-delete.spec.tsx`: verify the destructive-outline trigger and icon without weakening behavior assertions.
- `test/admin-event-edit.spec.ts`: verify key admin controls compile with shared variants.
- `test/attendee-print-control.spec.tsx`: verify the print icon while preserving the state-machine assertions.
- `test/public-postcard.spec.ts`: verify Download, Share, and Start over render their required icons.

**Keep unchanged**

- `src/styles/global.css`: current semantic color tokens already support the contract.
- `src/components/Stepper.tsx`: step markers are navigation state, not general-purpose action buttons.
- `src/components/steps/SceneStep.tsx` scene cards: selectable cards keep their purpose-built layout.
- `src/components/admin/ImagePreview.tsx` preview trigger and placeholder illustration: the full image is the existing trigger, not a compact icon control.
- `src/components/admin/PrintHistory.tsx` inline underlined refresh link: keep it as an inline text recovery action.
- `src/components/ui/confirmation-dialog.tsx`, `src/components/ui/alert-dialog.tsx`, and `src/components/ui/popup-overlay.tsx`: their existing shared hierarchy remains valid after the variant rename.

### Task 1: Extend the shared button contract

**Files:**

- Create: `test/button.spec.tsx`
- Modify: `src/components/ui/button.tsx:6-26`
- Modify: `src/components/steps/GeneratingStep.tsx:324`
- Reference: `docs/design/button-system.md`

- [ ] **Step 1: Write the failing shared-contract test**

```tsx
/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button, buttonVariants } from '../src/components/ui/button';

afterEach(cleanup);

describe('Button', () => {
  it('uses primary as the default semantic variant', () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('bg-primary');
    expect(buttonVariants({ variant: 'primary' })).toContain('bg-primary');
  });

  it.each([
    ['secondary', 'bg-secondary'],
    ['outline', 'bg-transparent'],
    ['destructive', 'bg-destructive'],
    ['destructiveOutline', 'text-destructive'],
    ['ghost', 'bg-transparent'],
    ['contrast', 'bg-foreground'],
  ] as const)('renders the %s variant', (variant, expectedClass) => {
    expect(buttonVariants({ variant })).toContain(expectedClass);
  });

  it('uses a 44px icon target', () => {
    expect(buttonVariants({ size: 'icon' })).toContain('size-11');
  });

  it('passes the button contract through Slot', () => {
    render(
      <Button asChild variant="outline">
        <a href="/admin/events">Events</a>
      </Button>,
    );

    const link = screen.getByRole('link', { name: 'Events' });
    expect(link.getAttribute('href')).toBe('/admin/events');
    expect(link.className).toContain('border-border');
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm vitest run test/button.spec.tsx`

Expected: FAIL because `primary`, `outline`, `destructiveOutline`, and `contrast` are not valid variants and the icon size is still `size-12`.

- [ ] **Step 3: Implement the minimal variant contract**

Remove `min-h-12` and `px-6` from the shared base string so each size is complete when Astro calls `buttonVariants` directly. Replace the `variant` and `size` maps plus `defaultVariants` in `src/components/ui/button.tsx` with:

```tsx
variant: {
  primary:
    'border border-current bg-primary text-primary-foreground shadow-[0_12px_35px_color-mix(in_oklch,var(--primary)_20%,transparent)] hover:-translate-y-0.5 hover:bg-primary-hover active:translate-y-0',
  secondary:
    'border border-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground',
  outline:
    'border border-border bg-transparent text-foreground hover:border-primary hover:text-primary',
  destructive:
    'border border-destructive bg-destructive text-destructive-foreground hover:-translate-y-0.5 hover:bg-destructive/90 active:translate-y-0',
  destructiveOutline:
    'border border-destructive/50 bg-transparent text-destructive hover:border-destructive hover:bg-destructive/10 hover:text-destructive',
  ghost: 'bg-transparent px-2 text-muted-foreground hover:text-foreground',
  contrast:
    'border border-foreground bg-foreground text-background hover:-translate-y-0.5 hover:opacity-90 active:translate-y-0',
},
size: {
  default: 'min-h-12 px-6',
  sm: 'min-h-11 px-4 text-xs',
  lg: 'min-h-14 px-8 text-base',
  icon: 'size-11 p-0',
},
```

Set the default variant:

```tsx
defaultVariants: {
  variant: 'primary',
  size: 'default',
},
```

Do not add a `default` alias. The repository has no external callers. Before running the type check, replace the only explicit value in `src/components/steps/GeneratingStep.tsx`:

```tsx
variant={issue.kind === 'terminal' && issue.code === 'photo_rejected' ? 'primary' : 'secondary'}
```

- [ ] **Step 4: Run the focused test and type check**

Run: `pnpm vitest run test/button.spec.tsx test/generating-step-errors.spec.tsx && pnpm check`

Expected: PASS with no TypeScript or Astro diagnostics.

- [ ] **Step 5: Commit the shared contract**

```bash
git add docs/design/button-system.md test/button.spec.tsx src/components/ui/button.tsx src/components/steps/GeneratingStep.tsx
git commit -m "feat: define button and icon system"
```

### Task 2: Migrate persistent navbar controls

**Files:**

- Modify: `src/components/Navbar.astro:1-38`
- Modify: `src/components/admin/AdminNavbar.astro:1-96`
- Modify: `test/sound.spec.ts`
- Modify: `test/admin-navbar.spec.ts`

- [ ] **Step 1: Add failing source-contract tests**

Append this test to `test/sound.spec.ts` and add `readFile` plus `NodeURL` imports:

```ts
it('uses the shared outline icon controls and Lucide sound icons', async () => {
  const source = await readFile(new NodeURL('../src/components/Navbar.astro', import.meta.url), 'utf8');

  expect(source).toContain("import { Moon, Sun, Volume2, VolumeX } from 'lucide-react'");
  expect(source).toContain("buttonVariants({ variant: 'outline', size: 'icon' })");
  expect(source).toContain('data-sound-on-icon');
  expect(source).toContain('data-sound-off-icon');
  expect(source).toContain('hover:text-primary');
  expect(source).toContain('hover:[&_svg]:scale-110');
  expect(source).toContain('hover:[&_svg]:rotate-[4deg]');
  expect(source).not.toContain('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"');
});
```

Append this test inside `describe('admin mobile navigation')`:

```ts
it('uses shared outline icon controls and Lucide navbar icons', async () => {
  const source = await readFile(new NodeURL('../src/components/admin/AdminNavbar.astro', import.meta.url), 'utf8');

  expect(source).toContain("import { Menu, Moon, Sun, X } from 'lucide-react'");
  expect(source).toContain("buttonVariants({ variant: 'outline', size: 'icon' })");
  expect(source).toContain('data-admin-menu-toggle');
  expect(source).toContain('data-admin-menu-close');
  expect(source).toContain('hover:text-primary');
  expect(source).toContain('hover:[&_svg]:scale-110');
  expect(source).toContain('hover:[&_svg]:rotate-[4deg]');
  expect(source).not.toContain('<path d="M4 6h16M4 12h16M4 18h16"');
  expect(source).not.toContain('<path d="M6 6l12 12M18 6 6 18"');
});
```

- [ ] **Step 2: Run the navbar tests and verify failure**

Run: `pnpm vitest run test/sound.spec.ts test/admin-navbar.spec.ts`

Expected: FAIL because both Astro components still contain hand-authored SVGs and ad hoc classes.

- [ ] **Step 3: Replace public navbar SVGs and classes**

Add a frontmatter block to `src/components/Navbar.astro`:

```astro
---
import { Moon, Sun, Volume2, VolumeX } from 'lucide-react';

import { buttonVariants } from './ui/button';
import { cn } from '../lib/utils';
---
```

Set both button classes with:

```astro
class={cn(
  buttonVariants({ variant: 'outline', size: 'icon' }),
  'text-muted-foreground hover:text-foreground',
)}
```

Keep the public sound button's responsive margin as an additional class. Replace the four SVGs with:

```astro
<Volume2 data-sound-on-icon aria-hidden="true" />
<VolumeX className="hidden" data-sound-off-icon aria-hidden="true" />
<Sun className="hidden" data-theme-light-icon aria-hidden="true" />
<Moon data-theme-dark-icon aria-hidden="true" />
```

Keep all existing `data-*`, `aria-*`, `title`, and screen-reader label attributes.

- [ ] **Step 4: Replace admin navbar SVGs and classes**

Add these imports in `src/components/admin/AdminNavbar.astro`:

```astro
import { Menu, Moon, Sun, X } from 'lucide-react';
import { buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';
```

Use `cn(buttonVariants({ variant: 'outline', size: 'icon' }), overrides)` for menu, close, and theme buttons. The menu trigger must pass `'hidden text-muted-foreground max-[800px]:inline-flex'` as its override so the base `inline-flex` does not make it visible on desktop. Replace the SVGs with:

Add `cursor-pointer` to the shared button base. On navbar icon controls, add `hover:text-primary`, transition nested SVG transforms for 200ms, scale nested SVGs to 110%, rotate them 4 degrees on hover, and restore scale and rotation under `motion-reduce`.

```astro
<Menu aria-hidden="true" />
<X aria-hidden="true" />
<Sun className="hidden" data-theme-light-icon aria-hidden="true" />
<Moon data-theme-dark-icon aria-hidden="true" />
```

Do not change the inline menu script or its selectors.

- [ ] **Step 5: Run focused tests**

Run: `pnpm vitest run test/sound.spec.ts test/admin-navbar.spec.ts test/admin-layout.spec.ts`

Expected: PASS, including the existing mobile-menu focus and overflow behavior.

- [ ] **Step 6: Commit persistent controls**

```bash
git add src/components/Navbar.astro src/components/admin/AdminNavbar.astro test/sound.spec.ts test/admin-navbar.spec.ts
git commit -m "refactor: standardize navbar controls"
```

### Task 3: Migrate admin event actions

**Files:**

- Modify: `src/components/admin/EventDeleteControl.tsx:1-57`
- Modify: `src/components/admin/EventTable.astro:1-65`
- Modify: `src/pages/admin/events/index.astro`
- Modify: `src/pages/admin/events/new.astro`
- Modify: `src/pages/admin/events/[slug].astro:1-246`
- Modify: `test/admin-event-delete.spec.tsx`
- Modify: `test/admin-event-edit.spec.ts`
- Test: `test/admin-events-list.spec.ts`
- Test: `test/admin-event-create.spec.ts`
- Test: `test/admin-scenes.spec.ts`
- Test: `test/admin-scene-editor.spec.ts`
- Test: `test/admin-watermark.spec.ts`

- [ ] **Step 1: Add failing event-control assertions**

In `test/admin-event-delete.spec.tsx`, capture the render result and assert the trigger contract:

```tsx
const { container } = render(
  <EventDeleteControl eventName="Demo Event" endpoint="/api/admin/events/demo-event" />,
);

const trigger = screen.getByRole('button', { name: 'Delete event' });
expect(trigger.className).toContain('border-destructive/50');
expect(container.querySelector('svg.lucide-trash-2')).toBeTruthy();
```

In the compile test in `test/admin-event-edit.spec.ts`, add source assertions after reading the editor source:

```ts
expect(source).toContain("import { ExternalLink, Plus, Save, Upload, X } from 'lucide-react'");
expect(source).toContain("buttonVariants({ variant: 'primary'");
expect(source).toContain("buttonVariants({ variant: 'outline'");
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm vitest run test/admin-event-delete.spec.tsx test/admin-event-edit.spec.ts`

Expected: FAIL because the trigger still composes `secondary` with overrides and the Astro page has no shared imports.

- [ ] **Step 3: Use the destructive-outline trigger**

Update `EventDeleteControl.tsx`:

```tsx
import { Trash2 } from 'lucide-react';
```

Replace the trigger props and children with:

```tsx
<Button
  ref={triggerRef}
  type="button"
  variant="destructiveOutline"
  onClick={showDialog}
>
  <Trash2 aria-hidden="true" />
  Delete event
</Button>
```

Keep the confirmed dialog action as `variant="destructive"` in `ConfirmationDialog`.

- [ ] **Step 4: Normalize event list and create actions**

In Astro frontmatter, import `Pencil` or `Plus` from `lucide-react` and `buttonVariants` from the relative shared path. Use these exact action shapes:

```astro
<a class={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/admin/events/${encodeURIComponent(event.slug)}`}>
  <Pencil aria-hidden="true" />
  Edit
</a>
```

```astro
<a slot="actions" class={buttonVariants({ variant: 'primary', size: 'sm' })} href="/admin/events/new">
  <Plus aria-hidden="true" />
  New event
</a>
```

```astro
<button class={buttonVariants({ variant: 'primary' })} type="submit">Create draft event</button>
```

- [ ] **Step 5: Normalize event-editor actions without changing forms**

Import:

```astro
import { ExternalLink, Plus, Save, Upload, X } from 'lucide-react';
import { buttonVariants } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
```

Apply these contracts to the existing controls while preserving IDs, types, names, form methods, hidden conditions, and hrefs:

```astro
<button class={buttonVariants({ variant: 'primary', size: 'sm' })} type="submit">
  {event.watermark_image_key ? <Save aria-hidden="true" /> : <Upload aria-hidden="true" />}
  {event.watermark_image_key ? 'Save watermark' : 'Upload watermark'}
</button>
```

```astro
<button
  class={cn(buttonVariants({ variant: 'destructiveOutline', size: 'sm' }), !event.watermark_image_key && 'hidden')}
  id="remove-watermark"
  type="button"
>
  <X aria-hidden="true" />
  Remove watermark
</button>
```

```astro
<button class={buttonVariants({ variant: 'primary' })} type="submit">
  <Save aria-hidden="true" />
  Save event
</button>
```

```astro
<a
  class={cn(buttonVariants({ variant: 'outline' }), event.status !== 'active' && 'hidden')}
  id="attendee-page-link"
  href={`/e/${encodeURIComponent(event.slug)}`}
>
  <ExternalLink aria-hidden="true" />
  View attendee page
</a>
```

Use `Save` for Save prompts and Save scene. Use `Plus` for Add scene. Use `outline` for Retry and Back to events. Do not add duplicate or scene-delete controls because those behaviors do not exist.

- [ ] **Step 6: Run the admin event suites**

Run: `pnpm vitest run test/admin-event-delete.spec.tsx test/admin-event-edit.spec.ts test/admin-events-list.spec.ts test/admin-event-create.spec.ts test/admin-scenes.spec.ts test/admin-scene-editor.spec.ts test/admin-watermark.spec.ts`

Expected: PASS with unchanged form and deletion behavior.

- [ ] **Step 7: Commit admin event controls**

```bash
git add src/components/admin/EventDeleteControl.tsx src/components/admin/EventTable.astro src/pages/admin/events/index.astro src/pages/admin/events/new.astro 'src/pages/admin/events/[slug].astro' test/admin-event-delete.spec.tsx test/admin-event-edit.spec.ts
git commit -m "refactor: standardize admin event actions"
```

### Task 4: Migrate admin operations and navigation actions

**Files:**

- Modify: `src/components/admin/AdminFilters.astro`
- Modify: `src/components/admin/SessionTable.astro`
- Modify: `src/components/admin/OperationsDashboard.tsx`
- Modify: `src/components/admin/PrintHistory.tsx`
- Modify: `src/pages/admin/index.astro`
- Modify: `src/pages/admin/sessions/[sessionId].astro`
- Test: `test/admin-dashboard.spec.ts`
- Test: `test/admin-filters.spec.ts`
- Test: `test/admin-session-detail.spec.ts`
- Test: `test/admin-polling.spec.tsx`
- Test: `test/admin-print-history.spec.tsx`

- [ ] **Step 1: Add focused visual-contract assertions to existing component tests**

Add assertions next to the existing behavior checks:

```tsx
expect(screen.getByRole('button', { name: /retry/i }).querySelector('svg')).toBeTruthy();
expect(screen.getByRole('button', { name: /print/i }).querySelector('svg')).toBeTruthy();
```

For Astro source tests, assert that the file imports and calls `buttonVariants`:

```ts
expect(source).toContain("import { buttonVariants } from '../../components/ui/button'");
expect(source).toContain("buttonVariants({ variant: 'outline'");
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm vitest run test/admin-dashboard.spec.ts test/admin-filters.spec.ts test/admin-session-detail.spec.ts test/admin-polling.spec.tsx test/admin-print-history.spec.tsx`

Expected: FAIL on the new shared-style and SVG assertions.

- [ ] **Step 3: Normalize Astro links**

Import `buttonVariants` at the correct relative path in each Astro file. Replace repeated bordered-pill classes with:

```astro
class={buttonVariants({ variant: 'outline', size: 'sm' })}
```

Apply this to Reset, Previous, Next, Retry, Back to dashboard, and Back to events links. Preserve page query strings, hrefs, and conditional text.

- [ ] **Step 4: Normalize React operation controls**

Use existing `Button` imports. Add direct Lucide imports:

```tsx
import { Printer, RefreshCw, RotateCcw } from 'lucide-react';
```

Use the following patterns at the current handlers:

```tsx
<Button variant="outline" type="button" onClick={() => setRetrySequence((value) => value + 1)}>
  <RefreshCw aria-hidden="true" />
  Retry
</Button>
```

```tsx
<Button type="button" disabled={actionsDisabled} onClick={() => mutate('queue')} aria-label={queueLabel}>
  <Printer aria-hidden="true" />
  {queueLabel}
</Button>
```

```tsx
<Button variant="secondary" type="button" disabled={actionsDisabled} onClick={() => mutate('retry', job.id)} aria-label={`Retry failed print requested ${formattedTime(job.createdAt)}`}>
  <RotateCcw aria-hidden="true" />
  Retry
</Button>
```

Leave `ImagePreview` unchanged. Its full image is the overlay trigger, and the inline SVG is a non-action placeholder illustration allowed by the design contract.

- [ ] **Step 5: Run the admin operation suites**

Run: `pnpm vitest run test/admin-dashboard.spec.ts test/admin-filters.spec.ts test/admin-session-detail.spec.ts test/admin-polling.spec.tsx test/admin-print-history.spec.tsx`

Expected: PASS with unchanged polling, pagination, retry, and overlay behavior.

- [ ] **Step 6: Commit admin operation controls**

```bash
git add src/components/admin/AdminFilters.astro src/components/admin/SessionTable.astro src/components/admin/OperationsDashboard.tsx src/components/admin/PrintHistory.tsx src/pages/admin/index.astro 'src/pages/admin/sessions/[sessionId].astro'
git commit -m "refactor: standardize admin operation actions"
```

### Task 5: Migrate attendee flow and postcard actions

**Files:**

- Modify: `src/components/steps/CameraStep.tsx`
- Modify: `src/components/steps/GeneratingStep.tsx`
- Modify: `src/components/steps/SceneStep.tsx`
- Modify: `src/pages/p/[sessionId].astro`
- Modify: `src/components/AttendeePrintControl.tsx`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/500.astro`
- Modify: `src/components/EventNotFound.astro`
- Modify: `test/attendee-print-control.spec.tsx`
- Test: `test/generation-errors.spec.ts`
- Test: `test/generating-step-errors.spec.tsx`
- Test: `test/photobooth-recovery-focus.spec.tsx`
- Test: `test/public-postcard.spec.ts`
- Test: `test/public-500.spec.ts`

- [ ] **Step 1: Add failing icon assertions**

Add to `test/attendee-print-control.spec.tsx`:

```tsx
it('renders a Lucide icon without changing the accessible label', () => {
  const { container } = render(<AttendeePrintControl eventId={7} sessionId={sessionId} />);

  expect(screen.getByRole('button', { name: 'Print postcard' })).toBeTruthy();
  expect(container.querySelector('svg.lucide-printer')).toBeTruthy();
});
```

Add source assertions to the existing postcard and generation suites:

```ts
expect(source).toContain("import { Download, RotateCcw, Share2 } from 'lucide-react'");
expect(source).toContain('<Download aria-hidden="true" />');
expect(source).toContain('<Share2 aria-hidden="true" />');
expect(source).toContain('<RotateCcw aria-hidden="true" />');
expect(source).not.toContain('<circle cx="18" cy="5" r="3"');
expect(source).not.toContain('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"');
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm vitest run test/attendee-print-control.spec.tsx test/generating-step-errors.spec.tsx test/public-postcard.spec.ts`

Expected: FAIL because the postcard and print controls still use manual SVGs.

- [ ] **Step 3: Replace postcard and print SVGs with Lucide**

Add to `src/pages/p/[sessionId].astro`:

```astro
import { Download, RotateCcw, Share2 } from 'lucide-react';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '../../lib/utils';
```

Compose the shared mechanics with the approved context colors:

```astro
const downloadActionClasses = cn(
  buttonVariants({ variant: 'primary' }),
  'border-transparent bg-[oklch(78%_.14_210)] text-[oklch(16%_.025_55)] hover:rotate-[1deg] hover:border-[oklch(84%_.12_210)] hover:bg-[oklch(84%_.12_210)] hover:shadow-[0_.75rem_2rem_oklch(62%_.14_210_/.25)] max-[600px]:w-full',
);
const shareActionClasses = cn(
  buttonVariants({ variant: 'primary' }),
  'cursor-pointer border-[oklch(71%_.2_330)] bg-[oklch(71%_.2_330)] text-[oklch(16%_.025_55)] hover:rotate-[-1deg] hover:border-[oklch(77%_.18_330)] hover:bg-[oklch(77%_.18_330)] hover:shadow-[0_.75rem_2rem_oklch(60%_.2_330_/.28)] max-[600px]:w-full',
);
const startOverActionClasses = cn(
  buttonVariants({ variant: 'primary' }),
  'border-[oklch(82%_.17_85)] bg-[oklch(82%_.17_85)] text-[oklch(16%_.025_55)] hover:rotate-[-.5deg] hover:border-[oklch(88%_.15_85)] hover:bg-[oklch(88%_.15_85)] hover:shadow-[0_.75rem_2rem_oklch(65%_.17_85_/.25)] max-[600px]:w-full',
);
```

Apply those constants to the existing controls, then replace only the three manual SVGs:

```astro
<Download aria-hidden="true" />
<Share2 aria-hidden="true" />
<RotateCcw aria-hidden="true" />
```

Keep all share-script hooks.

Add to `AttendeePrintControl.tsx`:

```tsx
import { Printer } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';
```

Render the existing stateful control through `Button`, preserving its colors and handler:

```tsx
<Button
  className={cn(
    'cursor-pointer border-[oklch(76%_.14_150)] bg-[oklch(76%_.14_150)] text-[oklch(16%_.025_55)] hover:rotate-[.5deg] hover:border-[oklch(82%_.12_150)] hover:bg-[oklch(82%_.12_150)] hover:shadow-[0_.75rem_2rem_oklch(60%_.14_150_/.25)] disabled:cursor-default disabled:opacity-60 max-[600px]:w-full',
  )}
  type="button"
  disabled={disabled}
  onClick={requestPrint}
  aria-label={buttonLabel}
>
  <Printer aria-hidden="true" />
  <span>{buttonLabel}</span>
</Button>
```

The shared `Button` supplies size, focus, disabled pointer behavior, motion, and 16px icon sizing. The color overrides keep the approved green context action.

- [ ] **Step 4: Normalize shared attendee controls**

The `default` to `primary` migration already happened in Task 1. Import and add `RefreshCw` to Retry or Check actions and `ImagePlus` to Choose another photo. Add `Camera`, `Check`, and `RotateCcw` to the corresponding labeled controls in `CameraStep.tsx`. Keep the custom circular shutter button purpose-built because it is a camera control, not a standard button.

Use the existing `Button` in `SceneStep.tsx` without adding icons to scene cards. Keep `Continue` labeled and primary.

For Astro landing and error links, import `buttonVariants` and use:

```astro
class={buttonVariants({ variant: 'primary', size: 'lg' })}
```

Use `variant: 'outline'` for the secondary 500-page link.

- [ ] **Step 5: Run the attendee suites**

Run: `pnpm vitest run test/attendee-print-control.spec.tsx test/generation-errors.spec.ts test/generating-step-errors.spec.tsx test/photobooth-recovery-focus.spec.tsx test/public-postcard.spec.ts test/public-500.spec.ts test/review-entry.spec.ts`

Expected: PASS with unchanged generation recovery, focus, print state, share, and error-page behavior.

- [ ] **Step 6: Commit attendee controls**

```bash
git add src/components/steps/CameraStep.tsx src/components/steps/GeneratingStep.tsx src/components/steps/SceneStep.tsx 'src/pages/p/[sessionId].astro' src/components/AttendeePrintControl.tsx src/pages/index.astro src/pages/500.astro src/components/EventNotFound.astro test/attendee-print-control.spec.tsx test/generating-step-errors.spec.tsx test/public-postcard.spec.ts
git commit -m "refactor: standardize attendee actions"
```

### Task 6: Verify dialogs, responsive behavior, and the complete migration

**Files:**

- Verify: `src/components/ui/confirmation-dialog.tsx`
- Verify: `src/components/ui/alert-dialog.tsx`
- Verify: `src/components/ui/popup-overlay.tsx`
- Verify: all files changed in Tasks 1 through 5

- [ ] **Step 1: Search for retired or duplicated patterns**

Run:

```bash
rg -n -U "variant\s*=\s*['\"]default['\"]|variant\s*:\s*['\"]default['\"]|\?\s*['\"]default['\"]\s*:\s*['\"]secondary['\"]" src/components src/pages
```

Expected: no matches.

Run:

```bash
rg -n "<svg" src/components/Navbar.astro src/components/admin/AdminNavbar.astro 'src/pages/p/[sessionId].astro' src/components/AttendeePrintControl.tsx src/components/admin/EventDeleteControl.tsx
```

Expected: no matches. This search is intentionally limited to files where every inline SVG was an action icon.

Build a complete action inventory rather than searching for a few visual classes:

```bash
rg -n "<button|<Button|buttonVariants\(" src/components src/pages
rg -n -U "<a[^>]*(class|className|class:list)=[^>]*>" src/components src/pages
rg -n -U "<Button[^>]*className=" src/components src/pages
rg -n "ActionClasses|buttonVariants\(" src/components src/pages
```

Expected: inspect every result. Every user action must use `Button`, `buttonVariants`, or one explicit exception from the File map's Keep unchanged section. Every `ActionClasses` helper must compose `buttonVariants` through `cn`. Plain navigation links without button styling are not action controls. Add any newly discovered exception to `docs/design/button-system.md` before accepting it.

For every existing action named in the design contract's icon table, verify the rendered control includes the exact mapped Lucide icon. In particular, delete uses `Trash2`, download uses `Download`, share uses `Share2`, print uses `Printer`, retry uses `RefreshCw` or the documented retry-state `RotateCcw`, save uses `Save`, upload uses `Upload`, external-page uses `ExternalLink`, and start over uses `RotateCcw`. Do not count an import alone as verification; the icon must be rendered inside the matching control without replacing its visible label.

- [ ] **Step 2: Run all automated verification**

Run: `pnpm test`

Expected: all app and print-agent tests pass.

Run: `pnpm check`

Expected: Wrangler type generation and Astro checks pass.

Run: `pnpm build`

Expected: production build completes successfully.

- [ ] **Step 3: Run the desktop browser smoke**

Start the foreground server with `pnpm dev`, then verify:

1. `/` has the large brand CTA and working sound/theme icon controls.
2. `/admin/events` shows a primary New event action and outline Edit actions.
3. `/admin/events/new` submits with the shared primary treatment.
4. `/admin/events/<existing-slug>` preserves tabs and forms; Save, Upload, Remove, Add scene, View attendee page, and Delete event have the intended hierarchy.
5. The delete dialog restores focus on Cancel and keeps the confirmed action destructive.
6. `/admin` polling and retry controls still work.
7. A completed `/p/<session-id>` keeps distinct Download, Share, Print, and Start over colors and behavior.
8. Keyboard navigation shows a visible focus ring on every action.

- [ ] **Step 4: Run the narrow-screen browser smoke**

At 390px width, verify:

1. Public and admin navbar controls remain at least 44px square.
2. The admin menu opens, traps focus, closes with Escape, and restores focus.
3. Labeled action rows wrap or stack without clipping.
4. Postcard actions become full width and retain their text labels.
5. No icon is the only source of destructive meaning.

- [ ] **Step 5: Commit any verification-only fixes**

Stage only files changed to fix failures found in Steps 1 through 4, then commit:

```bash
git add <verified-fix-files>
git commit -m "fix: resolve button migration regressions"
```

Skip this commit when verification required no fixes.

## Done criteria

- The shared component exposes `primary`, `secondary`, `outline`, `destructive`, `destructiveOutline`, `ghost`, and `contrast`.
- `size="icon"` is 44px square.
- Action icons use `lucide-react`; manual SVGs remain only for non-action illustrations.
- Every existing mapped action renders its required icon, including Delete, Download, Share, Print, Retry, Save, Upload, External page, and Start over.
- Existing user-visible labels, accessible names, form behavior, links, scripts, and handlers are unchanged.
- Attendee postcard actions keep their approved context colors.
- No new edit, duplicate, or delete capability is introduced.
- `pnpm test`, `pnpm check`, and `pnpm build` pass.
- Desktop and 390px browser smoke checks pass.
