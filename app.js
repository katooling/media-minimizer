import { FFmpeg, FFFSType } from "./vendor/ffmpeg/ffmpeg/index.js";
import { fetchFile } from "./vendor/ffmpeg/util/index.js";

const elements = {
    engineBadge: document.getElementById("engineBadge"),
    dropZone: document.getElementById("dropZone"),
    dropTitle: document.getElementById("dropTitle"),
    dropNote: document.getElementById("dropNote"),
    fileInput: document.getElementById("fileInput"),
    fileSummary: document.getElementById("fileSummary"),
    maxSizeInput: document.getElementById("maxSizeInput"),
    minimizeBtn: document.getElementById("minimizeBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    progressWrap: document.getElementById("progressWrap"),
    progressBar: document.getElementById("progressBar"),
    progressMeta: document.getElementById("progressMeta"),
    status: document.getElementById("status"),
    result: document.getElementById("result"),
    originalSize: document.getElementById("originalSize"),
    outputSize: document.getElementById("outputSize"),
    savedSize: document.getElementById("savedSize"),
    outputName: document.getElementById("outputName"),
    advancedSpeedSelect: document.getElementById("advancedSpeedSelect"),
    advancedResolutionSelect: document.getElementById("advancedResolutionSelect"),
    advancedFpsSelect: document.getElementById("advancedFpsSelect"),
    advancedAudioSelect: document.getElementById("advancedAudioSelect"),
    advancedThreadsSelect: document.getElementById("advancedThreadsSelect"),
    advancedResetBtn: document.getElementById("advancedResetBtn"),
};

const state = {
    inputFile: null,
    outputBlob: null,
    outputFilename: "",
    downloadUrl: "",
    processing: false,
    ffmpeg: null,
    ffmpegLoader: null,
    ffmpegProgressCb: null,
    ffmpegPreloadDone: false,
    ffmpegMode: "unknown",
    ffmpegPreferredMode: "unknown",
    lastProgressUpdateAt: 0,
    lastRunMetrics: null,
    disableMtForSession: false,
    progressStartedAtMs: 0,
    progressLabel: "",
    progressPercent: null,
    progressTickId: null,
    trace: [],
    lastTrace: [],
    ffmpegLogs: [],
    lastFfmpegLogs: [],
    appEvents: [],
    currentStage: "idle",
    stageStartedAtMs: 0,
    runStartedAtMs: 0,
    lastProgressEventAt: 0,
    lastLogEventAt: 0,
    lastEncodePlan: null,
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const FALLBACK_TARGET_MARGIN = 1.1;
const TARGET_PAYLOAD_RATIO = 0.96;
const PROGRESS_UPDATE_INTERVAL_MS = 250;
const ST_LARGE_THRESHOLD_BYTES = 24 * 1024 * 1024;
const REMUX_MARGIN_RATIO = 1.18;
const ASSET_VERSION = "20260307-1";
const PROGRESS_TICK_INTERVAL_MS = 250;
const debugParams = typeof globalThis.location !== "undefined" ? new URLSearchParams(globalThis.location.search) : new URLSearchParams("");
const DEBUG_MODE = debugParams.get("debug") === "1";
const DEBUG_MOCK_MODE = debugParams.get("ffmpegMock") || "";
const DEBUG_TRACE_LIMIT = 300;
const DEBUG_LOG_LIMIT = 250;
const APP_EVENT_LIMIT = 600;
const parsedDebugStallMs = Number.parseInt(debugParams.get("stallMs") || "", 10);
const parsedDebugTimeoutMs = Number.parseInt(debugParams.get("encodeTimeoutMs") || "", 10);
const ENCODE_STALL_THRESHOLD_MS = Number.isFinite(parsedDebugStallMs) && parsedDebugStallMs > 1000 ? parsedDebugStallMs : 25_000;
const ENCODE_ACTIVITY_HINT_MS = 5_000;
const ENCODE_WATCHDOG_INTERVAL_MS = 1_000;
const ENCODE_HARD_STALL_MIN_MS = 120_000;
const ENCODE_HARD_STALL_MAX_MS = 420_000;
const MT_HARD_STALL_MIN_MS = 35_000;
const MT_HARD_STALL_MAX_MS = 180_000;
const MT_SOFT_STALL_THRESHOLD_MS = 8_000;
const MT_FIRST_PROGRESS_GRACE_MIN_MS = 55_000;
const MT_FIRST_PROGRESS_GRACE_MAX_MS = 150_000;
const ENCODE_TIMEOUT_MS = Number.isFinite(parsedDebugTimeoutMs) && parsedDebugTimeoutMs > 1000 ? parsedDebugTimeoutMs : 12 * 60 * 1000;
const FFMPEG_ERROR_TAIL_LIMIT = 120;
const MT_THREADS_MIN = 2;
const MT_THREADS_MAX = 4;
const ST_ENCODE_THREADS = 1;
const FILTER_GRAPH_ERROR_PATTERNS = [
    /no such filter/i,
    /error reinitializing filters/i,
    /failed to inject frame into filter network/i,
    /error while processing the decoded data/i,
    /filter.*invalid argument/i,
];
const MT_RUNTIME_ERROR_PATTERNS = [
    /function signature mismatch/i,
    /runtimeerror/i,
    /worker sent an error/i,
];
const ADVANCED_SPEED_VALUES = new Set(["auto", "balanced", "quality"]);
const ADVANCED_RESOLUTION_VALUES = new Set(["auto", "1080", "720", "540", "480", "360", "240", "none"]);
const ADVANCED_FPS_VALUES = new Set(["auto", "60", "30", "24"]);
const ADVANCED_AUDIO_VALUES = new Set(["auto", "small-64", "balanced-96", "high-128", "copy-prefer"]);
const ADVANCED_THREADS_VALUES = new Set(["auto", "1", "2", "4"]);
const DEFAULT_ADVANCED_VIDEO_SETTINGS = Object.freeze({
    speed: "auto",
    maxHeight: "auto",
    maxFps: "auto",
    audio: "auto",
    threads: "auto",
});
const DROP_TITLE_DEFAULT = "Drop file here";
const DROP_NOTE_DEFAULT = "or click to select a video/image";
const DROP_TITLE_READY = "File selected";
const DROP_NOTE_READY = "Click Minimize to start processing";
const DROP_TITLE_PROCESSING = "Minimizing in progress";
const DROP_NOTE_PROCESSING = "Please wait until the current run finishes";

init();

function init() {
    elements.fileInput.addEventListener("change", onFileInputChange);
    elements.dropZone.addEventListener("dragover", onDragOver);
    elements.dropZone.addEventListener("dragleave", onDragLeave);
    elements.dropZone.addEventListener("drop", onDrop);
    elements.minimizeBtn.addEventListener("click", onMinimizeClick);
    elements.downloadBtn.addEventListener("click", onDownloadClick);
    elements.advancedSpeedSelect?.addEventListener("change", onAdvancedSettingsChange);
    elements.advancedResolutionSelect?.addEventListener("change", onAdvancedSettingsChange);
    elements.advancedFpsSelect?.addEventListener("change", onAdvancedSettingsChange);
    elements.advancedAudioSelect?.addEventListener("change", onAdvancedSettingsChange);
    elements.advancedThreadsSelect?.addEventListener("change", onAdvancedSettingsChange);
    elements.advancedResetBtn?.addEventListener("click", onAdvancedResetClick);

    // Exposed for E2E assertions of runtime selection behavior.
    if (typeof window !== "undefined") {
        window.__mediaMinimizerDebug = {
            getRuntimeModePriority,
            getLastRunMetrics: () => state.lastRunMetrics,
            getLastTrace: () => state.lastTrace.map((entry) => ({ ...entry })),
            getLastFfmpegLogs: () => state.lastFfmpegLogs.map((entry) => ({ ...entry })),
            getAppEvents: () => state.appEvents.map((entry) => ({ ...entry })),
            getLastRunSummary: () => buildLastRunSummary(),
            getLiveState: () => getLiveDebugState(),
            getAdvancedVideoSettings: () => ({ ...getAdvancedVideoSettings() }),
            getLastEncodePlan: () => (state.lastEncodePlan ? {
                ...state.lastEncodePlan,
                profile: state.lastEncodePlan.profile ? { ...state.lastEncodePlan.profile } : null,
                args: Array.isArray(state.lastEncodePlan.args) ? [...state.lastEncodePlan.args] : [],
            } : null),
            getRuntimeState: () => ({
                activeMode: state.ffmpegMode,
                preferredMode: state.ffmpegPreferredMode,
                isolated: Boolean(globalThis.crossOriginIsolated),
                isolationSource: getIsolationSource(),
            }),
        };
    }

    recordAppEvent("page-load", {
        isolated: Boolean(globalThis.crossOriginIsolated),
        isolationSource: getIsolationSource(),
    });
    setEngineBadge("loading", "Engine: Loading");
    applyAdvancedVideoSettings(DEFAULT_ADVANCED_VIDEO_SETTINGS);
    refreshAdvancedResetButtonState();
    renderFileSummary();
    updateDropZoneState();
    resetProgressState();
    setStatus("Preparing local engine... Drop a video or image to start.", "info");
    warmupFfmpeg();
}

async function warmupFfmpeg() {
    recordAppEvent("engine-preload-start");
    try {
        await getFfmpeg(ST_LARGE_THRESHOLD_BYTES);
        state.ffmpegPreloadDone = true;
        recordAppEvent("engine-preload-ready", {
            mode: state.ffmpegMode,
            isolationSource: getIsolationSource(),
        });
        if (!state.processing && !state.inputFile) {
            setStatus(`Ready (${formatRuntimeLabel(state.ffmpegMode)} engine). Drop a video or image to start.`, "info");
        }
    } catch (error) {
        state.ffmpegPreloadDone = false;
        recordAppEvent("engine-preload-failed", {
            message: truncateMessage(error instanceof Error ? error.message : String(error || "unknown"), 160),
        });
        setEngineBadge("error", "Engine: Unavailable");
        if (!state.inputFile) {
            setStatus("Image minimize is ready. Video engine failed to preload; retry on minimize.", "error");
        }
    }
}

function onFileInputChange(event) {
    if (state.processing) {
        return;
    }
    const [file] = event.target.files || [];
    if (!file) {
        return;
    }
    setInputFile(file, "picker");
}

function onDragOver(event) {
    event.preventDefault();
    if (state.processing) {
        return;
    }
    elements.dropZone.classList.add("active");
}

function onDragLeave(event) {
    event.preventDefault();
    if (state.processing) {
        return;
    }
    elements.dropZone.classList.remove("active");
}

function onDrop(event) {
    event.preventDefault();
    elements.dropZone.classList.remove("active");
    if (state.processing) {
        return;
    }
    const [file] = event.dataTransfer?.files || [];
    if (!file) {
        return;
    }
    setInputFile(file, "drop");
}

function setInputFile(file, source = "unknown") {
    state.inputFile = file;
    clearOutput();
    renderFileSummary();
    updateDropZoneState();
    const typeLabel = detectInputType(file);
    recordAppEvent("file-selected", {
        source,
        name: file.name,
        sizeBytes: file.size,
        kind: typeLabel,
    });

    if (typeLabel === "unsupported") {
        setStatus("Unsupported file type. Use a video or image file.", "error");
        elements.minimizeBtn.disabled = true;
        return;
    }

    elements.minimizeBtn.disabled = false;

    if (typeLabel === "video" && state.ffmpegPreloadDone) {
        setStatus(`Ready to minimize video with ${formatRuntimeLabel(state.ffmpegMode)} engine.`, "info");
        return;
    }
    setStatus(`Ready to minimize ${typeLabel}.`, "info");
}

function onAdvancedSettingsChange() {
    refreshAdvancedResetButtonState();
    recordAppEvent("advanced-settings-changed", getAdvancedVideoSettings());
}

function onAdvancedResetClick() {
    applyAdvancedVideoSettings(DEFAULT_ADVANCED_VIDEO_SETTINGS);
    refreshAdvancedResetButtonState();
    recordAppEvent("advanced-settings-reset", getAdvancedVideoSettings());
}

function normalizeAdvancedChoice(rawValue, allowedValues, fallbackValue) {
    const candidate = String(rawValue || "").trim().toLowerCase();
    if (allowedValues.has(candidate)) {
        return candidate;
    }
    return fallbackValue;
}

function getAdvancedVideoSettings() {
    const speed = normalizeAdvancedChoice(
        elements.advancedSpeedSelect?.value,
        ADVANCED_SPEED_VALUES,
        DEFAULT_ADVANCED_VIDEO_SETTINGS.speed
    );
    const maxHeight = normalizeAdvancedChoice(
        elements.advancedResolutionSelect?.value,
        ADVANCED_RESOLUTION_VALUES,
        DEFAULT_ADVANCED_VIDEO_SETTINGS.maxHeight
    );
    const maxFps = normalizeAdvancedChoice(
        elements.advancedFpsSelect?.value,
        ADVANCED_FPS_VALUES,
        DEFAULT_ADVANCED_VIDEO_SETTINGS.maxFps
    );
    const audio = normalizeAdvancedChoice(
        elements.advancedAudioSelect?.value,
        ADVANCED_AUDIO_VALUES,
        DEFAULT_ADVANCED_VIDEO_SETTINGS.audio
    );
    const threads = normalizeAdvancedChoice(
        elements.advancedThreadsSelect?.value,
        ADVANCED_THREADS_VALUES,
        DEFAULT_ADVANCED_VIDEO_SETTINGS.threads
    );
    return {
        speed,
        maxHeight,
        maxFps,
        audio,
        threads,
    };
}

function applyAdvancedVideoSettings(settings = DEFAULT_ADVANCED_VIDEO_SETTINGS) {
    if (elements.advancedSpeedSelect) {
        elements.advancedSpeedSelect.value = settings.speed || DEFAULT_ADVANCED_VIDEO_SETTINGS.speed;
    }
    if (elements.advancedResolutionSelect) {
        elements.advancedResolutionSelect.value = settings.maxHeight || DEFAULT_ADVANCED_VIDEO_SETTINGS.maxHeight;
    }
    if (elements.advancedFpsSelect) {
        elements.advancedFpsSelect.value = settings.maxFps || DEFAULT_ADVANCED_VIDEO_SETTINGS.maxFps;
    }
    if (elements.advancedAudioSelect) {
        elements.advancedAudioSelect.value = settings.audio || DEFAULT_ADVANCED_VIDEO_SETTINGS.audio;
    }
    if (elements.advancedThreadsSelect) {
        elements.advancedThreadsSelect.value = settings.threads || DEFAULT_ADVANCED_VIDEO_SETTINGS.threads;
    }
}

function isAdvancedVideoSettingsAuto(settings = null) {
    const active = settings || getAdvancedVideoSettings();
    return active.speed === DEFAULT_ADVANCED_VIDEO_SETTINGS.speed
        && active.maxHeight === DEFAULT_ADVANCED_VIDEO_SETTINGS.maxHeight
        && active.maxFps === DEFAULT_ADVANCED_VIDEO_SETTINGS.maxFps
        && active.audio === DEFAULT_ADVANCED_VIDEO_SETTINGS.audio
        && active.threads === DEFAULT_ADVANCED_VIDEO_SETTINGS.threads;
}

function refreshAdvancedResetButtonState() {
    if (!elements.advancedResetBtn) {
        return;
    }
    elements.advancedResetBtn.disabled = isAdvancedVideoSettingsAuto();
}

function renderFileSummary() {
    elements.fileSummary.classList.remove("ready", "processing");
    elements.fileSummary.replaceChildren();

    if (!state.inputFile) {
        elements.fileSummary.textContent = "No file selected.";
        return;
    }

    const nameSpan = document.createElement("span");
    nameSpan.className = "file-name";
    nameSpan.textContent = state.inputFile.name;

    const sizeSpan = document.createElement("span");
    sizeSpan.className = "file-size";
    sizeSpan.textContent = formatBytes(state.inputFile.size);

    elements.fileSummary.append(nameSpan, sizeSpan);
    elements.fileSummary.classList.add(state.processing ? "processing" : "ready");
}

function updateDropZoneState() {
    elements.dropZone.classList.remove("active", "has-file", "processing");
    if (state.processing) {
        elements.dropZone.classList.add("processing");
        elements.dropTitle.textContent = DROP_TITLE_PROCESSING;
        elements.dropNote.textContent = DROP_NOTE_PROCESSING;
        return;
    }
    if (state.inputFile) {
        elements.dropZone.classList.add("has-file");
        elements.dropTitle.textContent = DROP_TITLE_READY;
        elements.dropNote.textContent = DROP_NOTE_READY;
        return;
    }
    elements.dropTitle.textContent = DROP_TITLE_DEFAULT;
    elements.dropNote.textContent = DROP_NOTE_DEFAULT;
}

function clearOutput() {
    state.outputBlob = null;
    state.outputFilename = "";
    if (state.downloadUrl) {
        URL.revokeObjectURL(state.downloadUrl);
    }
    state.downloadUrl = "";
    elements.downloadBtn.disabled = true;
    elements.result.hidden = true;
    elements.originalSize.textContent = "-";
    elements.outputSize.textContent = "-";
    elements.savedSize.textContent = "-";
    elements.outputName.textContent = "-";
    elements.result.classList.remove("loading");
}

async function onMinimizeClick() {
    if (state.processing || !state.inputFile) {
        return;
    }

    const targetMb = Number(elements.maxSizeInput.value);
    const advancedSettings = getAdvancedVideoSettings();
    recordAppEvent("minimize-click", {
        hasFile: Boolean(state.inputFile),
        targetMb: Number.isFinite(targetMb) ? targetMb : null,
        advancedSettings,
    });
    if (!Number.isFinite(targetMb) || targetMb <= 0) {
        setStatus("Max size must be a number greater than 0.", "error");
        return;
    }

    const targetBytes = Math.floor(targetMb * 1024 * 1024);
    const inputType = detectInputType(state.inputFile);
    if (inputType === "unsupported") {
        setStatus("Unsupported file type. Use a video or image file.", "error");
        return;
    }

    setProcessing(true);
    state.lastEncodePlan = null;
    clearOutput();
    setPendingResultState(inputType, state.inputFile);
    startProgressTracker(inputType === "video" ? "Minimizing video" : "Minimizing image");
    beginRunTrace(inputType);
    recordAppEvent("minimize-start", {
        kind: inputType,
        name: state.inputFile?.name || "",
        sizeBytes: state.inputFile?.size || 0,
    });
    const runMetrics = startRunMetrics(inputType);
    state.lastRunMetrics = runMetrics;

    try {
        let result;
        if (inputType === "video") {
            try {
                result = await minimizeVideo(state.inputFile, targetBytes, runMetrics);
            } catch (error) {
                if (shouldRetryWithSingleThread(error)) {
                    appendMetricNote(runMetrics, "mt-runtime-fallback");
                    const fallbackReason = error?.code === "ENCODE_STALLED" ? "stalled" : error?.code === "ENCODE_FILTER_GRAPH" ? "filter-graph failed" : "failed";
                    recordAppEvent("runtime-fallback", {
                        from: "mt-fast",
                        to: "st-large",
                        reason: error?.code || "mt-runtime-fallback",
                    });
                    setStatus(`MT engine ${fallbackReason}. Retrying with ST engine...`, "info");
                    traceEvent("encode-retry", {
                        retryType: "mt->st",
                        reason: error?.code || "mt-runtime-fallback",
                    });
                    traceEvent("error", {
                        eventCode: error?.code || "mt-fallback",
                        message: error instanceof Error ? error.message : String(error || ""),
                    });
                    await forceSingleThreadRuntime();
                    result = await minimizeVideo(state.inputFile, targetBytes, runMetrics);
                } else {
                    throw error;
                }
            }
        } else {
            result = await minimizeImage(state.inputFile, targetBytes, runMetrics);
        }
        endRunMetrics(runMetrics, "success");
        traceEvent("run-end", { status: "success" });
        recordAppEvent("minimize-complete", {
            status: "success",
            kind: inputType,
            runtimeMode: state.ffmpegMode,
            attemptedModes: runMetrics?.attemptedModes || [],
            totalMs: runMetrics?.totalMs ?? null,
            notes: runMetrics?.notes || [],
        });
        setOutputResult(result, targetBytes);
    } catch (error) {
        if (runMetrics) {
            runMetrics.failureCode = error?.code || "RUN_FAILED";
            runMetrics.failureMessage = error instanceof Error ? error.message : String(error || "Minimize failed.");
            runMetrics.failureDetails = error?.details || null;
        }
        endRunMetrics(runMetrics, "failed");
        const message = formatUserFacingFailure(error);
        traceEvent("error", {
            eventCode: error?.code || "run-error",
            message,
        });
        traceEvent("run-end", { status: "failed" });
        recordAppEvent("minimize-complete", {
            status: "failed",
            kind: inputType,
            runtimeMode: state.ffmpegMode,
            attemptedModes: runMetrics?.attemptedModes || [],
            failureCode: error?.code || "RUN_FAILED",
            totalMs: runMetrics?.totalMs ?? null,
        });
        setFailedResultState();
        setStatus(message, "error");
    } finally {
        stopProgressTracker();
        setProcessing(false);
        finalizeRunTrace();
    }
}

function setOutputResult(result, targetBytes) {
    state.outputBlob = result.blob;
    state.outputFilename = result.filename;
    state.downloadUrl = URL.createObjectURL(result.blob);

    const inputSize = state.inputFile.size;
    const outputSize = result.blob.size;
    const saved = Math.max(0, inputSize - outputSize);

    elements.originalSize.textContent = formatBytes(inputSize);
    elements.outputSize.textContent = formatBytes(outputSize);
    elements.savedSize.textContent = formatBytes(saved);
    elements.outputName.textContent = state.outputFilename;
    elements.result.classList.remove("loading");
    elements.result.hidden = false;
    elements.downloadBtn.disabled = false;

    const totalMs = state.lastRunMetrics?.totalMs;
    const timingSuffix = Number.isFinite(totalMs) ? ` Total ${formatDurationMs(totalMs)}.` : "";
    if (outputSize <= targetBytes) {
        setStatus(`Done. File is under target size and ready to download.${timingSuffix}`, "success");
    } else {
        setStatus(`Done. Could not reach target size; best minimized result is ready to download.${timingSuffix}`, "info");
    }
}

function setPendingResultState(inputType, file) {
    elements.result.hidden = false;
    elements.result.classList.add("loading");
    elements.originalSize.textContent = formatBytes(file.size);
    elements.outputSize.textContent = "Working...";
    elements.savedSize.textContent = "Working...";
    if (inputType === "video") {
        elements.outputName.textContent = `${getBaseName(file.name)}-min.mov (pending)`;
    } else {
        elements.outputName.textContent = "Pending...";
    }
}

function setFailedResultState() {
    if (state.inputFile) {
        elements.originalSize.textContent = formatBytes(state.inputFile.size);
    }
    elements.outputSize.textContent = "-";
    elements.savedSize.textContent = "-";
    elements.outputName.textContent = "-";
    elements.result.classList.remove("loading");
}

function startProgressTracker(initialLabel) {
    state.progressStartedAtMs = performance.now();
    state.progressLabel = initialLabel;
    state.progressPercent = null;
    elements.progressWrap.hidden = false;
    renderProgressState();

    if (state.progressTickId) {
        globalThis.clearInterval(state.progressTickId);
    }
    state.progressTickId = globalThis.setInterval(() => {
        renderProgressState();
    }, PROGRESS_TICK_INTERVAL_MS);
}

function stopProgressTracker() {
    if (state.progressTickId) {
        globalThis.clearInterval(state.progressTickId);
        state.progressTickId = null;
    }
    resetProgressState();
}

function setProgressUpdate(label, percent = null) {
    if (!state.processing) {
        return;
    }
    state.progressLabel = label;
    state.progressPercent = Number.isFinite(percent) ? clamp(percent, 0, 100) : null;
    renderProgressState();
}

function renderProgressState() {
    if (elements.progressWrap.hidden) {
        return;
    }
    const now = performance.now();
    const elapsedSeconds = Math.max(0, (now - state.progressStartedAtMs) / 1000);
    const elapsedText = `Elapsed ${formatElapsed(elapsedSeconds)}`;
    let percentText = "Estimating...";
    if (Number.isFinite(state.progressPercent)) {
        percentText = `${Math.round(state.progressPercent)}%`;
    } else if (
        state.processing &&
        state.currentStage === "encode" &&
        state.lastLogEventAt > 0 &&
        now - state.lastLogEventAt <= ENCODE_ACTIVITY_HINT_MS &&
        (state.lastProgressUpdateAt === 0 || now - state.lastProgressUpdateAt > ENCODE_ACTIVITY_HINT_MS)
    ) {
        percentText = "Still processing";
    }
    elements.progressMeta.textContent = `${state.progressLabel} • ${percentText} • ${elapsedText}`;

    if (Number.isFinite(state.progressPercent)) {
        elements.progressBar.value = state.progressPercent;
    } else {
        elements.progressBar.removeAttribute("value");
    }
}

function resetProgressState() {
    state.progressStartedAtMs = 0;
    state.progressLabel = "";
    state.progressPercent = null;
    elements.progressWrap.hidden = true;
    elements.progressBar.removeAttribute("value");
    elements.progressMeta.textContent = "Preparing...";
}

function setProcessing(isProcessing) {
    state.processing = isProcessing;
    elements.minimizeBtn.disabled = isProcessing || !state.inputFile || detectInputType(state.inputFile) === "unsupported";
    elements.downloadBtn.disabled = isProcessing || !state.outputBlob;
    elements.fileInput.disabled = isProcessing;
    elements.maxSizeInput.disabled = isProcessing;
    if (!isProcessing) {
        setCurrentStage("idle");
    }
    renderFileSummary();
    updateDropZoneState();
}

function setStatus(text, kind) {
    elements.status.textContent = text;
    elements.status.className = `notice ${kind}`;
}

function setEngineBadge(kind, text) {
    elements.engineBadge.textContent = text;
    elements.engineBadge.className = `engine-badge ${kind}`;
}

function setEngineReadyBadge(mode) {
    setEngineBadge("ready", `Engine: Ready (${formatRuntimeLabel(mode)})`);
}

function formatRuntimeLabel(mode) {
    if (mode === "st-lite") {
        return "ST-lite";
    }
    if (mode === "st-large") {
        return "ST-large";
    }
    if (mode === "mt-fast") {
        const isolationSource = getIsolationSource();
        return isolationSource === "sw" ? "MT-sw" : "MT-header";
    }
    return "unknown";
}

function getIsolationSource() {
    if (!globalThis.crossOriginIsolated) {
        return "none";
    }
    try {
        const source = sessionStorage.getItem("mm-isolation-source");
        if (source === "sw") {
            const controllerUrl = globalThis.navigator?.serviceWorker?.controller?.scriptURL || "";
            if (controllerUrl.includes("coi-serviceworker.js")) {
                return "sw";
            }
        }
    } catch (error) {
        // Ignore storage access limitations and fall through to header.
    }
    return "header";
}

function onDownloadClick() {
    if (!state.outputBlob || !state.downloadUrl) {
        return;
    }
    const link = document.createElement("a");
    link.href = state.downloadUrl;
    link.download = state.outputFilename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function detectInputType(file) {
    const type = (file.type || "").toLowerCase();
    const ext = getExtension(file.name);

    if (type.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) {
        return "video";
    }
    if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) {
        return "image";
    }
    return "unsupported";
}

function shouldRetryWithSingleThread(error) {
    if (DEBUG_MOCK_MODE === "mt-stall-fallback" && error?.code === "ENCODE_STALLED" && !state.disableMtForSession) {
        return true;
    }
    const modeHint = error?.details?.mode || state.ffmpegMode;
    if (modeHint !== "mt-fast" || state.disableMtForSession) {
        return false;
    }
    if (error?.code === "ENCODE_STALLED" || error?.code === "ENCODE_TIMEOUT" || error?.code === "ENCODE_FILTER_GRAPH") {
        return true;
    }
    const message = error instanceof Error ? error.message : String(error || "");
    if (/function signature mismatch|runtimeerror|worker\.onerror/i.test(message)) {
        return true;
    }
    return hasRecentMtRuntimeError();
}

async function forceSingleThreadRuntime() {
    state.disableMtForSession = true;
    terminateFfmpegInstance();
    recordAppEvent("engine-reset", {
        reason: "force-st-runtime",
    });
    setEngineBadge("loading", "Engine: Switching to ST...");
    setProgressUpdate("Switching engine to ST", null);
    await getFfmpeg(ST_LARGE_THRESHOLD_BYTES);
    recordAppEvent("engine-ready", {
        mode: state.ffmpegMode,
        reason: "force-st-runtime",
    });
}

async function minimizeVideo(file, targetBytes, runMetrics) {
    const outputPath = "output.mov";
    const probePath = "duration.txt";
    const outputFilename = `${getBaseName(file.name)}-min.mov`;
    const inputExt = getExtension(file.name);

    if (file.size <= targetBytes && inputExt === ".mov") {
        setStatus("Video already under target. Skipping transcode.", "success");
        appendMetricNote(runMetrics, "passthrough");
        return {
            blob: file,
            filename: outputFilename,
        };
    }

    setCurrentStage("engine-load");
    traceEvent("engine-load", { phase: "start" });
    beginStage(runMetrics, "load");
    const ffmpeg = await getFfmpeg(file.size);
    recordRunModeAttempt(runMetrics, state.ffmpegMode);
    endStage(runMetrics, "load", { mode: state.ffmpegMode });
    traceEvent("engine-load", { phase: "end", mode: state.ffmpegMode });

    state.ffmpegProgressCb = null;
    state.lastProgressUpdateAt = 0;
    state.lastProgressEventAt = 0;
    state.lastLogEventAt = 0;
    setCurrentStage("input");
    const inputHandle = await prepareVideoInputWithMetrics(ffmpeg, file, runMetrics);
    traceEvent("input-ready", { strategy: inputHandle.mounted ? "workerfs" : "writeFile" });

    try {
        setCurrentStage("metadata");
        beginStage(runMetrics, "metadata");
        const browserMetadata = await probeVideoMetadataFromBrowser(file);
        let durationSeconds = browserMetadata?.durationSeconds ?? null;
        const sourceHeight = browserMetadata?.height ?? null;
        let durationSource = "browser";
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            durationSeconds = await probeDurationSeconds(ffmpeg, inputHandle.inputPath, probePath);
            durationSource = Number.isFinite(durationSeconds) ? "ffprobe" : "unknown";
        }
        endStage(runMetrics, "metadata", {
            durationSeconds: Number.isFinite(durationSeconds) ? Number(durationSeconds.toFixed(3)) : null,
            durationSource,
            sourceHeight: Number.isFinite(sourceHeight) ? sourceHeight : null,
        });
        traceEvent("metadata-ready", {
            durationSeconds: Number.isFinite(durationSeconds) ? Number(durationSeconds.toFixed(3)) : null,
            durationSource,
            sourceHeight: Number.isFinite(sourceHeight) ? sourceHeight : null,
        });

        const etaBand = estimateVideoEtaBand(durationSeconds, state.ffmpegMode);
        setProgressUpdate(`Minimizing video (attempt 1) • ${etaBand}`, null);
        setStatus(`Minimizing video (attempt 1)... ${etaBand}. Browser FFmpeg is slower than native.`, "info");

        if (shouldTryRemuxOnly(file, targetBytes)) {
            setCurrentStage("remux");
            setProgressUpdate("Trying fast remux shortcut", null);
            beginStage(runMetrics, "remux");
            const remuxAttempt = await runVideoRemuxAttempt({
                ffmpeg,
                inputPath: inputHandle.inputPath,
                outputPath,
            });
            endStage(runMetrics, "remux", {
                success: Boolean(remuxAttempt),
                outputBytes: remuxAttempt?.blob?.size ?? null,
            });

            if (remuxAttempt && remuxAttempt.blob.size <= targetBytes) {
                appendMetricNote(runMetrics, "remux-only");
                setProgressUpdate("Remux shortcut complete", 100);
                traceEvent("encode-end", {
                    mode: "remux",
                    outputBytes: remuxAttempt.blob.size,
                });
                return {
                    blob: remuxAttempt.blob,
                    filename: outputFilename,
                };
            }
        }

        const advancedSettings = getAdvancedVideoSettings();
        runMetrics.advancedSettings = { ...advancedSettings };
        const copyAudioSafe = canAttemptAudioCopy(file);
        const primaryProfile = buildVideoEncodeProfile({
            targetBytes,
            durationSeconds,
            aggressive: false,
            copyAudioSafe,
            sourceHeight,
            runtimeMode: state.ffmpegMode,
            advancedSettings,
        });
        setCurrentStage("encode");
        beginStage(runMetrics, "encode");
        let bestAttempt = await runVideoEncodeAttempt({
            ffmpeg,
            inputPath: inputHandle.inputPath,
            outputPath,
            profile: primaryProfile,
            attemptLabel: "attempt 1",
            runMetrics,
            durationSeconds,
        });

        if (bestAttempt.blob.size > Math.floor(targetBytes * FALLBACK_TARGET_MARGIN)) {
            const reductionFactor = clamp((targetBytes / bestAttempt.blob.size) * 0.92, 0.45, 0.9);
            const fallbackProfile = buildVideoEncodeProfile({
                targetBytes,
                durationSeconds,
                aggressive: true,
                reductionFactor,
                baseProfile: bestAttempt.profile,
                copyAudioSafe: false,
                sourceHeight,
                runtimeMode: state.ffmpegMode,
                advancedSettings,
            });

            const fallbackAttempt = await runVideoEncodeAttempt({
                ffmpeg,
                inputPath: inputHandle.inputPath,
                outputPath,
                profile: fallbackProfile,
                attemptLabel: "fallback attempt",
                runMetrics,
                durationSeconds,
            });

            if (fallbackAttempt.blob.size < bestAttempt.blob.size) {
                bestAttempt = fallbackAttempt;
            }
        }

        const encodeMs = endStage(runMetrics, "encode", {
            outputBytes: bestAttempt.blob.size,
            attempts: bestAttempt.attempts,
        });
        traceEvent("encode-end", {
            outputBytes: bestAttempt.blob.size,
            attempts: bestAttempt.attempts,
        });
        const effectiveFps = computeEffectiveFps(durationSeconds, encodeMs);
        if (Number.isFinite(effectiveFps)) {
            runMetrics.effectiveEncodeFps = Number(effectiveFps.toFixed(2));
        }

        return {
            blob: bestAttempt.blob,
            filename: outputFilename,
        };
    } finally {
        state.ffmpegProgressCb = null;
        await safelyDeleteFile(ffmpeg, outputPath);
        await safelyDeleteFile(ffmpeg, probePath);
        await cleanupVideoInput(ffmpeg, inputHandle);
    }
}

async function runVideoEncodeAttempt({ ffmpeg, inputPath, outputPath, profile, attemptLabel, runMetrics, durationSeconds = null }) {
    const modeAtStart = state.ffmpegMode;
    setCurrentStage("encode");
    traceEvent("encode-start", {
        attemptLabel,
        mode: modeAtStart,
        preset: profile.preset,
        threads: profile.encodeThreads,
        videoKbps: profile.videoKbps,
        audioMode: profile.audioMode,
        audioKbps: profile.audioKbps,
    });

    let lastProgressTraceAt = 0;
    state.ffmpegProgressCb = (progress) => {
        const now = performance.now();
        state.lastProgressEventAt = now;
        if (progress < 1 && now - state.lastProgressUpdateAt < PROGRESS_UPDATE_INTERVAL_MS) {
            return;
        }
        state.lastProgressUpdateAt = now;
        const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));
        setProgressUpdate(`Minimizing video (${attemptLabel})`, percent);
        setStatus(`Minimizing video (${attemptLabel})... ${percent}% (approx.)`, "info");
        if (now - lastProgressTraceAt >= 1000 || percent >= 100) {
            lastProgressTraceAt = now;
            traceEvent("encode-progress", {
                attemptLabel,
                percent,
            });
        }
    };

    await safelyDeleteFile(ffmpeg, outputPath);
    let activeProfile = profile;
    let attempts = 1;
    let activeArgs = buildVideoEncodeArgs(inputPath, outputPath, activeProfile);
    setLastEncodePlan({
        attemptLabel,
        mode: modeAtStart,
        profile: activeProfile,
        args: activeArgs,
    });
    let exitCode = await execVideoWithWatchdog({
        ffmpeg,
        args: activeArgs,
        attemptLabel,
        inputPath,
        outputPath,
        durationSeconds,
        modeAtStart,
    });
    if (exitCode !== 0 && activeProfile.audioMode === "copy") {
        attempts += 1;
        activeProfile = {
            ...activeProfile,
            audioMode: "encode",
            audioKbps: Math.min(activeProfile.audioKbps ?? 72, 64),
        };
        activeArgs = buildVideoEncodeArgs(inputPath, outputPath, activeProfile);
        setLastEncodePlan({
            attemptLabel: `${attemptLabel} (audio retry)`,
            mode: modeAtStart,
            profile: activeProfile,
            args: activeArgs,
        });
        exitCode = await execVideoWithWatchdog({
            ffmpeg,
            args: activeArgs,
            attemptLabel: `${attemptLabel} (audio retry)`,
            inputPath,
            outputPath,
            durationSeconds,
            modeAtStart,
        });
    }

    if (exitCode !== 0) {
        const classifiedError = classifyEncodeFailure({
            attemptLabel,
            mode: modeAtStart,
            profile: activeProfile,
        });
        if (classifiedError.code === "ENCODE_FILTER_GRAPH" && !activeProfile.forceNoFilters) {
            attempts += 1;
            traceEvent("encode-retry", {
                retryType: "filterless",
                attemptLabel,
                reason: classifiedError.code,
            });
            appendMetricNote(runMetrics, "filterless-retry");
            setProgressUpdate(`Minimizing video (${attemptLabel}, filterless retry)`, null);
            setStatus(`Minimizing video (${attemptLabel})... retrying without filters.`, "info");
            await safelyDeleteFile(ffmpeg, outputPath);
            activeProfile = {
                ...activeProfile,
                maxFps: null,
                maxHeight: null,
                forceNoFilters: true,
            };
            activeArgs = buildVideoEncodeArgs(inputPath, outputPath, activeProfile);
            setLastEncodePlan({
                attemptLabel: `${attemptLabel} (filterless)`,
                mode: modeAtStart,
                profile: activeProfile,
                args: activeArgs,
            });
            exitCode = await execVideoWithWatchdog({
                ffmpeg,
                args: activeArgs,
                attemptLabel: `${attemptLabel} (filterless)`,
                inputPath,
                outputPath,
                durationSeconds,
                modeAtStart,
            });
        }
    }

    if (exitCode !== 0) {
        throw classifyEncodeFailure({
            attemptLabel,
            mode: modeAtStart,
            profile: activeProfile,
        });
    }

    setCurrentStage("output-read");
    traceEvent("output-read", { phase: "start", attemptLabel });
    beginStage(runMetrics, "output-read");
    const outputData = await ffmpeg.readFile(outputPath);
    endStage(runMetrics, "output-read", { outputBytes: outputData.length });
    traceEvent("output-read", {
        phase: "end",
        attemptLabel,
        outputBytes: outputData.length,
    });
    return {
        blob: new Blob([outputData], { type: "video/quicktime" }),
        profile: activeProfile,
        attempts,
    };
}

