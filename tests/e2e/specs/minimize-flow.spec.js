const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures");
const VIDEO_FIXTURES_MANIFEST_PATH = path.resolve(FIXTURES_DIR, "video-fixtures.json");
const VIDEO_FIXTURE_SET = String(process.env.VIDEO_FIXTURE_SET || "all")
    .trim()
    .toLowerCase();
const VIDEO_FIXTURE_MAX_SIZE_MB = Number(process.env.VIDEO_FIXTURE_MAX_SIZE_MB || "");
const VIDEO_FIXTURE_IDS = String(process.env.VIDEO_FIXTURE_IDS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const VIDEO_FIXTURE_ID_FILTER = new Set(VIDEO_FIXTURE_IDS);
const VIDEO_FIXTURE_CASES = loadVideoFixtureCases();

async function waitForEngineReady(page) {
    await expect(page.locator("#engineBadge")).toContainText("Engine: Ready", { timeout: 120000 });
}

function loadVideoFixtureCases() {
    const raw = fs.readFileSync(VIDEO_FIXTURES_MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(raw);
    const fixtures = (manifest.videos || []).map((entry) => ({
        ...entry,
        fixturePath: path.resolve(FIXTURES_DIR, entry.path),
    }));
    for (const fixture of fixtures) {
        if (!fs.existsSync(fixture.fixturePath)) {
            throw new Error(`Video fixture not found: ${fixture.fixturePath} (${fixture.id})`);
        }
    }
    if (VIDEO_FIXTURE_ID_FILTER.size > 0) {
        const selected = fixtures.filter((fixture) => VIDEO_FIXTURE_ID_FILTER.has(fixture.id));
        if (selected.length === 0) {
            throw new Error(`No fixtures matched VIDEO_FIXTURE_IDS=${VIDEO_FIXTURE_IDS.join(",")}`);
        }
        return selected;
    }
    if (VIDEO_FIXTURE_SET === "all") {
        return fixtures;
    }
    const selected = fixtures.filter((fixture) => Array.isArray(fixture.tags) && fixture.tags.includes(VIDEO_FIXTURE_SET));
    if (selected.length === 0) {
        throw new Error(`No fixtures matched VIDEO_FIXTURE_SET=${VIDEO_FIXTURE_SET}`);
    }
    return selected;
}

async function uploadForcedEncodeVideo(page) {
    const fixturePath = path.resolve(FIXTURES_DIR, "sample.mp4");
    await page.locator("#fileInput").setInputFiles({
        name: "sample-force-encode.mov",
        mimeType: "video/quicktime",
        buffer: fs.readFileSync(fixturePath),
    });
    await page.locator("#maxSizeInput").fill("0.001");
}

async function uploadFixtureVideo(page, fixture) {
    const maxSizeMb = Number.isFinite(VIDEO_FIXTURE_MAX_SIZE_MB) && VIDEO_FIXTURE_MAX_SIZE_MB > 0
        ? VIDEO_FIXTURE_MAX_SIZE_MB
        : fixture.maxSizeMb ?? 0.001;
    await page.locator("#fileInput").setInputFiles({
        name: fixture.uploadName || path.basename(fixture.path || fixture.fixturePath),
        mimeType: fixture.mimeType || "video/mp4",
        buffer: fs.readFileSync(fixture.fixturePath),
    });
    await page.locator("#maxSizeInput").fill(String(maxSizeMb));
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

test("runtime mode priority helper covers isolated and non-isolated", async ({ page }) => {
    await page.goto("/");
    await waitForEngineReady(page);

    let runtimeConfig;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            runtimeConfig = await page.evaluate(() => {
                const debug = window.__mediaMinimizerDebug;
                return {
                    isolatedLargePriority: debug.getRuntimeModePriority(true, 50 * 1024 * 1024),
                    isolatedSmallPriority: debug.getRuntimeModePriority(true, 5 * 1024 * 1024),
                    nonIsolatedLargePriority: debug.getRuntimeModePriority(false, 50 * 1024 * 1024),
                    nonIsolatedSmallPriority: debug.getRuntimeModePriority(false, 5 * 1024 * 1024),
                    currentIsolation: window.crossOriginIsolated,
                };
            });
            break;
        } catch (error) {
            if (attempt === 2) {
                throw error;
            }
            await page.waitForTimeout(250);
        }
    }

    expect(runtimeConfig.isolatedLargePriority).toEqual(["mt-fast", "st-large", "st-lite"]);
    expect(runtimeConfig.isolatedSmallPriority).toEqual(["mt-fast", "st-lite", "st-large"]);
    expect(runtimeConfig.nonIsolatedLargePriority).toEqual(["st-large", "st-lite"]);
    expect(runtimeConfig.nonIsolatedSmallPriority).toEqual(["st-lite", "st-large"]);

    if (!runtimeConfig.currentIsolation) {
        await expect(page.locator("#engineBadge")).toContainText("(ST-");
    }
});

test("image flow enables minimize/download and sends no new requests on minimize", async ({ page }) => {
    let captureRequests = false;
    let minimizeRequests = 0;
    page.on("request", (request) => {
        if (!captureRequests) {
            return;
        }
        if (!request.url().startsWith("data:") && !request.url().startsWith("blob:")) {
            minimizeRequests += 1;
        }
    });

    await page.goto("/");
    await waitForEngineReady(page);

    const fixturePath = path.resolve(FIXTURES_DIR, "sample.png");
    await page.locator("#fileInput").setInputFiles(fixturePath);

    const minimizeBtn = page.locator("#minimizeBtn");
    const downloadBtn = page.locator("#downloadBtn");

    await expect(minimizeBtn).toBeEnabled();
    await expect(downloadBtn).toBeDisabled();

    captureRequests = true;
    await minimizeBtn.click();

    await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });
    await expect(page.locator("#engineBadge")).toContainText("Engine: Ready");
    await expect(downloadBtn).toBeEnabled();
    await expect(page.locator("#outputName")).toContainText("-min");
    expect(minimizeRequests).toBe(0);

    const metrics = await page.evaluate(() => window.__mediaMinimizerDebug.getLastRunMetrics());
    expect(metrics?.kind).toBe("image");
    expect(metrics?.stages?.["image-read"]?.ms).toBeGreaterThanOrEqual(0);
    expect(metrics?.stages?.["image-encode"]?.ms).toBeGreaterThanOrEqual(0);
});

