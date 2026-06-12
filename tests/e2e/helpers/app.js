const fs = require("fs");
const path = require("path");
const { expect } = require("@playwright/test");

async function waitForEngineReady(page) {
    await expect(page.locator("#engineBadge")).toContainText("Engine: Ready", { timeout: 120000 });
}

async function openApp(page, url = "/") {
    await page.goto(url);
    await waitForEngineReady(page);
}

async function uploadFile(page, filePath, options = {}) {
    const buffer = fs.readFileSync(filePath);
    await page.locator("#fileInput").setInputFiles({
        name: options.name || path.basename(filePath),
        mimeType: options.mimeType || guessMimeType(filePath),
        buffer,
    });
}

async function uploadFixtureVideo(page, fixture, options = {}) {
    const maxSizeMb = Number.isFinite(Number(process.env.VIDEO_FIXTURE_MAX_SIZE_MB)) && Number(process.env.VIDEO_FIXTURE_MAX_SIZE_MB) > 0
        ? Number(process.env.VIDEO_FIXTURE_MAX_SIZE_MB)
        : options.maxSizeMb ?? fixture.maxSizeMb ?? 0.001;
    await uploadFile(page, fixture.fixturePath, {
        name: fixture.uploadName || path.basename(fixture.fixturePath),
        mimeType: fixture.mimeType || "video/mp4",
    });
    await page.locator("#maxSizeInput").fill(String(maxSizeMb));
}

async function uploadForcedEncodeVideo(page, fixturesDir) {
    const fixturePath = path.resolve(fixturesDir, "sample.mp4");
    await uploadFile(page, fixturePath, {
        name: "sample-force-encode.mov",
        mimeType: "video/quicktime",
    });
    await page.locator("#maxSizeInput").fill("0.001");
}

async function setAdvancedVideoOptions(page, options = {}) {
    await page.locator("#advancedSection").evaluate((node) => {
        node.open = true;
    });
    if (options.speed) {
        await page.locator("#advancedSpeedSelect").selectOption(options.speed);
    }
    if (options.resolution) {
        await page.locator("#advancedResolutionSelect").selectOption(options.resolution);
    }
    if (options.fps) {
        await page.locator("#advancedFpsSelect").selectOption(options.fps);
    }
    if (options.audio) {
        await page.locator("#advancedAudioSelect").selectOption(options.audio);
    }
    if (options.threads) {
        await page.locator("#advancedThreadsSelect").selectOption(options.threads);
    }
}

function createNonBlobRequestCapture(page) {
    let active = false;
    const requests = [];
    page.on("request", (request) => {
        if (!active) {
            return;
        }
        const url = request.url();
        if (!url.startsWith("data:") && !url.startsWith("blob:")) {
            requests.push(url);
        }
    });
    return {
        start() {
            active = true;
        },
        stop() {
            active = false;
        },
        get count() {
            return requests.length;
        },
        get requests() {
            return [...requests];
        },
    };
}

function collectPageErrors(page) {
    const pageErrors = [];
    page.on("pageerror", (error) => {
        pageErrors.push(String(error?.message || error));
    });
    return pageErrors;
}

async function waitForTerminalRun(page, options = {}) {
    const timeout = options.timeout || 120000;
    await page.waitForFunction(() => {
        const status = (document.querySelector("#status")?.textContent || "").trim();
        const debug = window.__mediaMinimizerDebug;
        const live = debug?.getLiveState?.();
        const processing = Boolean(live?.processing);
        const success = /^Done\./i.test(status);
        const failure = /failed|error|conversion failed|stalled|timeout|max size must|unsupported|cancelled/i.test(status);
        return !processing && (success || failure);
    }, null, { timeout });
}

async function readDebugState(page) {
    return page.evaluate(() => {
        const api = window.__mediaMinimizerDebug;
        return {
            metrics: api?.getLastRunMetrics?.() || null,
            trace: api?.getLastTrace?.() || [],
            logs: api?.getLastFfmpegLogs?.() || [],
            live: api?.getLiveState?.() || null,
            summary: api?.getLastRunSummary?.() || null,
            plan: api?.getLastEncodePlan?.() || null,
            runtime: api?.getRuntimeState?.() || null,
            settings: api?.getAdvancedVideoSettings?.() || null,
        };
    });
}

async function downloadOutput(page, testInfo, basename) {
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#downloadBtn").click();
    const download = await downloadPromise;
    const suggested = download.suggestedFilename();
    const outputDir = testInfo.outputPath("downloads");
    fs.mkdirSync(outputDir, { recursive: true });
    const safeBase = String(basename || suggested || "download").replace(/[^a-z0-9._-]+/gi, "_");
    const outputPath = path.join(outputDir, safeBase.endsWith(path.extname(suggested)) ? safeBase : `${safeBase}-${suggested}`);
    await download.saveAs(outputPath);
    return {
        suggested,
        path: outputPath,
        size: fs.statSync(outputPath).size,
    };
}

function guessMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png") {
        return "image/png";
    }
    if (ext === ".jpg" || ext === ".jpeg") {
        return "image/jpeg";
    }
    if (ext === ".webp") {
        return "image/webp";
    }
    if (ext === ".mov") {
        return "video/quicktime";
    }
    if (ext === ".webm") {
        return "video/webm";
    }
    if (ext === ".txt") {
        return "text/plain";
    }
    return "video/mp4";
}

module.exports = {
    collectPageErrors,
    createNonBlobRequestCapture,
    downloadOutput,
    openApp,
    readDebugState,
    setAdvancedVideoOptions,
    uploadFile,
    uploadFixtureVideo,
    uploadForcedEncodeVideo,
    waitForEngineReady,
    waitForTerminalRun,
};