function setLastEncodePlan({ attemptLabel, mode, profile, args }) {
    state.lastEncodePlan = {
        attemptLabel: attemptLabel || "",
        mode: mode || "unknown",
        profile: profile ? { ...profile } : null,
        args: Array.isArray(args) ? [...args] : [],
        atIso: new Date().toISOString(),
    };
}

async function execVideoWithWatchdog({ ffmpeg, args, attemptLabel, inputPath, outputPath, durationSeconds, modeAtStart }) {
    const hasMockScenario = DEBUG_MOCK_MODE === "no-progress-complete"
        || DEBUG_MOCK_MODE === "stall"
        || DEBUG_MOCK_MODE === "mt-stall-fallback"
        || DEBUG_MOCK_MODE === "filter-graph-retry";
    if (hasMockScenario) {
        return runMockVideoExec({ ffmpeg, attemptLabel, inputPath, outputPath, args });
    }

    const watchdog = startEncodeWatchdog(ffmpeg, attemptLabel, durationSeconds, modeAtStart);
    const startedAt = performance.now();

    try {
        const exitCode = await ffmpeg.exec(args, ENCODE_TIMEOUT_MS);
        if (watchdog.stallError) {
            throw watchdog.stallError;
        }
        if (exitCode !== 0 && performance.now() - startedAt >= ENCODE_TIMEOUT_MS - 250) {
            throw createAppError(
                "ENCODE_TIMEOUT",
                `Encode timed out after ${formatDuration(ENCODE_TIMEOUT_MS / 1000)}. Open debug logs.`,
                {
                    attemptLabel,
                    timeoutMs: ENCODE_TIMEOUT_MS,
                    mode: modeAtStart || state.ffmpegMode,
                }
            );
        }
        return exitCode;
    } catch (error) {
        if (watchdog.stallError) {
            throw watchdog.stallError;
        }
        throw error;
    } finally {
        watchdog.stop();
    }
}