test("advanced defaults stay on auto and preserve current encode defaults", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await waitForEngineReady(page);
    await uploadForcedEncodeVideo(page);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 70000 });

    const debug = await page.evaluate(() => {
        const api = window.__mediaMinimizerDebug;
        return {
            settings: api.getAdvancedVideoSettings(),
            plan: api.getLastEncodePlan(),
        };
    });

    expect(debug.settings).toEqual({
        speed: "auto",
        maxHeight: "auto",
        maxFps: "auto",
        audio: "auto",
        threads: "auto",
    });
    expect(debug.plan).toBeTruthy();
    expect(debug.plan.profile.speedMode).toBe("auto");
    expect(debug.plan.profile.preset).toBe("ultrafast");
    if (debug.plan.profile.runtimeMode === "mt-fast") {
        expect(debug.plan.profile.tune).toBeFalsy();
        expect(debug.plan.args.includes("-tune")).toBe(false);
    } else {
        expect(debug.plan.profile.tune).toBe("zerolatency");
        expect(debug.plan.args).toContain("-tune");
        expect(debug.plan.args).toContain("zerolatency");
    }
});

test("advanced reset returns all controls to auto", async ({ page }) => {
    await page.goto("/");
    await waitForEngineReady(page);
    await setAdvancedVideoOptions(page, {
        speed: "balanced",
        resolution: "480",
        fps: "30",
        audio: "balanced-96",
        threads: "4",
    });

    await expect(page.locator("#advancedResetBtn")).toBeEnabled();
    await page.locator("#advancedResetBtn").click();

    const settings = await page.evaluate(() => window.__mediaMinimizerDebug.getAdvancedVideoSettings());
    expect(settings).toEqual({
        speed: "auto",
        maxHeight: "auto",
        maxFps: "auto",
        audio: "auto",
        threads: "auto",
    });
    await expect(page.locator("#advancedResetBtn")).toBeDisabled();
});

