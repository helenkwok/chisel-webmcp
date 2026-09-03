# Design — Chisel's injected surfaces

Chisel adds three pieces of UI into an application it does not own: a **status badge**, an
**agent activity log**, and a **consent dialog**. Everything here follows from that fact.

## Register

**Product.** The design serves the CAD app; it is not the product. Chisel's UI should look like it
belongs to Chili3d, not like a widget bolted on by a different team.

## The scene

> An engineer at a bright desk, watching an AI agent modify a CAD model in a light-themed desktop
> app, needing to see at a glance what the agent just did and whether it was allowed.

Two things fall out of that sentence:

- **Light theme.** Not a preference. Chili3d is light, and a dark slab floating over it reads as a
  foreign object — which is exactly the wrong signal for a panel whose entire job is to make agent
  behaviour feel accountable and native. The first version got this wrong.
- **Glanceable, not readable.** The engineer is watching a viewport, not the log. Phase and count
  must resolve in peripheral vision; detail is available on inspection.

## Constraint: the host owns the bottom 25px

`CHILI-STATUSBAR` occupies the full width from y=855 to y=880 in an 880px viewport. Anything
anchored to `bottom: 12px` overlaps it by 13px and gets visually clipped — measured, not guessed.

**All floating surfaces sit at `bottom: 37px`** (25px status bar + 12px gap). This is the single
most important number in this file.

## Colour

Strategy: **restrained** — tinted neutrals plus one accent, used sparingly. Chili3d's own accent is
a blue, so neutrals are tinted toward that hue rather than being pure grey. No `#000`, no `#fff`.

```
--surface     oklch(99%  0.004 255)   /* panel ground                       */
--surface-2   oklch(96.5% 0.006 255)  /* rows, inset areas                  */
--line        oklch(90%  0.010 255)   /* hairlines                          */
--ink         oklch(28%  0.020 255)   /* primary text                       */
--muted       oklch(52%  0.015 255)   /* labels, secondary                  */
--accent      oklch(55%  0.190 255)   /* the one accent                     */
--ok          oklch(52%  0.140 155)
--warn        oklch(62%  0.150  75)
--danger      oklch(55%  0.190  25)
```

Phase is carried by a **small dot plus a text label**, not a full-bleed coloured row. Six coloured
blocks stacked vertically is noise; six neutral rows each with one coloured dot is a scannable
list. Colour is the accent, not the substrate.

## Legibility target: a 1080p screen recording

This UI's most important viewing context is a compressed video at reduced scale. Therefore:

- Minimum **12.5px** text, **13px** for anything carrying a number.
- Tool names in monospace with tabular numerals — `affectedCount 4` must not reflow between frames.
- Contrast well past AA: body text is `--ink` on `--surface`, never muted-on-muted.
- No hairline-thin type, no 10px labels, no low-contrast grey-on-grey.

## Bans observed

No side-stripe borders (the reflex choice for a log row — full hairline borders instead). No
glassmorphism. No gradient text. No nested cards. No em dashes in UI copy.

## Motion

Entry only, and only on new rows: 140ms opacity plus a 4px translate, `ease-out-quart`. Nothing
animates layout properties. A log that bounces while an engineer is trying to read it is worse
than a log that appears.