function startEncodeWatchdog(ffmpeg, attemptLabel, durationSeconds, modeAtStart) {
    const encodeStartedAt = performance.now();
    const attemptMode = modeAtStart || state.ffmpegMode;
    const hardStallMs = computeHardStallThresholdMs(durationSeconds, attemptMode);
    const softStallMs = getSoftSilenceThresholdMs(attemptMode);
    const firstProgressGraceMs = attemptMode === "mt-fast" ? computeMtFirstProgressGraceMs(durationSeconds) : 0;
    let softWarningShown = false;
    let lastCountdownSecond = null;
    let stopped = false;
    let stallError = null;

    const timerId = globalThis.setInterval(() => {
        if (stopped || !state.processing) {
            return;
        }
        const now = performance.now();
        const elapsedMs = Math.max(0, now - encodeStartedAt);
        const lastActivityAt = Math.max(state.lastProgressEventAt || 0, state.lastLogEventAt || 0, encodeStartedAt);
        const silenceMs = now - lastActivityAt;
        const hasProgressEvent = state.lastProgressEventAt > encodeStartedAt;
        const inMtGrace = attemptMode === "mt-fast" && !hasProgressEvent && elapsedMs < firstProgressGraceMs;
        const effectiveHardStallMs = inMtGrace ? Math.max(hardStallMs, firstProgressGraceMs) : hardStallMs;
        if (silenceMs < softStallMs) {
            return;
        }
        if (!softWarningShown) {
            softWarningShown = true;
            traceEvent("encode-silent", {
                attemptLabel,
                silenceMs: Math.round(silenceMs),
                softStallMs: Math.round(softStallMs),
                hardStallMs: Math.round(hardStallMs),
                mode: attemptMode,
            });
            setProgressUpdate("Still processing (quiet encode phase)", null);
            if (attemptMode === "mt-fast") {
                const seconds = Math.max(1, Math.ceil((effectiveHardStallMs - silenceMs) / 1000));
                lastCountdownSecond = seconds;
                setStatus(`MT is quiet. Auto-fallback to ST in ~${seconds}s if still inactive.`, "info");
            } else {
                setStatus("Still processing. Some browser encodes are silent for a while.", "info");
            }
        }
        if (silenceMs < effectiveHardStallMs) {
            if (attemptMode === "mt-fast") {
                const seconds = Math.max(1, Math.ceil((effectiveHardStallMs - silenceMs) / 1000));
                if (seconds !== lastCountdownSecond) {
                    lastCountdownSecond = seconds;
                    setStatus(`MT is quiet. Auto-fallback to ST in ~${seconds}s if still inactive.`, "info");
                }
            }
            return;
        }
        const stallMessage = `Encode stalled after ${formatDuration(elapsedMs / 1000)} at stage encode. Open debug logs.`;
        stallError = createAppError("ENCODE_STALLED", stallMessage, {
            attemptLabel,
            silenceMs: Math.round(silenceMs),
            elapsedMs: Math.round(elapsedMs),
            mode: attemptMode,
            stage: state.currentStage,
            hardStallMs: Math.round(effectiveHardStallMs),
        });
        traceEvent("error", {
            eventCode: "encode-stalled",
            attemptLabel,
            silenceMs: Math.round(silenceMs),
            elapsedMs: Math.round(elapsedMs),
            mode: attemptMode,
            hardStallMs: Math.round(effectiveHardStallMs),
        });

        if (attemptMode === "mt-fast" && !state.disableMtForSession) {
            setProgressUpdate("Stalled, recovering...", null);
            setStatus("Stalled, recovering... Switching MT to ST.", "info");
        } else {
            setProgressUpdate("Encode stalled", null);
            setStatus(stallMessage, "error");
        }

        stopped = true;
        globalThis.clearInterval(timerId);
        terminateFfmpegInstance();
    }, ENCODE_WATCHDOG_INTERVAL_MS);

    return {
        get stallError() {
            return stallError;
        },
        stop() {
            if (stopped) {
                return;
            }
            stopped = true;
            globalThis.clearInterval(timerId);
        },
    };
}

