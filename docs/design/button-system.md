# Button and icon system

## Purpose

Use one action hierarchy across the Astro and React UI. The shared `Button` component and `buttonVariants` function own control shape, spacing, focus, disabled state, motion, and icon sizing. Individual screens choose the semantic variant and label.

## Action model

- Keep a text label on prominent, unfamiliar, or risky actions.
- Every existing button or button-styled link whose action appears in the icon table must render the mapped Lucide icon. This includes delete, download, share, print, retry, save, upload, external-page, and start-over actions.
- Use icon-only controls only for compact, familiar utilities such as menu, close, sound, theme, edit, or zoom.
- Give every icon-only control an `aria-label` and `title` when the action benefits from a hover hint.
- Keep icon-only pointer targets at least 44 by 44 pixels.
- Show a pointer cursor on enabled buttons and button-styled links.
- Use `lucide-react` for action icons in both React and Astro. Do not add hand-authored SVGs or another icon package.

## Variants

| Variant | Visual contract | Use |
| --- | --- | --- |
| `primary` | Brand fill with the existing lift and shadow | One main action in a section or step |
| `secondary` | Neutral filled surface | An alternative action with comparable prominence |
| `outline` | Transparent surface with the standard border | Navigation, links, and persistent controls |
| `destructive` | Danger fill | The confirmed destructive action inside a dialog |
| `destructiveOutline` | Danger border and text | The entry point to a destructive flow |
| `ghost` | No border or fill | A low-emphasis inline utility |
| `contrast` | Foreground fill with background text | Explicit black/white emphasis independent of the brand color |

`primary` is the canonical name for the default brand action. `contrast` is not a replacement for `primary`.

## Sizes

| Size | Minimum target | Use |
| --- | --- | --- |
| `sm` | 44px high | Dense labeled controls |
| `default` | 48px high | Standard labeled controls |
| `lg` | 56px high | High-emphasis attendee calls to action |
| `icon` | 44px square | Compact icon-only controls |

Icons inherit the control color. The shared component renders nested SVGs at 16px unless a product-specific context has an approved larger icon.

Navbar utility icons transition to the primary brand color, scale to 110%, and rotate 4 degrees on hover. Apply the motion to the icon rather than the button container, use a 200ms transition, and disable the transform when reduced motion is requested.

## Icon choices

Use the exact mapped Lucide icon for each existing action below. These mappings are requirements, not examples. Keep the visible label on labeled actions and mark its icon with `aria-hidden="true"`.

| Action | Icon |
| --- | --- |
| Add | `Plus` |
| Edit | `Pencil` |
| Delete | `Trash2` |
| Duplicate | `Copy` |
| Save | `Save` |
| Upload | `Upload` |
| External page | `ExternalLink` |
| Retry | `RefreshCw` |
| Download | `Download` |
| Share | `Share2` |
| Print | `Printer` |
| Start over | `RotateCcw` |
| Open menu | `Menu` |
| Close | `X` |
| Sound on | `Volume2` |
| Sound off | `VolumeX` |
| Light theme | `Sun` |
| Dark theme | `Moon` |
| Zoom image | `ZoomIn` |

## Accessibility

- Keep visible labels in the accessible name. Mark decorative icons with `aria-hidden="true"`.
- Give icon-only buttons a specific accessible name such as `Mute sound`, `Open navigation menu`, or `Edit Demo Day`.
- Preserve the existing focus-visible ring and disabled opacity in the shared component.
- Do not communicate destructive intent or state using color alone. Keep the destructive label.
- Update dynamic `aria-label`, `aria-pressed`, and `title` values when a toggle changes state.
- Respect `prefers-reduced-motion` through the existing global motion rule.

## Product exceptions

The attendee postcard actions keep their distinct Download, Share, Print, and Start over accent colors. Those colors help guests distinguish the available outputs. The controls still follow the shared sizing, focus, disabled, label, and Lucide icon rules.

The dark navigation bars are surfaces, not button variants. Sound, theme, menu, and close controls use the `outline` variant and inherit the surrounding theme tokens.

## Non-goals

- Do not add edit, duplicate, or delete capabilities where they do not already exist.
- Do not replace text labels with icons on risky or uncommon actions.
- Do not create a wrapper around Lucide unless repeated behavior, not appearance alone, requires one.
- Do not introduce compatibility aliases for retired internal variant names.