test("advanced overrides map to encode profile and args", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/");
    await waitForEngineReady(page);
    await setAdvancedVideoOptions(page, {
        speed: "quality",
        resolution: "240",
        fps: "24",
        audio: "high-128",
        threads: "2",
    });
    const fixturePath = path.resolve(FIXTURES_DIR, "web", "sample_640x360.mp4");
    await page.locator("#fileInput").setInputFiles({
        name: "advanced-mapping-640x360.mp4",
        mimeType: "video/mp4",
        buffer: fs.readFileSync(fixturePath),
    });
    await page.locator("#maxSizeInput").fill("0.001");

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 70000 });

    const plan = await page.evaluate(() => window.__mediaMinimizerDebug.getLastEncodePlan());
    expect(plan).toBeTruthy();
    expect(plan.profile.speedMode).toBe("quality");
    expect(plan.profile.preset).toBe("faster");
    expect(plan.profile.tune).toBeFalsy();
    expect(plan.profile.audioMode).toBe("encode");
    expect(plan.profile.audioKbps).toBe(128);
    expect(plan.profile.maxFps).toBe(24);
    expect(plan.profile.maxHeight).toBe(240);
    if (plan.profile.runtimeMode === "mt-fast") {
        expect(plan.profile.encodeThreads).toBe(2);
    } else {
        expect(plan.profile.encodeThreads).toBe(1);
    }
    expect(plan.args).toContain("-preset");
    expect(plan.args).toContain("faster");
    expect(plan.args).toContain("-b:a");
    expect(plan.args).toContain("128k");
    const vfArgIndex = plan.args.indexOf("-vf");
    expect(vfArgIndex).toBeGreaterThan(-1);
    const vfExpr = String(plan.args[vfArgIndex + 1] || "");
    expect(vfExpr).toContain("fps=24");
    expect(vfExpr).toContain("scale=-2:240");
});

for (const fixture of VIDEO_FIXTURE_CASES) {
    test(`video flow converts to mov and enables download [${fixture.id}]`, async ({ page }) => {
        test.setTimeout(180000);
        let captureRequests = false;
        let minimizeRequests = 0;
        const pageErrors = [];
        page.on("request", (request) => {
            if (!captureRequests) {
                return;
            }
            if (!request.url().startsWith("data:") && !request.url().startsWith("blob:")) {
                minimizeRequests += 1;
            }
        });
        page.on("pageerror", (error) => {
            pageErrors.push(String(error?.message || error));
        });

        await page.goto("/");
        await waitForEngineReady(page);

        await uploadFixtureVideo(page, fixture);

        const minimizeBtn = page.locator("#minimizeBtn");
        const downloadBtn = page.locator("#downloadBtn");
        const progressWrap = page.locator("#progressWrap");

        await expect(minimizeBtn).toBeEnabled();
        await expect(downloadBtn).toBeDisabled();
        await expect(page.locator("#dropTitle")).toContainText("File selected");
        await expect(page.locator("#originalSize")).toContainText("-");

        captureRequests = true;
        await minimizeBtn.click();
        await page.waitForTimeout(150);
        const interimUi = await page.evaluate(() => ({
            status: document.querySelector("#status")?.textContent || "",
            progressVisible: !(document.querySelector("#progressWrap")?.hasAttribute("hidden")),
            dropTitle: document.querySelector("#dropTitle")?.textContent || "",
            originalSize: document.querySelector("#originalSize")?.textContent || "",
            outputSize: document.querySelector("#outputSize")?.textContent || "",
            savedSize: document.querySelector("#savedSize")?.textContent || "",
            progressMeta: document.querySelector("#progressMeta")?.textContent || "",
        }));
        if (interimUi.status.includes("Minimizing")) {
            expect(interimUi.progressVisible).toBe(true);
            expect(interimUi.dropTitle).toContain("Minimizing in progress");
            expect(interimUi.originalSize).not.toBe("-");
            expect(interimUi.outputSize).toContain("Working...");
            expect(interimUi.savedSize).toContain("Working...");
            expect(interimUi.progressMeta).toContain("Elapsed");
        }

        await expect(page.locator("#status")).toContainText("Done.", { timeout: 120000 });
        await expect(page.locator("#engineBadge")).toContainText("Engine: Ready");
        await expect(downloadBtn).toBeEnabled();
        await expect(page.locator("#outputName")).toContainText(".mov");
        await expect(progressWrap).toBeHidden();
        await expect(page.locator("#dropTitle")).toContainText("File selected");
        expect(minimizeRequests).toBe(0);

        const metrics = await page.evaluate(() => window.__mediaMinimizerDebug.getLastRunMetrics());
        expect(metrics?.kind).toBe("video");
        expect(metrics?.stages?.load?.ms).toBeGreaterThanOrEqual(0);
        expect(metrics?.stages?.input?.ms).toBeGreaterThanOrEqual(0);
        expect(metrics?.stages?.metadata?.ms).toBeGreaterThanOrEqual(0);
        expect(metrics?.stages?.encode?.ms).toBeGreaterThanOrEqual(0);
        expect(metrics?.notes || []).not.toContain("remux-only");
        const runtimeFailures = pageErrors.filter((message) => /function signature mismatch|runtimeerror/i.test(message));
        expect(runtimeFailures).toHaveLength(0);

        const trace = await page.evaluate(() => window.__mediaMinimizerDebug.getLastTrace());
        const events = trace.map((entry) => entry.event);
        expect(events).toContain("run-start");
        expect(events).toContain("engine-load");
        expect(events).toContain("input-ready");
        expect(events).toContain("metadata-ready");
        expect(events).toContain("encode-start");
        expect(events).toContain("output-read");
        expect(events).toContain("run-end");
    });
}