async function runMockVideoExec({ ffmpeg, attemptLabel, inputPath, outputPath, args = [] }) {
    const statusPrefix = `Mock encode (${attemptLabel})`;

    if (DEBUG_MOCK_MODE === "no-progress-complete") {
        setCurrentStage("encode");
        recordFfmpegLog("mock: frame=1 fps=26.8 speed=0.7x");
        await delay(300);
        recordFfmpegLog("mock: frame=46 fps=28.2 speed=0.8x");
        await delay(300);
        const inputData = await ffmpeg.readFile(inputPath);
        await ffmpeg.writeFile(outputPath, inputData.slice(0, Math.min(inputData.length, 1024)));
        setStatus(`${statusPrefix} complete.`, "info");
        return 0;
    }

    if (DEBUG_MOCK_MODE === "stall") {
        setCurrentStage("encode");
        await delay(ENCODE_STALL_THRESHOLD_MS + 1500);
        throw createAppError("ENCODE_STALLED", "Encode stalled after mock timeout. Open debug logs.", {
            mode: state.ffmpegMode,
            stage: state.currentStage,
            attemptLabel,
        });
    }

    if (DEBUG_MOCK_MODE === "mt-stall-fallback") {
        setCurrentStage("encode");
        if (!state.disableMtForSession) {
            await delay(ENCODE_STALL_THRESHOLD_MS + 1500);
            throw createAppError("ENCODE_STALLED", "Encode stalled in MT mock run. Open debug logs.", {
                mode: state.ffmpegMode,
                stage: state.currentStage,
                attemptLabel,
            });
        }
        setProgressUpdate("Minimizing video (ST fallback)", 70);
        await delay(250);
        setProgressUpdate("Minimizing video (ST fallback)", 100);
        const inputData = await ffmpeg.readFile(inputPath);
        await ffmpeg.writeFile(outputPath, inputData.slice(0, Math.min(inputData.length, 1024)));
        return 0;
    }

    if (DEBUG_MOCK_MODE === "filter-graph-retry") {
        const hasFilters = Array.isArray(args) && args.includes("-vf");
        if (hasFilters) {
            recordFfmpegLog("[AVFilterGraph @ 0x111] No such filter: 'null'", "stderr");
            recordFfmpegLog("Error reinitializing filters!", "stderr");
            recordFfmpegLog("Conversion failed!", "stderr");
            return 1;
        }
        const inputData = await ffmpeg.readFile(inputPath);
        await ffmpeg.writeFile(outputPath, inputData.slice(0, Math.min(inputData.length, 1024)));
        return 0;
    }

    return 0;
}

