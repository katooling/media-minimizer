# UI Prototypes — THROWAWAY

> **Question this answers:** "What should Media Minimizer's UI/UX look like?"
> Five radically different layouts over the **same core** (drop file → set max
> size → minimize → download, plus advanced video controls), switchable live.

This is a prototype (prototype skill, sub-shape B). It does **not** touch the real
app — `index.html`, `app.js`, and `styles.css` are untouched. Each variant injects
the canonical control IDs that `app.js` binds to, then imports the **real** engine,
so every variant actually converts files for real.

## How to run

From the repo root, start any static server and open the prototype route:

```bash
# one command — pick whichever you have
python3 -m http.server 8099
# then open:
#   http://localhost:8099/prototypes/prototype.html
```

(Any static server works; the app is client-only. A plain file:// open will NOT
work — ES modules + the ffmpeg engine need http.)

## Switching variants

- Floating pill at bottom-center: **‹ / ›** to cycle.
- Keyboard **←** / **→** (ignored while typing in a field).
- Or set the URL param directly: `?variant=A` … `?variant=E`. Shareable + reload-stable.
- The switcher is hidden from the real app (it only exists on this route).

| Key | Name | The idea | Best for |
|-----|------|----------|----------|
| **A** | Guided Wizard | Numbered 1‑2‑3 steps, one decision at a time, advanced tucked away. | First-time / non-technical users. |
| **B** | Dropzone Hero | Dark, drag-first; the drop target *is* the page. Controls in a floating tray. | "Just drag and go." Marketing-grade landing feel. |
| **C** | Split Workbench | Two-pane desktop tool: inputs+settings left, live output right. Dense, dark. | Power users doing repeated conversions. |
| **D** | Command Bar | Everything on one compact horizontal strip; advanced in a popover. | Minimal footprint, fast repeat use. |
| **E** | Conversational | Friendly chat bubbles, mobile-first, warm tone. | Casual / mobile users who want hand-holding. |

## Verified

- All 5 boot the real engine (`Engine: Ready`), no duplicate IDs, no JS errors.
- End-to-end smoke (variant D, `sample.png`): converted to 35 KB, download enabled. ✅

## When a winner is picked

Fold the chosen layout into the real `index.html` + `styles.css` (rewrite cleanly —
prototype CSS is scoped/throwaway), then **delete this whole `prototypes/` folder**.
Common outcome is a mix — e.g. "A's step structure with B's hero dropzone." Capture
that in `NOTES.md`.
