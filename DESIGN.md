# GymFlow — design system

## The scene

A dojo entrance hall at 19h. Fluorescent light, a parent waiting, a
receptionist who needs to know whether a child's insurance has lapsed before
the child steps onto the mat. That scene forces **light by default** — a dark
tool under hall lighting, read at arm's length, is the wrong instrument. Dark
mode exists because presidents check takings at night, not as the default pose.

## Colour

**Strategy: restrained.** Tinted neutrals, one accent, semantic status colours
kept strictly separate from the brand.

The obvious move for a Moroccan product is a warm cream surface. That is the
saturated cliché, and it is also wrong here: a tinted near-white loses contrast
under fluorescent glare. **The warmth lives in the brand colour; the surface
stays pure.** Stripe is warm and sits on white; so does this.

| Role | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `oklch(1 0 0)` | `oklch(0.16 0 0)` | Page ground |
| `--surface` | `oklch(1 0 0)` | `oklch(0.20 0.004 40)` | Cards, rows |
| `--panel` | `oklch(0.976 0.003 40)` | `oklch(0.175 0.004 40)` | Sidebar, toolbars — the second neutral layer |
| `--ink` | `oklch(0.22 0.008 40)` | `oklch(0.95 0.004 40)` | Body text |
| `--ink-2` | `oklch(0.44 0.010 40)` | `oklch(0.72 0.008 40)` | Secondary text, ≥4.5:1 |
| `--ink-3` | `oklch(0.58 0.010 40)` | `oklch(0.60 0.008 40)` | Labels only, never body |
| `--line` | `oklch(0.918 0.004 40)` | `oklch(0.28 0.006 40)` | Borders |
| `--primary` | `oklch(0.55 0.152 40)` | `oklch(0.70 0.150 43)` | Actions, selection, focus |

Neutrals carry 0.003–0.010 chroma toward the brand's own hue (40°), never
toward generic warmth.

**Semantics are hue-separated from the brand on purpose.** The brand sits at
40° (terracotta). Warning sits at 80° (true amber) and danger at 25° (true
red), far enough apart that a status pill never reads as a button. This matters
more here than in most products: "expiring soon" is the single most frequent
signal on screen.

**Per-club accent.** Each club sets its own `--primary`, injected as a style
attribute on `<html>`. Everything else is fixed, so a club's colour can never
break contrast on text or chrome — it only ever paints buttons, focus rings and
selection.

## Type

One family: `system-ui` stack. Product UI doesn't need a display pairing, and a
system stack renders Arabic correctly without shipping a webfont.

Fixed rem scale, ratio ~1.15: `0.75 / 0.8125 / 0.875 / 1 / 1.125 / 1.3125 /
1.625 / 2`. No clamp — users view at consistent DPI and a fluid heading in a
sidebar looks worse, not better.

`font-variant-numeric: tabular-nums` everywhere digits align: money, counts,
dates, table columns.

## Layout

Sidebar plus content on desktop; the sidebar collapses to a bottom bar under
860px, because a receptionist's phone is held one-handed and thumbs reach the
bottom. Responsive behaviour is structural, never fluid type.

Logical properties throughout — `margin-inline-start`, not `margin-left` — so
Arabic mirrors for free.

## Motion

150–250ms, `ease-out-quart`. Motion reports state: a row saving, a card
picked up, a panel opening. No page-load choreography; the tool loads into a
task. Every transition has a `prefers-reduced-motion` path.

Card dragging animates `transform` only, never grid position, so reordering
stays at 60fps on a mid-range Android.

## Z-index scale

`--z-sticky: 10`, `--z-drag: 20`, `--z-overlay: 30`, `--z-modal: 40`,
`--z-toast: 50`. Never arbitrary values.

## Support mode

When the operator is inside a club, a persistent bar sits above everything, in
danger red, naming the club and whether writing is enabled. It is the one place
the interface deliberately shouts.