async function runVideoRemuxAttempt({ ffmpeg, inputPath, outputPath }) {
    await safelyDeleteFile(ffmpeg, outputPath);
    const exitCode = await ffmpeg.exec([
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-map_metadata",
        "-1",
        "-c",
        "copy",
        "-f",
        "mov",
        outputPath,
    ]);
    if (exitCode !== 0) {
        return null;
    }
    const outputData = await ffmpeg.readFile(outputPath);
    return {
        blob: new Blob([outputData], { type: "video/quicktime" }),
    };
}

function buildVideoEncodeArgs(inputPath, outputPath, profile) {
    const args = [
        "-i",
        inputPath,
        "-stats_period",
        "1",
        "-stats",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-map_metadata",
        "-1",
        "-c:v",
        "libx264",
        "-preset",
        profile.preset,
        "-threads",
        `${Math.max(1, profile.encodeThreads || ST_ENCODE_THREADS)}`,
        "-b:v",
        `${profile.videoKbps}k`,
        "-maxrate",
        `${profile.maxrateKbps}k`,
        "-bufsize",
        `${profile.bufsizeKbps}k`,
        "-pix_fmt",
        "yuv420p",
    ];
    if (profile.tune) {
        args.push("-tune", profile.tune);
    }

    if (!profile.forceNoFilters) {
        const filters = [];
        if (Number.isFinite(profile.maxFps) && profile.maxFps > 0) {
            filters.push(`fps=${profile.maxFps}`);
        }
        if (Number.isFinite(profile.maxHeight) && profile.maxHeight > 0) {
            filters.push(`scale=-2:${profile.maxHeight}`);
        }
        if (filters.length > 0) {
            args.push("-vf", filters.join(","));
        }
    }

    if (profile.audioMode === "copy") {
        args.push("-c:a", "copy");
    } else {
        args.push("-c:a", "aac", "-b:a", `${profile.audioKbps}k`);
    }

    args.push("-f", "mov", outputPath);
    return args;
}

function buildVideoEncodeProfile({
    targetBytes,
    durationSeconds,
    aggressive,
    reductionFactor = 1,
    baseProfile = null,
    copyAudioSafe = false,
    sourceHeight = null,
    runtimeMode = "unknown",
    advancedSettings = DEFAULT_ADVANCED_VIDEO_SETTINGS,
}) {
    const resolvedAdvanced = advancedSettings || DEFAULT_ADVANCED_VIDEO_SETTINGS;
    const speedMode = resolvedAdvanced.speed || DEFAULT_ADVANCED_VIDEO_SETTINGS.speed;
    const preset = resolvePresetFromSpeedMode(speedMode);

    if (baseProfile) {
        const videoKbps = Math.max(140, Math.floor(baseProfile.videoKbps * reductionFactor));
        const audioKbps = aggressive ? 56 : baseProfile.audioKbps;
        const audioMode = aggressive ? "encode" : baseProfile.audioMode;
        return buildProfileWithCaps({
            preset,
            videoKbps,
            audioKbps,
            audioMode,
            sourceHeight: Number.isFinite(sourceHeight) ? sourceHeight : baseProfile.sourceHeight,
            runtimeMode: runtimeMode || baseProfile.runtimeMode,
            advancedSettings: resolvedAdvanced,
            copyAudioSafe,
            speedMode,
        });
    }

    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 60;
    const targetPayloadBytes = Math.floor(targetBytes * TARGET_PAYLOAD_RATIO);
    const targetTotalBps = Math.max(320_000, Math.floor((targetPayloadBytes * 8) / safeDuration));

    let audioBps = clamp(Math.floor(targetTotalBps * 0.11), 56_000, 112_000);
    let audioMode = copyAudioSafe && targetTotalBps > 650_000 && !aggressive ? "copy" : "encode";
    if (audioMode === "copy") {
        audioBps = 96_000;
    }

    let videoBps = Math.max(180_000, targetTotalBps - audioBps);
    if (aggressive) {
        videoBps = Math.max(140_000, Math.floor(videoBps * 0.76));
        audioMode = "encode";
        audioBps = 56_000;
    }

    const videoKbps = Math.floor(videoBps / 1000);
    const audioKbps = Math.floor(audioBps / 1000);
    return buildProfileWithCaps({
        preset,
        videoKbps,
        audioKbps,
        audioMode,
        sourceHeight,
        runtimeMode,
        advancedSettings: resolvedAdvanced,
        copyAudioSafe,
        speedMode,
    });
}

function resolvePresetFromSpeedMode(speedMode) {
    if (speedMode === "balanced") {
        return "veryfast";
    }
    if (speedMode === "quality") {
        return "faster";
    }
    return "ultrafast";
}

function resolveDefaultTune(speedMode, runtimeMode) {
    if (speedMode === "auto" && runtimeMode !== "mt-fast") {
        return "zerolatency";
    }
    return null;
}

function resolveAdvancedMaxHeight(maxHeightMode) {
    if (maxHeightMode === "1080") {
        return 1080;
    }
    if (maxHeightMode === "720") {
        return 720;
    }
    if (maxHeightMode === "540") {
        return 540;
    }
    if (maxHeightMode === "480") {
        return 480;
    }
    if (maxHeightMode === "360") {
        return 360;
    }
    if (maxHeightMode === "240") {
        return 240;
    }
    if (maxHeightMode === "none") {
        return null;
    }
    return undefined;
}

function resolveAdvancedMaxFps(maxFpsMode) {
    if (maxFpsMode === "60") {
        return 60;
    }
    if (maxFpsMode === "30") {
        return 30;
    }
    if (maxFpsMode === "24") {
        return 24;
    }
    return undefined;
}

