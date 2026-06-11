// PROTOTYPE — throwaway. Five radically different UI/UX layouts over the SAME
// core (drop file -> set max size -> minimize -> download, plus advanced video
// controls). Each variant renders the canonical control IDs from snippets.js
// exactly once so the untouched ../app.js engine binds and runs for real.
//
// Run: see prototypes/README.md. Switch with ?variant=A..E (floating bottom bar).

import * as s from "./snippets.js";

// ---------------------------------------------------------------------------
// A — Guided Wizard. One decision at a time, numbered steps, big primary CTA.
//     Hides density; ideal for first-time / non-technical users.
// ---------------------------------------------------------------------------
function variantA() {
    return `
    <div class="vA">
        <header class="vA-top">
            <div>
                <h1>Media Minimizer</h1>
                <p class="vA-sub">Shrink a video or image — right here, nothing uploaded.</p>
            </div>
            ${s.engineBadge()}
        </header>

        <ol class="vA-steps">
            <li class="vA-step">
                <span class="vA-num">1</span>
                <div class="vA-body">
                    <h2>Pick your file</h2>
                    ${s.dropZone()}
                    ${s.fileSummary()}
                </div>
            </li>

            <li class="vA-step">
                <span class="vA-num">2</span>
                <div class="vA-body">
                    <h2>Choose a target size</h2>
                    <p class="vA-hint">We'll get as close as possible without going over.</p>
                    ${s.maxSize({ label: "Maximum file size (MB)" })}
                    <details class="vA-advanced">
                        <summary>Fine-tune quality (optional)</summary>
                        <div class="vA-advanced-head">
                            <p class="vA-hint">Everything defaults to Auto.</p>
                            ${s.advancedResetBtn()}
                        </div>
                        <div class="vA-advanced-grid">${s.advancedFields()}</div>
                    </details>
                </div>
            </li>

            <li class="vA-step">
                <span class="vA-num">3</span>
                <div class="vA-body">
                    <h2>Minimize &amp; download</h2>
                    <div class="vA-cta">
                        ${s.minimizeBtn("btn-lg")}
                        ${s.downloadBtn("btn-lg")}
                    </div>
                    ${s.progress()}
                    ${s.status()}
                    ${s.result()}
                </div>
            </li>
        </ol>
    </div>`;
}

// ---------------------------------------------------------------------------
// B — Dropzone Hero. The drop target IS the page. Drag-first, near-zero chrome.
//     Controls float in over the hero once you engage. Bold, modern, dark.
// ---------------------------------------------------------------------------
function variantB() {
    return `
    <div class="vB">
        <div class="vB-hero">
            <div class="vB-badge-wrap">${s.engineBadge()}</div>
            ${s.dropZone({ title: "Drop a file to minimize", note: "video or image — or click anywhere here" })}
        </div>

        <div class="vB-tray">
            <div class="vB-tray-row">
                ${s.fileSummary()}
            </div>
            <div class="vB-tray-row vB-actions">
                <div class="vB-size">${s.maxSize({ label: "Target (MB)" })}</div>
                ${s.minimizeBtn("btn-lg")}
                ${s.downloadBtn("btn-lg")}
                <details class="vB-pop">
                    <summary class="btn btn-secondary">Advanced ▾</summary>
                    <div class="vB-pop-panel">
                        <div class="vB-pop-head">
                            <strong>Fine-tune</strong>${s.advancedResetBtn()}
                        </div>
                        <div class="vB-pop-grid">${s.advancedFields()}</div>
                    </div>
                </details>
            </div>
            ${s.progress()}
            ${s.status()}
            ${s.result()}
        </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// C — Split Workbench. Two-pane desktop tool: left = input + settings,
//     right = live output / engine. Persistent settings, pro density, dark.
// ---------------------------------------------------------------------------
function variantC() {
    return `
    <div class="vC">
        <header class="vC-bar">
            <h1>Media Minimizer</h1>
            <span class="vC-tag">workbench</span>
            ${s.engineBadge()}
        </header>
        <div class="vC-grid">
            <section class="vC-pane vC-left">
                <h3 class="vC-h">Source</h3>
                ${s.dropZone()}
                ${s.fileSummary()}

                <h3 class="vC-h">Settings</h3>
                ${s.maxSize()}
                <div class="vC-fields">${s.advancedFields()}</div>
                <div class="vC-reset">${s.advancedResetBtn("")}</div>
            </section>

            <section class="vC-pane vC-right">
                <h3 class="vC-h">Output</h3>
                <div class="vC-actions">
                    ${s.minimizeBtn()}
                    ${s.downloadBtn()}
                </div>
                ${s.progress()}
                ${s.status()}
                ${s.result()}
            </section>
        </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// D — Compact Command Bar. Everything on one dense horizontal strip for
//     power users. Advanced lives in a popover. Minimal vertical footprint.
// ---------------------------------------------------------------------------
function variantD() {
    return `
    <div class="vD">
        <div class="vD-bar">
            <span class="vD-logo">⚡ Minimizer</span>
            <div class="vD-drop">${s.dropZone({ title: "Drop / click", note: "video or image" })}</div>
            <div class="vD-size">${s.maxSize({ label: "MB" })}</div>
            <details class="vD-pop">
                <summary class="btn btn-secondary btn-compact">Advanced ▾</summary>
                <div class="vD-pop-panel">
                    <div class="vD-pop-head"><strong>Advanced</strong>${s.advancedResetBtn()}</div>
                    <div class="vD-pop-grid">${s.advancedFields()}</div>
                </div>
            </details>
            ${s.minimizeBtn("btn-compact")}
            ${s.downloadBtn("btn-compact")}
            ${s.engineBadge()}
        </div>
        <div class="vD-stage">
            <div class="vD-file">${s.fileSummary()}</div>
            ${s.progress()}
            ${s.status()}
            ${s.result()}
        </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// E — Conversational. A friendly chat-style flow; each prompt is a "message",
//     controls sit inside bubbles. Mobile-first, warm, approachable.
// ---------------------------------------------------------------------------
function variantE() {
    return `
    <div class="vE">
        <div class="vE-head">
            <div class="vE-avatar">🗜️</div>
            <div>
                <strong>Media Minimizer</strong>
                <div class="vE-status-line">${s.engineBadge()}</div>
            </div>
        </div>

        <div class="vE-thread">
            <div class="vE-msg vE-bot">
                <p>Hi! Drop a video or image and I'll shrink it — all on your device.</p>
                ${s.dropZone({ title: "Tap to add a file", note: "or drop it here" })}
                ${s.fileSummary()}
            </div>

            <div class="vE-msg vE-bot">
                <p>How small should it get?</p>
                ${s.maxSize({ label: "Target size (MB)" })}
                <details class="vE-advanced">
                    <summary>Want to tweak quality?</summary>
                    <div class="vE-advanced-head">${s.advancedResetBtn()}</div>
                    <div class="vE-advanced-grid">${s.advancedFields()}</div>
                </details>
            </div>

            <div class="vE-msg vE-bot">
                <p>Ready when you are.</p>
                <div class="vE-cta">
                    ${s.minimizeBtn()}
                    ${s.downloadBtn()}
                </div>
                ${s.progress()}
            </div>

            <div class="vE-msg vE-sys">
                ${s.status()}
                ${s.result()}
            </div>
        </div>
    </div>`;
}

export const VARIANTS = {
    A: { name: "Guided Wizard", render: variantA },
    B: { name: "Dropzone Hero", render: variantB },
    C: { name: "Split Workbench", render: variantC },
    D: { name: "Command Bar", render: variantD },
    E: { name: "Conversational", render: variantE },
};
