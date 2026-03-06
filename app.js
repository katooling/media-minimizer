const elements = {
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
    ffmpegFetchFile: null,
};

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);

init();

function init() {
    elements.fileInput.addEventListener("change", onFileInputChange);
    elements.dropZone.addEventListener("dragover", onDragOver);
    elements.dropZone.addEventListener("dragleave", onDragLeave);
    elements.dropZone.addEventListener("drop", onDrop);
    elements.minimizeBtn.addEventListener("click", onMinimizeClick);
    elements.downloadBtn.addEventListener("click", onDownloadClick);
    setStatus("Drop a video or image to start.", "info");
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
    setStatus("Loading FFmpeg core (first run may take a while)...", "info");
    const ffmpeg = await getFfmpeg();
    state.ffmpegProgressCb = null;

    const inputExt = getExtension(file.name) || ".bin";
    const inputPath = `input${inputExt}`;
    const outputPath = "output.mov";
    const outputFilename = `${getBaseName(file.name)}-min.mov`;

    await ffmpeg.writeFile(inputPath, await state.ffmpegFetchFile(file));

    const attempts = [
        { crf: 24, audioKbps: 128 },
        { crf: 28, audioKbps: 96 },
        { crf: 32, audioKbps: 64 },
    ];

    let bestBlob = null;
    for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index];
        state.ffmpegProgressCb = (progress) => {
            const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));
            setStatus(`Minimizing video (pass ${index + 1}/${attempts.length})... ${percent}%`, "info");
        };

        await safelyDeleteFile(ffmpeg, outputPath);
        await ffmpeg.exec([
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
            "veryfast",
            "-crf",
            String(attempt.crf),
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            `${attempt.audioKbps}k`,
            "-movflags",
            "+faststart",
            "-f",
            "mov",
            outputPath,
        ]);

        const outputData = await ffmpeg.readFile(outputPath);
        const blob = new Blob([outputData], { type: "video/quicktime" });
        if (!bestBlob || blob.size < bestBlob.size) {
            bestBlob = blob;
        }
        if (blob.size <= targetBytes) {
            break;
        }
    }

    state.ffmpegProgressCb = null;
    await safelyDeleteFile(ffmpeg, inputPath);
    await safelyDeleteFile(ffmpeg, outputPath);

    if (!bestBlob) {
        throw new Error("Video conversion failed.");
    }

    return {
        blob: bestBlob,
        filename: outputFilename,
    };
}

async function getFfmpeg() {
    if (state.ffmpeg) {
        return state.ffmpeg;
    }

    if (!state.ffmpegLoader) {
        state.ffmpegLoader = (async () => {
            const [{ FFmpeg }, { fetchFile, toBlobURL }] = await Promise.all([
                import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js"),
                import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js"),
            ]);

            const ffmpeg = new FFmpeg();
            state.ffmpegFetchFile = fetchFile;
            ffmpeg.on("progress", ({ progress }) => {
                if (typeof state.ffmpegProgressCb === "function") {
                    state.ffmpegProgressCb(progress);
                }
            });

            const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";
            await ffmpeg.load({
                coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
                wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
            });

            state.ffmpeg = ffmpeg;
            return ffmpeg;
        })();
    }

    return state.ffmpegLoader;
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