function resolveAudioOverride(audioMode, copyAudioSafe) {
    if (audioMode === "small-64") {
        return { audioMode: "encode", audioKbps: 64 };
    }
    if (audioMode === "balanced-96") {
        return { audioMode: "encode", audioKbps: 96 };
    }
    if (audioMode === "high-128") {
        return { audioMode: "encode", audioKbps: 128 };
    }
    if (audioMode === "copy-prefer") {
        if (copyAudioSafe) {
            return { audioMode: "copy", audioKbps: 96 };
        }
        return { audioMode: "encode", audioKbps: 96 };
    }
    return null;
}

function resolveAdvancedEncodeThreads(threadMode, runtimeMode, fallbackThreads) {
    if (threadMode === "1" || threadMode === "2" || threadMode === "4") {
        if (runtimeMode !== "mt-fast") {
            return ST_ENCODE_THREADS;
        }
        return clamp(Number.parseInt(threadMode, 10), ST_ENCODE_THREADS, MT_THREADS_MAX);
    }
    return fallbackThreads;
}

function buildProfileWithCaps({
    preset,
    videoKbps,
    audioKbps,
    audioMode,
    sourceHeight = null,
    runtimeMode = "unknown",
    advancedSettings = DEFAULT_ADVANCED_VIDEO_SETTINGS,
    copyAudioSafe = false,
    speedMode = "auto",
}) {
    let maxHeight = null;
    let maxFps = null;

    if (videoKbps <= 450) {
        maxHeight = 480;
        maxFps = 24;
    } else if (videoKbps <= 650) {
        maxHeight = 540;
        maxFps = 24;
    } else if (videoKbps <= 900) {
        maxHeight = 720;
        maxFps = 30;
    }

    if (Number.isFinite(sourceHeight) && Number.isFinite(maxHeight) && sourceHeight <= maxHeight) {
        maxHeight = null;
    }
    const advancedMaxHeight = resolveAdvancedMaxHeight(advancedSettings.maxHeight);
    if (advancedMaxHeight === null) {
        maxHeight = null;
    } else if (Number.isFinite(advancedMaxHeight) && advancedMaxHeight > 0) {
        maxHeight = advancedMaxHeight;
        if (Number.isFinite(sourceHeight) && sourceHeight <= maxHeight) {
            maxHeight = null;
        }
    }

    const advancedMaxFps = resolveAdvancedMaxFps(advancedSettings.maxFps);
    if (Number.isFinite(advancedMaxFps) && advancedMaxFps > 0) {
        maxFps = advancedMaxFps;
    }

    let resolvedAudioMode = audioMode;
    let resolvedAudioKbps = audioKbps;
    const audioOverride = resolveAudioOverride(advancedSettings.audio, copyAudioSafe);
    if (audioOverride) {
        resolvedAudioMode = audioOverride.audioMode;
        resolvedAudioKbps = audioOverride.audioKbps;
    }

    const defaultThreads = selectEncodeThreads(runtimeMode, sourceHeight);
    const encodeThreads = resolveAdvancedEncodeThreads(advancedSettings.threads, runtimeMode, defaultThreads);
    const tune = resolveDefaultTune(speedMode, runtimeMode);

    return {
        preset,
        speedMode,
        tune,
        videoKbps,
        audioKbps: resolvedAudioKbps,
        audioMode: resolvedAudioMode,
        sourceHeight,
        runtimeMode,
        maxHeight,
        maxFps,
        forceNoFilters: false,
        encodeThreads,
        maxrateKbps: Math.max(videoKbps + 80, Math.floor(videoKbps * 1.18)),
        bufsizeKbps: Math.max(videoKbps + 160, Math.floor(videoKbps * 1.9)),
    };
}

function estimateVideoEtaBand(durationSeconds, mode) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return "ETA unknown";
    }

    if (mode === "mt-fast") {
        return `ETA ~${formatDuration(durationSeconds * 0.7)}-${formatDuration(durationSeconds * 2.2)}`;
    }
    if (mode === "st-large") {
        return `ETA ~${formatDuration(durationSeconds * 1.3)}-${formatDuration(durationSeconds * 3.8)}`;
    }
    return `ETA ~${formatDuration(durationSeconds * 1.1)}-${formatDuration(durationSeconds * 3.2)}`;
}

function shouldTryRemuxOnly(file, targetBytes) {
    const ext = getExtension(file.name);
    if (ext === ".mov" || ext === ".avi") {
        return false;
    }
    if (file.size <= targetBytes) {
        return true;
    }
    if (ext === ".mp4" || ext === ".m4v") {
        return file.size <= Math.floor(targetBytes * 1.35);
    }
    return file.size <= Math.floor(targetBytes * REMUX_MARGIN_RATIO);
}

function canAttemptAudioCopy(file) {
    const ext = getExtension(file.name);
    if (ext === ".mp4" || ext === ".mov" || ext === ".m4v") {
        return true;
    }
    const type = (file.type || "").toLowerCase();
    return type === "video/mp4" || type === "video/quicktime";
}

function computeEffectiveFps(durationSeconds, encodeMs) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !Number.isFinite(encodeMs) || encodeMs <= 0) {
        return null;
    }
    return durationSeconds / (encodeMs / 1000);
}

function computeHardStallThresholdMs(durationSeconds, mode) {
    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 60;
    if (mode === "mt-fast") {
        const derivedMs = safeDuration * 1.1 * 1000;
        return clamp(Math.round(derivedMs), MT_HARD_STALL_MIN_MS, MT_HARD_STALL_MAX_MS);
    }
    const derivedMs = safeDuration * 5.2 * 1000;
    return clamp(Math.round(derivedMs), ENCODE_HARD_STALL_MIN_MS, ENCODE_HARD_STALL_MAX_MS);
}

function getSoftSilenceThresholdMs(mode) {
    if (mode === "mt-fast") {
        return MT_SOFT_STALL_THRESHOLD_MS;
    }
    return ENCODE_STALL_THRESHOLD_MS;
}

function computeMtFirstProgressGraceMs(durationSeconds) {
    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 60;
    const derivedMs = safeDuration * 2.4 * 1000;
    return clamp(Math.round(derivedMs), MT_FIRST_PROGRESS_GRACE_MIN_MS, MT_FIRST_PROGRESS_GRACE_MAX_MS);
}

function getHardwareConcurrency() {
    const raw = Number(globalThis?.navigator?.hardwareConcurrency || 0);
    if (!Number.isFinite(raw) || raw < 1) {
        return 4;
    }
    return Math.floor(raw);
}

function selectEncodeThreads(runtimeMode, sourceHeight = null) {
    if (runtimeMode !== "mt-fast") {
        return ST_ENCODE_THREADS;
    }
    const hw = getHardwareConcurrency();
    if (Number.isFinite(sourceHeight) && sourceHeight >= 1800) {
        return clamp(Math.floor(hw / 2), MT_THREADS_MIN, MT_THREADS_MAX);
    }
    if (Number.isFinite(sourceHeight) && sourceHeight >= 1080) {
        return clamp(Math.floor(hw / 3), MT_THREADS_MIN, MT_THREADS_MAX);
    }
    return clamp(Math.floor(hw / 4), MT_THREADS_MIN, MT_THREADS_MAX);
}

function classifyEncodeFailure({ attemptLabel, mode, profile }) {
    const recentLines = getRecentFfmpegStderrLines(FFMPEG_ERROR_TAIL_LIMIT);
    const terminalLine = getLastFfmpegTerminalLine(recentLines);
    const joined = recentLines.join("\n");
    const hasFilterGraphError = FILTER_GRAPH_ERROR_PATTERNS.some((pattern) => pattern.test(joined));
    const details = {
        attemptLabel,
        mode,
        profile: {
            preset: profile?.preset || "",
            speedMode: profile?.speedMode || "",
            tune: profile?.tune || "",
            videoKbps: profile?.videoKbps || null,
            audioMode: profile?.audioMode || "",
            audioKbps: profile?.audioKbps || null,
            encodeThreads: profile?.encodeThreads || null,
            forceNoFilters: Boolean(profile?.forceNoFilters),
        },
        terminalLine,
    };
    if (hasFilterGraphError) {
        return createAppError(
            "ENCODE_FILTER_GRAPH",
            `Video filter graph failed during ${attemptLabel}.`,
            details
        );
    }
    return createAppError(
        "ENCODE_EXEC_FAILED",
        `Video conversion failed during ${attemptLabel}.`,
        details
    );
}

function hasRecentMtRuntimeError(limit = 40) {
    const recentLines = getRecentFfmpegStderrLines(limit);
    if (recentLines.length === 0) {
        return false;
    }
    const joined = recentLines.join("\n");
    return MT_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(joined));
}

function getRecentFfmpegStderrLines(limit = 40) {
    const lines = [];
    for (let index = state.ffmpegLogs.length - 1; index >= 0; index -= 1) {
        const entry = state.ffmpegLogs[index];
        if (!entry || entry.type !== "stderr") {
            continue;
        }
        lines.push(String(entry.message || ""));
        if (lines.length >= limit) {
            break;
        }
    }
    return lines.reverse();
}

function getLastFfmpegTerminalLine(lines = null) {
    const source = Array.isArray(lines) ? lines : getRecentFfmpegStderrLines(FFMPEG_ERROR_TAIL_LIMIT);
    for (let index = source.length - 1; index >= 0; index -= 1) {
        const line = String(source[index] || "").trim();
        if (line) {
            return line;
        }
    }
    return "";
}

function formatUserFacingFailure(error) {
    const baseMessage = error instanceof Error ? error.message : "Minimize failed.";
    const terminalLine = String(error?.details?.terminalLine || "").trim();
    if (!terminalLine) {
        return baseMessage;
    }
    return `${baseMessage} FFmpeg: ${truncateMessage(terminalLine, 180)}`;
}

async function probeVideoMetadataFromBrowser(file) {
    if (typeof document === "undefined") {
        return null;
    }

    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    try {
        const metadata = await new Promise((resolve) => {
            const onLoadedMetadata = () => {
                cleanup();
                resolve({
                    durationSeconds: video.duration,
                    width: video.videoWidth,
                    height: video.videoHeight,
                });
            };
            const onError = () => {
                cleanup();
                resolve(null);
            };
            const cleanup = () => {
                video.removeEventListener("loadedmetadata", onLoadedMetadata);
                video.removeEventListener("error", onError);
            };
            video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
            video.addEventListener("error", onError, { once: true });
            video.src = objectUrl;
        });
        if (!metadata) {
            return null;
        }
        const durationSeconds = Number.isFinite(metadata.durationSeconds) && metadata.durationSeconds > 0 ? metadata.durationSeconds : null;
        const width = Number.isFinite(metadata.width) && metadata.width > 0 ? metadata.width : null;
        const height = Number.isFinite(metadata.height) && metadata.height > 0 ? metadata.height : null;
        if (!durationSeconds && !width && !height) {
            return null;
        }
        return {
            durationSeconds,
            width,
            height,
        };
    } finally {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
    }
}

