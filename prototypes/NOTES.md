# Prototype verdict

**Question:** What should Media Minimizer's UI/UX look like? (current single flat
white card feels lackluster.)

**Variants:** A Guided Wizard · B Dropzone Hero · C Split Workbench · D Command Bar
· E Conversational. See README.md to run.

## Tested (live, real engine)

All 5 booted the real ffmpeg engine (`Ready (MT-sw)`), zero duplicate IDs, no JS
errors. Ran a real end-to-end PNG minimize through variant A (done in 1.2s, download
enabled). Exercised D's Advanced popover. Reviewed on desktop (A–D) and mobile (E).

## Per-variant

- **A Guided Wizard** — Clearest hierarchy of the five; numbered 1‑2‑3 steps, advanced
  hidden in a `<details>`. Best for first-timers. Con: tall/scrolly; 3 boxed steps is
  heavy for a 3-control tool used repeatedly.
- **B Dropzone Hero** — Most striking first impression; the dropzone *is* the page.
  Con: dark-theme inheritance gap is worst here (result panel renders bright white,
  status notice stays light-blue against the dark hero). Tray feels cramped vs. the
  huge hero above it.
- **C Split Workbench** — Most polished dark theme (drop-zone, selects, inputs, result
  all themed). Great for power users; all advanced settings always visible. Con: right
  "Output" pane is mostly dead space until a conversion runs; overkill for casual use.
  Status notice still light-blue (theme gap).
- **D Command Bar** — Most elegant compact footprint; whole tool on one pill strip,
  advanced in a clean 2-col popover. Light theme = no theming gaps. Con: huge empty
  vertical space below the strip when idle; pill drop-zone is a small drag target.
- **E Conversational** — Warmest, genuinely mobile-native; big pill buttons, friendly
  copy. Con: chat framing is verbose for a 3-control utility; same result-panel theme
  issue inherited.

## Winner

**A's step structure as the backbone, fused with B's hero dropzone for step 1.**
Rationale: A gives non-technical users the clearest path (the stated problem with the
current flat card is *lack of hierarchy*), and B's oversized dropzone makes the primary
action unmissable. Keep it on the **light theme** (D/A) — the dark variants (B, C) look
great but the existing `styles.css` result/status panels aren't themed for dark, which
is real polish debt. Pull **D's Advanced-in-a-popover** instead of A's inline
`<details>` to keep step 2 short.

### Grafts for the real build
- Step 1: B-sized hero dropzone (light-themed), file summary directly under it.
- Step 2: target-size input + **D-style "Advanced ▾" popover** (not a long accordion).
- Step 3: large primary Minimize CTA + Download, progress, status, result.
- Collapse result/progress when empty (see bug below) so step 3 isn't pre-filled with
  "Original: -".

## Bug found (pre-existing, in the REAL app — not prototype-introduced)

`styles.css` `.result { display: grid }` overrides the `hidden` attribute, so the empty
result panel ("Original: - / Output: - …") is **always visible on fresh load** in the
real `index.html`. `app.js` toggles `elements.result.hidden = true/false` (lines 414,
548, 561) expecting it to hide, but author `display:grid` beats UA `[hidden]{display:none}`.
`progressWrap` hides correctly only because it has no competing `display` rule.
Fix when folding in the winner: add `.result[hidden]{ display:none }` (or gate on a
class). Verified live in both the prototype and `/index.html`.

## Next step

Fold the A+B+D blend into the real `index.html` + `styles.css` (rewrite CSS cleanly —
prototype CSS is throwaway/scoped), fix the `[hidden]` bug, then **delete this whole
`prototypes/` folder**.