test("mock video no-progress logs still completes without hang", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/?debug=1&ffmpegMock=no-progress-complete&stallMs=3000");
    await waitForEngineReady(page);
    await uploadForcedEncodeVideo(page);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 45000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();

    const debug = await page.evaluate(() => ({
        trace: window.__mediaMinimizerDebug.getLastTrace(),
        logs: window.__mediaMinimizerDebug.getLastFfmpegLogs(),
        live: window.__mediaMinimizerDebug.getLiveState(),
    }));

    expect(debug.trace.some((entry) => entry.event === "encode-log")).toBe(true);
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "success")).toBe(true);
    expect(debug.logs.length).toBeGreaterThan(0);
    expect(debug.live.processing).toBe(false);
});

test("mock filter-graph failure retries filterless and succeeds", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/?debug=1&ffmpegMock=filter-graph-retry&stallMs=3000");
    await waitForEngineReady(page);
    await uploadForcedEncodeVideo(page);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 45000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();

    const debug = await page.evaluate(() => ({
        trace: window.__mediaMinimizerDebug.getLastTrace(),
        metrics: window.__mediaMinimizerDebug.getLastRunMetrics(),
    }));

    expect(debug.trace.some((entry) => entry.event === "encode-retry" && entry.retryType === "filterless")).toBe(true);
    expect(debug.metrics?.notes || []).toContain("filterless-retry");
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "success")).toBe(true);
});

test("mock stall triggers fallback once then succeeds", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/?debug=1&ffmpegMock=mt-stall-fallback&stallMs=2500");
    await waitForEngineReady(page);
    await uploadForcedEncodeVideo(page);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 70000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();

    const debug = await page.evaluate(() => ({
        trace: window.__mediaMinimizerDebug.getLastTrace(),
        metrics: window.__mediaMinimizerDebug.getLastRunMetrics(),
    }));

    expect(
        debug.trace.some(
            (entry) =>
                entry.event === "error" &&
                /(encode-stalled|ENCODE_STALLED)/.test(String(entry.eventCode || ""))
        )
    ).toBe(true);
    expect(debug.metrics?.notes || []).toContain("mt-runtime-fallback");
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "success")).toBe(true);
});

test("mock stall without recovery fails explicitly", async ({ page }) => {
    test.setTimeout(90000);
    await page.goto("/?debug=1&ffmpegMock=stall&stallMs=2500");
    await waitForEngineReady(page);
    await uploadForcedEncodeVideo(page);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Encode stalled", { timeout: 45000 });
    await expect(page.locator("#downloadBtn")).toBeDisabled();

    const trace = await page.evaluate(() => window.__mediaMinimizerDebug.getLastTrace());
    expect(
        trace.some(
            (entry) =>
                entry.event === "error" &&
                /(encode-stalled|ENCODE_STALLED)/.test(String(entry.eventCode || ""))
        )
    ).toBe(true);
    expect(trace.some((entry) => entry.event === "run-end" && entry.status === "failed")).toBe(true);
});
