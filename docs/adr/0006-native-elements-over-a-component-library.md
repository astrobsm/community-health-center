# ADR 0006 — Native HTML elements and hand-authored CSS, not a component library

- **Status:** Accepted — supersedes the Tailwind + Radix choice in `01-technology-stack.md`
- **Date:** 2026-09-14
- **Deciders:** UX/UI Designer, Principal Software Architect

## Context

`01-technology-stack.md` originally specified Tailwind CSS for styling and Radix UI for accessible
primitives, with the reasoning that Radix supplies "accessible, unstyled primitives (WCAG 2.1 AA
keyboard and screen-reader behaviour we must not hand-roll)".

Building the field assessment screen made it clear that argument does not hold for *this* component
set.

## What the app actually needs

The entire Release 2 interface is: text input, number input, date input, select, radio group,
checkbox group, textarea, button, progress meter, and a modal. Every one of those is a native HTML
element with correct keyboard and screen-reader behaviour already built in — including `<dialog>`,
which now has the focus trapping and `::backdrop` support that used to justify a library.

The components a library genuinely earns its place on — combobox, date range picker, virtualised
tree, drag-and-drop — do not appear anywhere in this product.

## Decision

Use native HTML elements with hand-authored CSS driven by custom properties
(`src/design-system/tokens.css`, `base.css`).

## Consequences

**Positive**

- **More accessible, not less.** Radix renders `<div role="radio">` and re-implements arrow-key
  navigation in JavaScript. A native `<input type="radio">` in a `<label>` gets that from the
  platform, works before hydration, works with JavaScript disabled, and cannot drift out of spec.
  Re-implementing platform behaviour is how apps get *less* accessible.
- **Smaller.** The whole stylesheet is 2.4 kB gzipped, and there is no runtime component library at
  all. On the target device — a mid-range Android on metered 3G — that is the difference between an
  app that opens and one that is abandoned.
- **No build plugin.** One fewer thing to version, configure, and debug.
- **The design decisions are visible.** `--touch-field: 48px` and `font-size: max(var(--text-base),
  16px)` sit in one file with the reasoning beside them (gloved thumbs; iOS zooms a focused input
  below 16px and throws the assessor out of their place in a long form). In a utility framework
  those decisions are scattered across class strings.

**Negative**

- **Styling is ours to maintain.** No upstream fixes for browser quirks. Mitigated by keeping the
  surface tiny: two CSS files, no preprocessor, no theming layer.
- **No pre-built complex widgets.** If a genuine combobox or date-range picker is needed later,
  adding a single focused library for it is a smaller commitment than adopting a system now.
- **Less familiar to a Tailwind-fluent hire.** Offset by there being far less to learn: the class
  list is short and documented in one place.

## Revisit criteria

Adopt a primitives library if the product acquires components the platform does not provide —
specifically a combobox with async search, a date-range picker, or drag-and-drop reordering. Until
then, the library would be paying a runtime cost for behaviour we already have.