async function probeDurationSeconds(ffmpeg, inputPath, outputPath) {
    await safelyDeleteFile(ffmpeg, outputPath);
    const exitCode = await ffmpeg.ffprobe([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputPath,
        "-o",
        outputPath,
    ]);

    if (exitCode !== 0) {
        return null;
    }

    const rawDuration = await ffmpeg.readFile(outputPath, "utf8");
    const parsed = Number.parseFloat(String(rawDuration).trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function prepareVideoInput(ffmpeg, file) {
    const mountPoint = "/input";
    const mountFileName = file.name || `input${getExtension(file.name) || ".bin"}`;
    const mountedInputPath = `${mountPoint}/${mountFileName}`;

    await safelyDeleteDir(ffmpeg, mountPoint);

    try {
        await ffmpeg.createDir(mountPoint);
        await ffmpeg.mount(FFFSType.WORKERFS, { files: [file] }, mountPoint);
        return {
            mounted: true,
            mountPoint,
            inputPath: mountedInputPath,
        };
    } catch (error) {
        await safelyUnmount(ffmpeg, mountPoint);
        await safelyDeleteDir(ffmpeg, mountPoint);

        const inputExt = getExtension(file.name) || ".bin";
        const inputPath = `input${inputExt}`;
        await ffmpeg.writeFile(inputPath, await fetchFile(file));
        return {
            mounted: false,
            mountPoint: "",
            inputPath,
        };
    }
}

async function prepareVideoInputWithMetrics(ffmpeg, file, runMetrics) {
    beginStage(runMetrics, "input");
    const inputHandle = await prepareVideoInput(ffmpeg, file);
    endStage(runMetrics, "input", {
        strategy: inputHandle.mounted ? "workerfs" : "writeFile",
    });
    return inputHandle;
}

async function cleanupVideoInput(ffmpeg, inputHandle) {
    if (inputHandle.mounted) {
        await safelyUnmount(ffmpeg, inputHandle.mountPoint);
        await safelyDeleteDir(ffmpeg, inputHandle.mountPoint);
        return;
    }
    await safelyDeleteFile(ffmpeg, inputHandle.inputPath);
}

function getRuntimeModePriority(isIsolated, fileSizeBytes = null) {
    const prefersLarge = !Number.isFinite(fileSizeBytes) || fileSizeBytes >= ST_LARGE_THRESHOLD_BYTES;
    if (isIsolated && !state.disableMtForSession) {
        return prefersLarge ? ["mt-fast", "st-large", "st-lite"] : ["mt-fast", "st-lite", "st-large"];
    }
    return prefersLarge ? ["st-large", "st-lite"] : ["st-lite", "st-large"];
}

function createRuntimeCandidate(mode) {
    const classWorkerURL = withAssetVersion(new URL("./vendor/ffmpeg/ffmpeg/worker.js", import.meta.url).href);

    if (mode === "mt-fast") {
        return {
            mode,
            loadOptions: {
                classWorkerURL,
                coreURL: withAssetVersion(new URL("./vendor/ffmpeg/core-mt-fast/ffmpeg-core.js", import.meta.url).href),
                wasmURL: withAssetVersion(new URL("./vendor/ffmpeg/core-mt-fast/ffmpeg-core.wasm", import.meta.url).href),
                workerURL: withAssetVersion(new URL("./vendor/ffmpeg/core-mt-fast/ffmpeg-core.worker.js", import.meta.url).href),
            },
        };
    }

    if (mode === "st-lite") {
        return {
            mode,
            loadOptions: {
                classWorkerURL,
                coreURL: withAssetVersion(new URL("./vendor/ffmpeg/core-st-lite/ffmpeg-core.js", import.meta.url).href),
                wasmURL: withAssetVersion(new URL("./vendor/ffmpeg/core-st-lite/ffmpeg-core.wasm", import.meta.url).href),
            },
        };
    }

    return {
        mode,
        loadOptions: {
            classWorkerURL,
            coreURL: withAssetVersion(new URL("./vendor/ffmpeg/core-st-large/ffmpeg-core.js", import.meta.url).href),
            wasmURL: withAssetVersion(new URL("./vendor/ffmpeg/core-st-large/ffmpeg-core.wasm", import.meta.url).href),
        },
    };
}

async function getFfmpeg(fileSizeBytes = null) {
    if (state.ffmpeg) {
        return state.ffmpeg;
    }

    if (!state.ffmpegLoader) {
        state.ffmpegLoader = (async () => {
            const isIsolated = Boolean(globalThis.crossOriginIsolated);
            const modePriority = getRuntimeModePriority(isIsolated, fileSizeBytes);
            state.ffmpegPreferredMode = modePriority[0];
            let lastError = null;

            for (const mode of modePriority) {
                const candidate = createRuntimeCandidate(mode);
                const ffmpeg = new FFmpeg();
                ffmpeg.on("progress", ({ progress }) => {
                    if (typeof state.ffmpegProgressCb === "function") {
                        state.ffmpegProgressCb(progress);
                    }
                });
                ffmpeg.on("log", ({ message, type }) => {
                    if (!state.processing) {
                        return;
                    }
                    recordFfmpegLog(message, type);
                });

                try {
                    await ffmpeg.load(candidate.loadOptions);
                    state.ffmpeg = ffmpeg;
                    state.ffmpegMode = candidate.mode;
                    recordAppEvent("engine-load-success", {
                        mode: candidate.mode,
                        isolated: Boolean(globalThis.crossOriginIsolated),
                        isolationSource: getIsolationSource(),
                    });
                    setEngineReadyBadge(candidate.mode);
                    return ffmpeg;
                } catch (error) {
                    lastError = error;
                    recordAppEvent("engine-load-failed", {
                        mode: candidate.mode,
                        message: truncateMessage(error instanceof Error ? error.message : String(error || "unknown"), 160),
                    });
                    ffmpeg.terminate();
                }
            }

            throw lastError || new Error("Unable to load local FFmpeg engine.");
        })();
    }

    try {
        return await state.ffmpegLoader;
    } catch (error) {
        state.ffmpegLoader = null;
        state.ffmpeg = null;
        state.ffmpegMode = "unknown";
        state.ffmpegPreferredMode = "unknown";
        setEngineBadge("error", "Engine: Unavailable");
        throw error;
    }
}

async function minimizeImage(file, targetBytes, runMetrics) {
    beginStage(runMetrics, "image-read");
    setProgressUpdate("Reading image", 5);
    setStatus("Reading image...", "info");
    const bitmap = await createImageBitmap(file);
    endStage(runMetrics, "image-read");

    try {
        beginStage(runMetrics, "image-encode");
        const hasAlpha = await imageHasAlpha(bitmap);
        const scaleSteps = [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44];
        const qualitySteps = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42];

        let mimeTypes = ["image/png"];
        if (!hasAlpha) {
            mimeTypes = supportsMimeType("image/webp") ? ["image/webp", "image/jpeg"] : ["image/jpeg"];
        }

        let bestBlob = null;
        let bestMimeType = mimeTypes[0];
        for (const mimeType of mimeTypes) {
            for (let scaleIndex = 0; scaleIndex < scaleSteps.length; scaleIndex += 1) {
                const scale = scaleSteps[scaleIndex];
                const width = Math.max(1, Math.round(bitmap.width * scale));
                const height = Math.max(1, Math.round(bitmap.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const context = canvas.getContext("2d", { alpha: true });
                if (!context) {
                    throw new Error("Unable to initialize image processing context.");
                }
                context.drawImage(bitmap, 0, 0, width, height);

                const perScaleQuality = mimeType === "image/png" ? [undefined] : qualitySteps;
                for (const quality of perScaleQuality) {
                    const blob = await canvasToBlob(canvas, mimeType, quality);
                    if (!bestBlob || blob.size < bestBlob.size) {
                        bestBlob = blob;
                        bestMimeType = mimeType;
                    }
                    const percent = Math.round(((scaleIndex + 1) / scaleSteps.length) * 100);
                    setProgressUpdate("Minimizing image", percent);
                    setStatus(`Minimizing image... ${percent}%`, "info");
                    if (blob.size <= targetBytes) {
                        setProgressUpdate("Image minimize complete", 100);
                        endStage(runMetrics, "image-encode", {
                            outputBytes: blob.size,
                            mimeType,
                        });
                        return {
                            blob,
                            filename: `${getBaseName(file.name)}-min${extensionForMimeType(mimeType)}`,
                        };
                    }
                }
            }
        }

        if (!bestBlob) {
            throw new Error("Image conversion failed.");
        }

        endStage(runMetrics, "image-encode", {
            outputBytes: bestBlob.size,
            mimeType: bestMimeType,
        });
        return {
            blob: bestBlob,
            filename: `${getBaseName(file.name)}-min${extensionForMimeType(bestMimeType)}`,
        };
    } finally {
        if (typeof bitmap.close === "function") {
            bitmap.close();
        }
    }
}

function beginRunTrace(kind) {
    state.trace = [];
    state.ffmpegLogs = [];
    state.runStartedAtMs = performance.now();
    state.lastProgressEventAt = 0;
    state.lastLogEventAt = 0;
    setCurrentStage("run");
    traceEvent("run-start", {
        kind,
        runtimeMode: state.ffmpegMode,
        runtimePreferred: state.ffmpegPreferredMode,
        mockMode: DEBUG_MOCK_MODE || null,
        advancedSettings: getAdvancedVideoSettings(),
    });
    recordAppEvent("run-start", {
        kind,
        runtimeMode: state.ffmpegMode,
        runtimePreferred: state.ffmpegPreferredMode,
        advancedSettings: getAdvancedVideoSettings(),
    });
}

function finalizeRunTrace() {
    state.lastTrace = state.trace.map((entry) => ({ ...entry }));
    state.lastFfmpegLogs = state.ffmpegLogs.map((entry) => ({ ...entry }));
}

function setCurrentStage(stage) {
    const nextStage = stage || "unknown";
    const previousStage = state.currentStage;
    state.currentStage = nextStage;
    state.stageStartedAtMs = performance.now();
    if (previousStage !== nextStage && state.processing) {
        recordAppEvent("stage-change", {
            from: previousStage,
            to: nextStage,
        });
    }
}

function traceEvent(event, details = {}) {
    if (!event) {
        return;
    }
    const timestamp = performance.now();
    const elapsedMs = state.runStartedAtMs > 0 ? Math.max(0, timestamp - state.runStartedAtMs) : 0;
    const entry = {
        event,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        atIso: new Date().toISOString(),
        ...details,
    };
    state.trace.push(entry);
    if (state.trace.length > DEBUG_TRACE_LIMIT) {
        state.trace.splice(0, state.trace.length - DEBUG_TRACE_LIMIT);
    }
    if (DEBUG_MODE) {
        console.debug("[MediaMinimizer][trace]", entry);
    }
}

function recordAppEvent(event, details = {}) {
    if (!event) {
        return;
    }
    const entry = {
        event,
        atIso: new Date().toISOString(),
        processing: state.processing,
        stage: state.currentStage,
        runtimeMode: state.ffmpegMode,
        runtimePreferred: state.ffmpegPreferredMode,
        ...details,
    };
    state.appEvents.push(entry);
    if (state.appEvents.length > APP_EVENT_LIMIT) {
        state.appEvents.splice(0, state.appEvents.length - APP_EVENT_LIMIT);
    }
    if (DEBUG_MODE) {
        console.debug("[MediaMinimizer][app-event]", entry);
    }
}

function buildLastRunSummary() {
    const metrics = state.lastRunMetrics ? { ...state.lastRunMetrics } : null;
    const trace = state.lastTrace || [];
    const summaryEvents = [];
    const keep = new Set([
        "run-start",
        "engine-load",
        "input-ready",
        "metadata-ready",
        "encode-start",
        "encode-progress",
        "encode-retry",
        "encode-silent",
        "output-read",
        "encode-end",
        "error",
        "run-end",
    ]);

    for (const entry of trace) {
        if (!keep.has(entry.event)) {
            continue;
        }
        if (entry.event === "encode-progress" && entry.percent < 100 && entry.percent % 10 !== 0) {
            continue;
        }
        summaryEvents.push({
            event: entry.event,
            elapsedMs: entry.elapsedMs,
            attemptLabel: entry.attemptLabel || null,
            mode: entry.mode || null,
            phase: entry.phase || null,
            percent: Number.isFinite(entry.percent) ? entry.percent : null,
            retryType: entry.retryType || null,
            eventCode: entry.eventCode || null,
            status: entry.status || null,
            message: entry.message ? truncateMessage(entry.message, 140) : null,
        });
    }

    const lifecycleTail = state.appEvents.slice(-40).map((entry) => ({
        event: entry.event,
        atIso: entry.atIso,
        stage: entry.stage,
        runtimeMode: entry.runtimeMode,
        runtimePreferred: entry.runtimePreferred,
        reason: entry.reason || null,
        status: entry.status || null,
        kind: entry.kind || null,
        mode: entry.mode || null,
    }));

    return {
        status: metrics?.status || "unknown",
        totalMs: metrics?.totalMs ?? null,
        runtimePreferred: metrics?.runtimePreferred || "unknown",
        runtimeFinal: metrics?.runtimeMode || "unknown",
        attemptedModes: Array.isArray(metrics?.attemptedModes) ? [...metrics.attemptedModes] : [],
        advancedSettings: metrics?.advancedSettings ? { ...metrics.advancedSettings } : { ...DEFAULT_ADVANCED_VIDEO_SETTINGS },
        notes: Array.isArray(metrics?.notes) ? [...metrics.notes] : [],
        failureCode: metrics?.failureCode || null,
        failureMessage: metrics?.failureMessage || null,
        summaryEvents,
        appLifecycleTail: lifecycleTail,
    };
}

function recordFfmpegLog(message, type = "info") {
    const text = String(message || "").trim();
    if (!text) {
        return;
    }
    const now = performance.now();
    state.lastLogEventAt = now;
    const elapsedMs = state.runStartedAtMs > 0 ? Math.max(0, now - state.runStartedAtMs) : 0;
    const entry = {
        type,
        message: text,
        elapsedMs: Number(elapsedMs.toFixed(1)),
        atIso: new Date().toISOString(),
    };
    state.ffmpegLogs.push(entry);
    if (state.ffmpegLogs.length > DEBUG_LOG_LIMIT) {
        state.ffmpegLogs.splice(0, state.ffmpegLogs.length - DEBUG_LOG_LIMIT);
    }
    if (state.currentStage === "encode") {
        traceEvent("encode-log", {
            type,
            message: text.slice(0, 220),
        });
    }
    if (DEBUG_MODE) {
        console.debug("[MediaMinimizer][ffmpeg-log]", entry);
    }
}

function getLiveDebugState() {
    const now = performance.now();
    const runElapsedMs = state.runStartedAtMs > 0 ? Math.max(0, now - state.runStartedAtMs) : 0;
    const stageElapsedMs = state.stageStartedAtMs > 0 ? Math.max(0, now - state.stageStartedAtMs) : 0;
    const lastProgressAgoMs = state.lastProgressEventAt > 0 ? Math.max(0, now - state.lastProgressEventAt) : null;
    const lastLogAgoMs = state.lastLogEventAt > 0 ? Math.max(0, now - state.lastLogEventAt) : null;
    const lastEventAt = Math.max(state.lastProgressEventAt || 0, state.lastLogEventAt || 0);
    const lastEventAgoMs = lastEventAt > 0 ? Math.max(0, now - lastEventAt) : null;
    return {
        processing: state.processing,
        stage: state.currentStage,
        elapsedMs: Number(runElapsedMs.toFixed(1)),
        stageElapsedMs: Number(stageElapsedMs.toFixed(1)),
        lastProgressAgoMs: Number.isFinite(lastProgressAgoMs) ? Number(lastProgressAgoMs.toFixed(1)) : null,
        lastLogAgoMs: Number.isFinite(lastLogAgoMs) ? Number(lastLogAgoMs.toFixed(1)) : null,
        lastEventAgoMs: Number.isFinite(lastEventAgoMs) ? Number(lastEventAgoMs.toFixed(1)) : null,
        runtimeMode: state.ffmpegMode,
        runtimePreferred: state.ffmpegPreferredMode,
        advancedSettings: getAdvancedVideoSettings(),
    };
}

function terminateFfmpegInstance() {
    if (state.ffmpeg) {
        try {
            state.ffmpeg.terminate();
        } catch (error) {
            // Ignore termination failures while resetting runtime.
        }
    }
    state.ffmpeg = null;
    state.ffmpegLoader = null;
    state.ffmpegMode = "unknown";
    state.ffmpegPreferredMode = "unknown";
}

function createAppError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.details = details;
    return error;
}

function delay(ms) {
    return new Promise((resolve) => {
        globalThis.setTimeout(resolve, ms);
    });
}

async function imageHasAlpha(bitmap) {
    const testSize = 64;
    const width = Math.min(testSize, bitmap.width);
    const height = Math.min(testSize, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
        return false;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height).data;
    for (let index = 3; index < imageData.length; index += 4) {
        if (imageData[index] < 255) {
            return true;
        }
    }
    return false;
}

function supportsMimeType(mimeType) {
    const canvas = document.createElement("canvas");
    const dataUrl = canvas.toDataURL(mimeType);
    return dataUrl.startsWith(`data:${mimeType}`);
}

function canvasToBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
                return;
            }
            reject(new Error("Unable to encode image."));
        }, mimeType, quality);
    });
}

