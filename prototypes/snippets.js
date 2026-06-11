// PROTOTYPE — throwaway. Canonical form controls reused by every UI variant.
//
// app.js binds to these exact element IDs at load (getElementById) and toggles
// classes that styles.css/variant CSS react to. Every variant MUST render this
// full set of IDs once (no duplicates) for the real engine to work. Variants are
// free to place/wrap/restyle them however they like — only the IDs are fixed.

export const ADVANCED_FIELDS = [
    {
        id: "advancedSpeedSelect",
        label: "Processing speed",
        hint: "How much time the encoder spends compressing. Faster = quicker but larger files; slower = smaller files with better quality.",
        options: [
            ["auto", "Auto (fastest)"],
            ["balanced", "Balanced"],
            ["quality", "Higher quality (slower)"],
        ],
    },
    {
        id: "advancedResolutionSelect",
        label: "Max resolution",
        hint: "Limits the output frame size. Auto scales down only when needed to hit your target size.",
        options: [
            ["auto", "Auto"],
            ["1080", "1080p"],
            ["720", "720p"],
            ["540", "540p"],
            ["480", "480p"],
            ["360", "360p"],
            ["240", "240p"],
            ["none", "Keep original"],
        ],
    },
    {
        id: "advancedFpsSelect",
        label: "Max frame rate",
        hint: "Limits output frames per second. Auto keeps the source rate unless lowering it helps meet the target size.",
        options: [
            ["auto", "Auto"],
            ["60", "60 fps"],
            ["30", "30 fps"],
            ["24", "24 fps"],
        ],
    },
    {
        id: "advancedAudioSelect",
        label: "Audio quality",
        hint: "Controls audio bitrate. Auto picks the best balance of size and clarity, keeping the original audio when it already fits.",
        options: [
            ["auto", "Auto"],
            ["small-64", "Low (smaller file)"],
            ["balanced-96", "Medium"],
            ["high-128", "High"],
            ["copy-prefer", "Keep original"],
        ],
    },
    {
        id: "advancedThreadsSelect",
        label: "CPU usage",
        hint: "Number of threads used for encoding. Auto picks a safe default based on your browser and device.",
        options: [
            ["auto", "Auto"],
            ["1", "1 thread"],
            ["2", "2 threads"],
            ["4", "4 threads"],
        ],
    },
];

function optionsHtml(options) {
    return options
        .map(([value, text], i) => `<option value="${value}"${i === 0 ? " selected" : ""}>${text}</option>`)
        .join("");
}

// --- Individual canonical pieces. Each returns markup containing the fixed IDs. ---

export const engineBadge = () =>
    `<span id="engineBadge" class="engine-badge loading" aria-live="polite">Engine: Loading</span>`;

// dropZone MUST be a <label for="fileInput"> wrapping the hidden file input.
export const dropZone = ({ title = "Drop file here", note = "or click to select a video/image" } = {}) => `
    <label id="dropZone" class="drop-zone" for="fileInput">
        <input id="fileInput" type="file" accept="video/*,image/*" hidden>
        <span id="dropTitle" class="drop-title">${title}</span>
        <span id="dropNote" class="drop-note">${note}</span>
    </label>`;

export const fileSummary = () => `<div id="fileSummary" class="file-summary">No file selected.</div>`;

export const maxSize = ({ label = "Max size (MB)" } = {}) => `
    <label class="field" for="maxSizeInput">
        <span>${label}</span>
        <input id="maxSizeInput" type="number" min="1" step="1" value="10">
    </label>`;

export const minimizeBtn = (extraClass = "") =>
    `<button id="minimizeBtn" class="btn btn-primary ${extraClass}" disabled>Minimize</button>`;

export const downloadBtn = (extraClass = "") =>
    `<button id="downloadBtn" class="btn btn-secondary ${extraClass}" disabled>Download</button>`;

export const progress = () => `
    <div id="progressWrap" class="progress-wrap" hidden>
        <progress id="progressBar" class="progress-bar" max="100"></progress>
        <div id="progressMeta" class="progress-meta">Preparing...</div>
    </div>`;

export const status = () =>
    `<div id="status" class="notice info">Drop a video or image to start.</div>`;

export const result = () => `
    <div id="result" class="result" hidden>
        <div><strong>Original:</strong> <span id="originalSize">-</span></div>
        <div><strong>Output:</strong> <span id="outputSize">-</span></div>
        <div><strong>Saved:</strong> <span id="savedSize">-</span></div>
        <div><strong>Output file:</strong> <span id="outputName">-</span></div>
    </div>`;

export const advancedResetBtn = (extraClass = "btn-compact") =>
    `<button id="advancedResetBtn" type="button" class="btn btn-secondary ${extraClass}">Reset to Auto</button>`;

// Advanced fields as a flat list of <label class="field"> blocks. Layout owner
// decides the container (accordion, tab panel, sidebar, etc.).
export const advancedFields = () =>
    ADVANCED_FIELDS.map(
        (f) => `
        <label class="field" for="${f.id}">
            <span class="field-label">${f.label}
                <abbr class="hint" title="${f.hint}" aria-label="${f.label} help">?</abbr>
            </span>
            <select id="${f.id}">${optionsHtml(f.options)}</select>
        </label>`
    ).join("");
