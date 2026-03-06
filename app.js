import { FFmpeg, FFFSType } from "./vendor/ffmpeg/ffmpeg/index.js";
import { fetchFile } from "./vendor/ffmpeg/util/index.js";

const elements = {
    engineBadge: document.getElementById("engineBadge"),
    dropZone: document.getElementById("dropZone"),
    fileInput: document.getElementById("fileInput"),
    fileSummary: document.getElementById("fileSummary"),
    maxSizeInput: document.getElementById("maxSizeInput"),
    minimizeBtn: document.getElementById("minimizeBtn"),
    downloadBtn: document.getElementById("downloadBtn"),
    status: document.getElementById("status"),
    result: document.getElementById("result"),
    originalSize: document.getElementById("originalSize"),
    outputSize: document.getElementById("outputSize"),
    savedSize: document.getElementById("savedSize"),
    outputName: document.getElementById("outputName"),
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
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
const FALLBACK_TARGET_MARGIN = 1.1;
const TARGET_PAYLOAD_RATIO = 0.96;

init();

function init() {
    elements.fileInput.addEventListener("change", onFileInputChange);
    elements.dropZone.addEventListener("dragover", onDragOver);
    elements.dropZone.addEventListener("dragleave", onDragLeave);
    elements.dropZone.addEventListener("drop", onDrop);
    elements.minimizeBtn.addEventListener("click", onMinimizeClick);
    elements.downloadBtn.addEventListener("click", onDownloadClick);

    // Exposed for E2E assertions of runtime selection behavior.
    if (typeof window !== "undefined") {
        window.__mediaMinimizerDebug = { getRuntimeModePriority };
    }

    setEngineBadge("loading", "Engine: Loading");
    setStatus("Preparing local engine... Drop a video or image to start.", "info");
    warmupFfmpeg();
}

async function warmupFfmpeg() {
    try {
        await getFfmpeg();
        state.ffmpegPreloadDone = true;
        if (!state.processing && !state.inputFile) {
            setStatus(`Ready (${state.ffmpegMode.toUpperCase()} engine). Drop a video or image to start.`, "info");
        }
    } catch (error) {
        state.ffmpegPreloadDone = false;
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
    setInputFile(file);
}

function onDragOver(event) {
    event.preventDefault();
    elements.dropZone.classList.add("active");
}

function onDragLeave(event) {
    event.preventDefault();
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
    setInputFile(file);
}

function setInputFile(file) {
    state.inputFile = file;
    clearOutput();
    const typeLabel = detectInputType(file);
    elements.fileSummary.textContent = `${file.name} (${formatBytes(file.size)})`;

    if (typeLabel === "unsupported") {
        setStatus("Unsupported file type. Use a video or image file.", "error");
        elements.minimizeBtn.disabled = true;
        return;
    }

    elements.minimizeBtn.disabled = false;

    if (typeLabel === "video" && state.ffmpegPreloadDone) {
        setStatus(`Ready to minimize video with ${state.ffmpegMode.toUpperCase()} engine.`, "info");
        return;
    }
    setStatus(`Ready to minimize ${typeLabel}.`, "info");
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
}

async function onMinimizeClick() {
    if (state.processing || !state.inputFile) {
        return;
    }

    const targetMb = Number(elements.maxSizeInput.value);
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
    clearOutput();

    try {
        let result;
        if (inputType === "video") {
            result = await minimizeVideo(state.inputFile, targetBytes);
        } else {
            result = await minimizeImage(state.inputFile, targetBytes);
        }
        setOutputResult(result, targetBytes);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Minimize failed.";
        setStatus(message, "error");
    } finally {
        setProcessing(false);
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
    elements.result.hidden = false;
    elements.downloadBtn.disabled = false;

    if (outputSize <= targetBytes) {
        setStatus("Done. File is under target size and ready to download.", "success");
    } else {
        setStatus("Done. Could not reach target size; best minimized result is ready to download.", "info");
    }
}

function setProcessing(isProcessing) {
    state.processing = isProcessing;
    elements.minimizeBtn.disabled = isProcessing || !state.inputFile || detectInputType(state.inputFile) === "unsupported";
    elements.downloadBtn.disabled = isProcessing || !state.outputBlob;
    elements.fileInput.disabled = isProcessing;
    elements.maxSizeInput.disabled = isProcessing;
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
    const suffix = mode === "mt" ? "MT" : "ST";
    setEngineBadge("ready", `Engine: Ready (${suffix})`);
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

async function minimizeVideo(file, targetBytes) {
    const ffmpeg = await getFfmpeg();
    state.ffmpegProgressCb = null;

    const outputPath = "output.mov";
    const probePath = "duration.txt";
    const outputFilename = `${getBaseName(file.name)}-min.mov`;
    const inputHandle = await prepareVideoInput(ffmpeg, file);

    try {
        const durationSeconds = await probeDurationSeconds(ffmpeg, inputHandle.inputPath, probePath);
        const etaBand = estimateVideoEtaBand(durationSeconds, state.ffmpegMode);
        setStatus(`Minimizing video (attempt 1)... ${etaBand}. Browser FFmpeg is slower than native.`, "info");

        const primaryProfile = buildVideoEncodeProfile({ targetBytes, durationSeconds, aggressive: false });
        let bestAttempt = await runVideoEncodeAttempt({
            ffmpeg,
            inputPath: inputHandle.inputPath,
            outputPath,
            profile: primaryProfile,
            attemptLabel: "attempt 1",
        });

        if (bestAttempt.blob.size > Math.floor(targetBytes * FALLBACK_TARGET_MARGIN)) {
            const reductionFactor = clamp((targetBytes / bestAttempt.blob.size) * 0.92, 0.45, 0.9);
            const fallbackProfile = buildVideoEncodeProfile({
                targetBytes,
                durationSeconds,
                aggressive: true,
                reductionFactor,
                baseProfile: primaryProfile,
            });

            const fallbackAttempt = await runVideoEncodeAttempt({
                ffmpeg,
                inputPath: inputHandle.inputPath,
                outputPath,
                profile: fallbackProfile,
                attemptLabel: "fallback attempt",
            });

            if (fallbackAttempt.blob.size < bestAttempt.blob.size) {
                bestAttempt = fallbackAttempt;
            }
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

async function runVideoEncodeAttempt({ ffmpeg, inputPath, outputPath, profile, attemptLabel }) {
    state.ffmpegProgressCb = (progress) => {
        const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));
        setStatus(`Minimizing video (${attemptLabel})... ${percent}% (approx.)`, "info");
    };

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
        "-c:v",
        "libx264",
        "-preset",
        profile.preset,
        "-b:v",
        `${profile.videoKbps}k`,
        "-maxrate",
        `${profile.maxrateKbps}k`,
        "-bufsize",
        `${profile.bufsizeKbps}k`,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        `${profile.audioKbps}k`,
        "-movflags",
        "+faststart",
        "-f",
        "mov",
        outputPath,
    ]);

    if (exitCode !== 0) {
        throw new Error(`Video conversion failed during ${attemptLabel}.`);
    }

    const outputData = await ffmpeg.readFile(outputPath);
    return {
        blob: new Blob([outputData], { type: "video/quicktime" }),
    };
}

function buildVideoEncodeProfile({ targetBytes, durationSeconds, aggressive, reductionFactor = 1, baseProfile = null }) {
    if (baseProfile) {
        const videoKbps = Math.max(150, Math.floor(baseProfile.videoKbps * reductionFactor));
        const audioKbps = aggressive ? 64 : baseProfile.audioKbps;
        return {
            preset: "veryfast",
            videoKbps,
            audioKbps,
            maxrateKbps: Math.max(videoKbps + 100, Math.floor(videoKbps * 1.2)),
            bufsizeKbps: Math.max(videoKbps + 200, Math.floor(videoKbps * 2)),
        };
    }

    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 60;
    const targetPayloadBytes = Math.floor(targetBytes * TARGET_PAYLOAD_RATIO);
    const targetTotalBps = Math.max(350_000, Math.floor((targetPayloadBytes * 8) / safeDuration));

    let audioBps = clamp(Math.floor(targetTotalBps * 0.12), 64_000, 128_000);
    if (audioBps > Math.floor(targetTotalBps * 0.4)) {
        audioBps = Math.floor(targetTotalBps * 0.4);
    }

    let videoBps = Math.max(200_000, targetTotalBps - audioBps);
    if (aggressive) {
        videoBps = Math.max(150_000, Math.floor(videoBps * 0.78));
        audioBps = 64_000;
    }

    const videoKbps = Math.floor(videoBps / 1000);
    const audioKbps = Math.floor(audioBps / 1000);

    return {
        preset: "veryfast",
        videoKbps,
        audioKbps,
        maxrateKbps: Math.max(videoKbps + 100, Math.floor(videoKbps * 1.2)),
        bufsizeKbps: Math.max(videoKbps + 200, Math.floor(videoKbps * 2)),
    };
}

function estimateVideoEtaBand(durationSeconds, mode) {
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return "ETA unknown";
    }

    const [minMultiplier, maxMultiplier] = mode === "mt" ? [0.8, 2.5] : [1.5, 4.5];
    const minSeconds = durationSeconds * minMultiplier;
    const maxSeconds = durationSeconds * maxMultiplier;
    return `ETA ~${formatDuration(minSeconds)}-${formatDuration(maxSeconds)}`;
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

async function cleanupVideoInput(ffmpeg, inputHandle) {
    if (inputHandle.mounted) {
        await safelyUnmount(ffmpeg, inputHandle.mountPoint);
        await safelyDeleteDir(ffmpeg, inputHandle.mountPoint);
        return;
    }
    await safelyDeleteFile(ffmpeg, inputHandle.inputPath);
}

function getRuntimeModePriority(isIsolated) {
    if (isIsolated) {
        return ["mt", "st"];
    }
    return ["st"];
}

function createRuntimeCandidate(mode) {
    const classWorkerURL = new URL("./vendor/ffmpeg/ffmpeg/worker.js", import.meta.url).href;

    if (mode === "mt") {
        return {
            mode,
            loadOptions: {
                classWorkerURL,
                coreURL: new URL("./vendor/ffmpeg/core-mt/ffmpeg-core.js", import.meta.url).href,
                wasmURL: new URL("./vendor/ffmpeg/core-mt/ffmpeg-core.wasm", import.meta.url).href,
                workerURL: new URL("./vendor/ffmpeg/core-mt/ffmpeg-core.worker.js", import.meta.url).href,
            },
        };
    }

    return {
        mode,
        loadOptions: {
            classWorkerURL,
            coreURL: new URL("./vendor/ffmpeg/core/ffmpeg-core.js", import.meta.url).href,
            wasmURL: new URL("./vendor/ffmpeg/core/ffmpeg-core.wasm", import.meta.url).href,
        },
    };
}

async function getFfmpeg() {
    if (state.ffmpeg) {
        return state.ffmpeg;
    }

    if (!state.ffmpegLoader) {
        state.ffmpegLoader = (async () => {
            const isIsolated = Boolean(globalThis.crossOriginIsolated);
            const modePriority = getRuntimeModePriority(isIsolated);
            let lastError = null;

            for (const mode of modePriority) {
                const candidate = createRuntimeCandidate(mode);
                const ffmpeg = new FFmpeg();
                ffmpeg.on("progress", ({ progress }) => {
                    if (typeof state.ffmpegProgressCb === "function") {
                        state.ffmpegProgressCb(progress);
                    }
                });

                try {
                    await ffmpeg.load(candidate.loadOptions);
                    state.ffmpeg = ffmpeg;
                    state.ffmpegMode = candidate.mode;
                    setEngineReadyBadge(candidate.mode);
                    return ffmpeg;
                } catch (error) {
                    lastError = error;
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
        setEngineBadge("error", "Engine: Unavailable");
        throw error;
    }
}

async function minimizeImage(file, targetBytes) {
    setStatus("Reading image...", "info");
    const bitmap = await createImageBitmap(file);

    try {
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
                    setStatus(`Minimizing image... ${percent}%`, "info");
                    if (blob.size <= targetBytes) {
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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