function startRunMetrics(kind) {
    return {
        kind,
        startedAt: performance.now(),
        endedAt: null,
        totalMs: null,
        status: "running",
        runtimeMode: state.ffmpegMode,
        runtimePreferred: state.ffmpegPreferredMode,
        attemptedModes: [],
        stages: {},
        notes: [],
        effectiveEncodeFps: null,
        advancedSettings: getAdvancedVideoSettings(),
        failureCode: null,
        failureMessage: null,
        failureDetails: null,
    };
}

function beginStage(runMetrics, stageName) {
    if (!runMetrics || !stageName) {
        return;
    }
    runMetrics.stages[stageName] = {
        startedAt: performance.now(),
    };
}

function endStage(runMetrics, stageName, extra = {}) {
    if (!runMetrics || !stageName) {
        return null;
    }
    const stage = runMetrics.stages[stageName];
    if (!stage || !Number.isFinite(stage.startedAt)) {
        return null;
    }
    const endedAt = performance.now();
    const ms = Math.max(0, endedAt - stage.startedAt);
    runMetrics.stages[stageName] = {
        ms: Number(ms.toFixed(2)),
        ...extra,
    };
    return ms;
}

function endRunMetrics(runMetrics, status) {
    if (!runMetrics) {
        return;
    }
    runMetrics.endedAt = performance.now();
    runMetrics.totalMs = Number(Math.max(0, runMetrics.endedAt - runMetrics.startedAt).toFixed(2));
    runMetrics.status = status;
    if (state.ffmpegMode !== "unknown") {
        runMetrics.runtimeMode = state.ffmpegMode;
    }
    if (state.ffmpegPreferredMode !== "unknown") {
        runMetrics.runtimePreferred = state.ffmpegPreferredMode;
    }
}

function appendMetricNote(runMetrics, note) {
    if (!runMetrics || !note) {
        return;
    }
    runMetrics.notes.push(note);
}

function recordRunModeAttempt(runMetrics, mode) {
    if (!runMetrics || !mode || mode === "unknown") {
        return;
    }
    if (!Array.isArray(runMetrics.attemptedModes)) {
        runMetrics.attemptedModes = [];
    }
    if (runMetrics.attemptedModes.includes(mode)) {
        return;
    }
    runMetrics.attemptedModes.push(mode);
}

async function safelyDeleteFile(ffmpeg, path) {
    try {
        await ffmpeg.deleteFile(path);
    } catch (error) {
        // Ignore missing files while cleaning up FFmpeg virtual FS.
    }
}

async function safelyDeleteDir(ffmpeg, path) {
    try {
        await ffmpeg.deleteDir(path);
    } catch (error) {
        // Ignore missing directories while cleaning up FFmpeg virtual FS.
    }
}

async function safelyUnmount(ffmpeg, mountPoint) {
    try {
        await ffmpeg.unmount(mountPoint);
    } catch (error) {
        // Ignore unmount failures when mount point is absent.
    }
}

function getExtension(filename) {
    const index = filename.lastIndexOf(".");
    if (index <= 0 || index === filename.length - 1) {
        return "";
    }
    return filename.slice(index).toLowerCase();
}

function getBaseName(filename) {
    const index = filename.lastIndexOf(".");
    if (index <= 0) {
        return filename || "output";
    }
    return filename.slice(0, index);
}

function extensionForMimeType(mimeType) {
    if (mimeType === "image/webp") {
        return ".webp";
    }
    if (mimeType === "image/png") {
        return ".png";
    }
    return ".jpg";
}

function formatBytes(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function formatDuration(seconds) {
    const wholeSeconds = Math.max(1, Math.round(seconds));
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    const secs = wholeSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatElapsed(seconds) {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const secs = wholeSeconds % 60;
    return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDurationMs(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
        return "-";
    }
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(1)}s`;
}

function withAssetVersion(url) {
    return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(ASSET_VERSION)}`;
}

function truncateMessage(text, maxLength) {
    const safeText = String(text || "");
    if (safeText.length <= maxLength) {
        return safeText;
    }
    return `${safeText.slice(0, Math.max(0, maxLength - 3))}...`;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
