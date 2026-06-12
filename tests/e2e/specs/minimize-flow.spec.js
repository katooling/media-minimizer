const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");
const {
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
} = require("../helpers/app");
const { FIXTURES_DIR, fixturePath, loadVideoFixtureCases } = require("../helpers/fixtures");
const { assertMovVideoOutput, assertNonEmptyFile } = require("../helpers/media-assertions");

const VIDEO_FIXTURE_CASES = loadVideoFixtureCases();

function traceEvents(trace) {
    return trace.map((entry) => entry.event);
}

function expectTraceEvents(trace, expectedEvents = []) {
    const events = traceEvents(trace);
    for (const event of expectedEvents) {
        expect(events, `missing trace event ${event}`).toContain(event);
    }
}

function expectNoTraceEvents(trace, forbiddenEvents = []) {
    const events = traceEvents(trace);
    for (const event of forbiddenEvents) {
        expect(events, `forbidden trace event ${event}`).not.toContain(event);
    }
}

function expectMetricNotes(metrics, expectedNotes = []) {
    const notes = metrics?.notes || [];
    for (const note of expectedNotes) {
        expect(notes, `missing metric note ${note}`).toContain(note);
    }
}

async function readAnalyticsEvents(page) {
    return page.evaluate(() => window.__mediaMinimizerAnalyticsDebug?.getEvents?.() || []);
}

function findAnalyticsEvent(events, eventName) {
    return events.find((entry) => entry.event === eventName);
}

function expectNoAnalyticsLeak(events, forbiddenValues = []) {
    const serialized = JSON.stringify(events);
    for (const value of forbiddenValues) {
        expect(serialized).not.toContain(value);
    }
}

async function minimizeFixture(page, fixture) {
    await uploadFixtureVideo(page, fixture);
    await expect(page.locator("#minimizeBtn")).toBeEnabled();
    await expect(page.locator("#downloadBtn")).toBeDisabled();
    await expect(page.locator("#dropTitle")).toContainText("File selected");
    await page.locator("#minimizeBtn").click();
    await waitForTerminalRun(page, { timeout: fixture.expect?.maxDurationMs || 180000 });
    return readDebugState(page);
}

async function assertSuccessfulVideoRun(page, testInfo, fixture, debug, pageErrors, requests) {
    const branch = fixture.expect?.branch || "encode";
    await expect(page.locator("#status")).toContainText("Done.");
    await expect(page.locator("#downloadBtn")).toBeEnabled();
    await expect(page.locator("#outputName")).toContainText(".mov");
    await expect(page.locator("#progressWrap")).toBeHidden();
    await expect(page.locator("#dropTitle")).toContainText("File selected");
    expect(requests.count).toBe(0);

    const runtimeFailures = pageErrors.filter((message) => /function signature mismatch|runtimeerror/i.test(message));
    expect(runtimeFailures).toHaveLength(0);

    expect(debug.metrics?.kind).toBe("video");
    expect(debug.metrics?.status).toBe("success");
    expectTraceEvents(debug.trace, fixture.expect?.expectedTraceEvents || ["run-end"]);
    expectNoTraceEvents(debug.trace, fixture.expect?.forbiddenTraceEvents || []);
    expectMetricNotes(debug.metrics, fixture.expect?.expectedNotes || []);

    if (branch === "passthrough") {
        expect(debug.metrics?.notes || []).toContain("passthrough");
        expect(debug.metrics?.stages?.encode).toBeFalsy();
        expect(debug.metrics?.stages?.["output-read"]).toBeFalsy();
    } else if (branch === "remux-only") {
        expect(debug.metrics?.notes || []).toContain("remux-only");
        expect(debug.metrics?.stages?.remux?.success).toBe(true);
        expect(traceEvents(debug.trace)).not.toContain("encode-start");
    } else if (branch === "encode-fallback") {
        const attemptLabels = debug.trace
            .filter((entry) => entry.event === "encode-start")
            .map((entry) => entry.attemptLabel);
        expect(attemptLabels).toContain("attempt 1");
        expect(attemptLabels).toContain("fallback attempt");
    } else if (branch === "filterless-retry") {
        expect(debug.trace.some((entry) => entry.event === "encode-retry" && entry.retryType === "filterless")).toBe(true);
        expect(debug.metrics?.notes || []).toContain("filterless-retry");
    } else {
        expect(debug.metrics?.stages?.encode?.ms).toBeGreaterThanOrEqual(0);
        expect(debug.metrics?.stages?.["output-read"]?.ms).toBeGreaterThanOrEqual(0);
        expect(traceEvents(debug.trace)).toContain("encode-start");
    }

    if (fixture.expect?.shouldFitTarget) {
        await expect(page.locator("#status")).toContainText("under target size");
    }

    if (fixture.expect?.ffprobeRequired) {
        const download = await downloadOutput(page, testInfo, fixture.id);
        expect(download.suggested).toContain(".mov");
        assertMovVideoOutput(expect, download.path, {
            ffprobeRequired: true,
            expectNoAudio: fixture.expect?.expectNoAudio === true,
            expectAudio: fixture.expect?.expectAudio === true,
        });
    }
}

async function assertFailedVideoRun(page, fixture, debug, requests) {
    await expect(page.locator("#status")).not.toContainText("Done.");
    await expect(page.locator("#downloadBtn")).toBeDisabled();
    await expect(page.locator("#outputName")).toHaveText("-");
    expect(requests.count).toBe(0);
    expect(debug.metrics?.kind).toBe("video");
    expect(debug.metrics?.status).toBe("failed");
    expect(debug.metrics?.failureCode).toBeTruthy();
    expectTraceEvents(debug.trace, fixture.expect?.expectedTraceEvents || ["run-end"]);
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "failed")).toBe(true);
}

test("runtime mode priority helper covers isolated and non-isolated", async ({ page }) => {
    await openApp(page);

    const runtimeConfig = await page.evaluate(() => {
        const debug = window.__mediaMinimizerDebug;
        return {
            isolatedLargePriority: debug.getRuntimeModePriority(true, 50 * 1024 * 1024),
            isolatedSmallPriority: debug.getRuntimeModePriority(true, 5 * 1024 * 1024),
            nonIsolatedLargePriority: debug.getRuntimeModePriority(false, 50 * 1024 * 1024),
            nonIsolatedSmallPriority: debug.getRuntimeModePriority(false, 5 * 1024 * 1024),
            currentIsolation: window.crossOriginIsolated,
        };
    });

    expect(runtimeConfig.isolatedLargePriority).toEqual(["mt-fast", "st-large", "st-lite"]);
    expect(runtimeConfig.isolatedSmallPriority).toEqual(["mt-fast", "st-lite", "st-large"]);
    expect(runtimeConfig.nonIsolatedLargePriority).toEqual(["st-large", "st-lite"]);
    expect(runtimeConfig.nonIsolatedSmallPriority).toEqual(["st-lite", "st-large"]);

    if (!runtimeConfig.currentIsolation) {
        await expect(page.locator("#engineBadge")).toContainText("(ST-");
    }
});

test("debug ST-only runtime path selects ST based on file size", async ({ page }) => {
    await page.goto("/?debug=1&runtimeMock=st-only");
    await waitForEngineReady(page);

    const runtimeConfig = await page.evaluate(() => {
        const debug = window.__mediaMinimizerDebug;
        return {
            largePriority: debug.getRuntimeModePriority(true, 50 * 1024 * 1024),
            smallPriority: debug.getRuntimeModePriority(true, 5 * 1024 * 1024),
            runtime: debug.getRuntimeState(),
        };
    });

    expect(runtimeConfig.largePriority).toEqual(["st-large", "st-lite"]);
    expect(runtimeConfig.smallPriority).toEqual(["st-lite", "st-large"]);
    expect(runtimeConfig.runtime.activeMode).toMatch(/^st-/);
});

test("initial load reaches engine ready and uses only local app assets", async ({ page }) => {
    const remoteRequests = [];
    page.on("request", (request) => {
        const url = request.url();
        if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url) && !url.startsWith("data:") && !url.startsWith("blob:")) {
            remoteRequests.push(url);
        }
    });

    await openApp(page);
    await expect(page.locator("#status")).toContainText(/Ready|Drop a video or image/);
    expect(remoteRequests).toEqual([]);
});

test("web app manifest exposes installable PWA metadata", async ({ page }) => {
    const manifestResponse = await page.request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    const manifest = await manifestResponse.json();

    expect(manifest).toMatchObject({
        name: "Media Minimizer",
        short_name: "Minimizer",
        start_url: "./",
        scope: "./",
        display: "standalone",
    });
    expect(manifest.icons).toEqual(expect.arrayContaining([
        expect.objectContaining({ src: "assets/icons/icon-192.png", sizes: "192x192", type: "image/png" }),
        expect.objectContaining({ src: "assets/icons/icon-512.png", sizes: "512x512", type: "image/png" }),
        expect.objectContaining({ src: "assets/icons/icon-maskable-512.png", sizes: "512x512", purpose: "maskable" }),
    ]));

    for (const icon of manifest.icons) {
        const iconResponse = await page.request.get(`/${icon.src}`);
        expect(iconResponse.ok(), `${icon.src} should load`).toBe(true);
    }

    await page.goto("/");
    await expect(page.locator("link[rel='manifest']")).toHaveAttribute("href", "manifest.webmanifest");
});

test("service worker caches app shell and active ffmpeg runtime assets", async ({ page }) => {
    await openApp(page);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 });
    const requiredCachedUrls = [
        "/index.html",
        "/styles.css",
        "/app.js",
        "/manifest.webmanifest",
        "/coi-serviceworker.js",
        "/assets/icons/icon-192.png",
        "/vendor/ffmpeg/ffmpeg/index.js",
        "/vendor/ffmpeg/ffmpeg/worker.js",
        "/vendor/ffmpeg/util/index.js",
        "/vendor/ffmpeg/core-mt-fast/ffmpeg-core.wasm?v=20260307-1",
        "/vendor/ffmpeg/core-st-large/ffmpeg-core.wasm?v=20260307-1",
        "/vendor/ffmpeg/core-st-lite/ffmpeg-core.wasm?v=20260307-1",
    ];
    await page.waitForFunction(async (expectedUrls) => {
        const cacheNames = await caches.keys();
        const cacheName = cacheNames.find((name) => name.startsWith("media-minimizer-")) || "";
        if (!cacheName) {
            return false;
        }
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        const cachedUrls = requests.map((request) => {
            const url = new URL(request.url);
            return `${url.pathname}${url.search}`;
        });
        return expectedUrls.every((url) => cachedUrls.includes(url));
    }, requiredCachedUrls, { timeout: 30000 });

    const cacheState = await page.evaluate(async () => {
        const cacheNames = await caches.keys();
        const cacheName = cacheNames.find((name) => name.startsWith("media-minimizer-")) || "";
        const cache = cacheName ? await caches.open(cacheName) : null;
        const requests = cache ? await cache.keys() : [];
        return {
            cacheName,
            urls: requests.map((request) => {
                const url = new URL(request.url);
                return `${url.pathname}${url.search}`;
            }),
        };
    });

    expect(cacheState.cacheName).toMatch(/^media-minimizer-/);
    expect(cacheState.urls).toEqual(expect.arrayContaining(requiredCachedUrls));
    expect(cacheState.urls.some((url) => url.includes("/vendor/ffmpeg/core/ffmpeg-core.wasm"))).toBe(false);
    expect(cacheState.urls.some((url) => url.includes("/vendor/ffmpeg/core-mt/ffmpeg-core.wasm"))).toBe(false);
});

test("fresh offline launch loads cached app and minimizes an image", async ({ page }) => {
    await openApp(page);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 });

    await page.context().setOffline(true);
    try {
        await page.goto("/");
        await waitForEngineReady(page);
        const pwa = await page.evaluate(() => window.__mediaMinimizerPwaDebug?.getState?.() || null);
        expect(pwa?.serviceWorkerControlled).toBe(true);

        await uploadFile(page, fixturePath("sample.png"), {
            name: "fresh-offline-image.png",
            mimeType: "image/png",
        });
        await page.locator("#minimizeBtn").click();
        await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });
        await expect(page.locator("#downloadBtn")).toBeEnabled();
    } finally {
        await page.context().setOffline(false);
    }
});

test("offline reload can still load the single-thread ffmpeg runtime", async ({ page }) => {
    await openApp(page, "/?debug=1&runtimeMock=st-only");
    await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, { timeout: 15000 });

    await page.context().setOffline(true);
    try {
        await page.reload();
        await waitForEngineReady(page);
        const runtime = await page.evaluate(() => window.__mediaMinimizerDebug?.getRuntimeState?.() || null);
        expect(runtime?.activeMode).toMatch(/^st-/);
    } finally {
        await page.context().setOffline(false);
    }
});

test("analytics is disabled by default on local app loads", async ({ page }) => {
    const remoteRequests = [];
    page.on("request", (request) => {
        const url = request.url();
        if (/posthog/i.test(url)) {
            remoteRequests.push(url);
        }
    });

    await openApp(page);

    const analytics = await page.evaluate(() => window.__mediaMinimizerAnalyticsDebug?.getState?.() || null);
    expect(analytics?.mode).toBe("disabled");
    expect(analytics?.enabled).toBe(false);
    expect(remoteRequests).toEqual([]);
});

test("privacy note explains browser-only processing and analytics boundaries", async ({ page }) => {
    await openApp(page);

    await expect(page.locator(".subtle")).toContainText("Your files are not uploaded here.");
    const privacyNote = page.locator(".privacy-note");
    await expect(privacyNote).toContainText("Your media stays on this device.");
    await expect(privacyNote).toContainText("Anonymous analytics may report general app activity");
    await expect(privacyNote).toContainText("It never sends filenames, file contents, folders, or conversion logs.");
    await expect(privacyNote).toContainText("Once the app has loaded, minimization can keep working");
});

test("analytics stub records sanitized visit and file selection events", async ({ page }) => {
    await openApp(page, "/?analytics=stub");
    await uploadFile(page, fixturePath("sample.mp4"), {
        name: "private-holiday-video.mp4",
        mimeType: "video/mp4",
    });

    const events = await readAnalyticsEvents(page);
    const visit = findAnalyticsEvent(events, "mm_app_view");
    const selected = findAnalyticsEvent(events, "mm_file_select");

    expect(visit?.properties.runtime_isolated).toEqual(expect.any(Boolean));
    expect(selected?.properties).toMatchObject({
        source: "picker",
        kind: "video",
        extension: ".mp4",
    });
    expect(selected?.properties.size_bucket_mb).toEqual(expect.any(String));
    expectNoAnalyticsLeak(events, ["private-holiday-video.mp4", "sample.mp4"]);
});

test("analytics stub records sanitized image minimize and download flow", async ({ page }, testInfo) => {
    await openApp(page, "/?analytics=stub");
    await uploadFile(page, fixturePath("sample.png"), {
        name: "private-image-name.png",
        mimeType: "image/png",
    });

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();
    await downloadOutput(page, testInfo, "analytics-image");

    const events = await readAnalyticsEvents(page);
    const started = findAnalyticsEvent(events, "mm_minimize_start");
    const completed = findAnalyticsEvent(events, "mm_minimize_end");
    const downloaded = findAnalyticsEvent(events, "mm_download_click");

    expect(started?.properties).toMatchObject({
        kind: "image",
        advanced_changed: false,
    });
    expect(completed?.properties).toMatchObject({
        status: "success",
        kind: "image",
        failure_code: "none",
    });
    expect(completed?.properties.total_seconds).toEqual(expect.any(Number));
    expect(completed?.properties.input_size_bucket_mb).toEqual(expect.any(String));
    expect(completed?.properties.output_size_bucket_mb).toEqual(expect.any(String));
    expect(downloaded?.properties.kind).toBe("image");
    expect(downloaded?.properties.output_extension).toMatch(/\.(webp|jpg|png)/);
    expectNoAnalyticsLeak(events, ["private-image-name.png", "analytics-image"]);
});

test("minimization still works when analytics is blocked and connection drops after load", async ({ page }) => {
    await page.route(/posthog/i, (route) => route.abort("failed"));
    await openApp(page, "/?analytics=live");

    const analytics = await page.evaluate(() => window.__mediaMinimizerAnalyticsDebug?.getState?.() || null);
    expect(analytics?.mode).toBe("live");
    expect(analytics?.enabled).toBe(true);

    await page.context().setOffline(true);
    await uploadFile(page, fixturePath("sample.png"), {
        name: "offline-private-image.png",
        mimeType: "image/png",
    });
    await page.locator("#minimizeBtn").click();

    await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();
    const debug = await readDebugState(page);
    expect(debug.metrics?.kind).toBe("image");
    expect(debug.metrics?.status).toBe("success");
    await page.context().setOffline(false);
});

test("picker upload enables minimize and leaves download disabled", async ({ page }) => {
    await openApp(page);
    await uploadFile(page, fixturePath("sample.mp4"), {
        name: "picker-sample.mp4",
        mimeType: "video/mp4",
    });

    await expect(page.locator("#minimizeBtn")).toBeEnabled();
    await expect(page.locator("#downloadBtn")).toBeDisabled();
    await expect(page.locator("#dropTitle")).toContainText("File selected");
    await expect(page.locator("#fileSummary")).toContainText("picker-sample.mp4");
});

test("drag and drop upload enables minimize", async ({ page }) => {
    await openApp(page);
    const dataTransfer = await page.evaluateHandle(async () => {
        const data = new Uint8Array([1, 2, 3, 4]);
        const file = new File([data], "drop-video.mp4", { type: "video/mp4" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        return transfer;
    });

    await page.locator("#dropZone").dispatchEvent("drop", { dataTransfer });
    await expect(page.locator("#minimizeBtn")).toBeEnabled();
    await expect(page.locator("#fileSummary")).toContainText("drop-video.mp4");
});

test("unsupported files are rejected inline", async ({ page }) => {
    await openApp(page);
    await page.locator("#fileInput").setInputFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not media"),
    });

    await expect(page.locator("#status")).toContainText("Unsupported file type");
    await expect(page.locator("#minimizeBtn")).toBeDisabled();
    await expect(page.locator("#downloadBtn")).toBeDisabled();
});

test("invalid max size does not start processing", async ({ page }) => {
    await openApp(page);
    await uploadFile(page, fixturePath("sample.mp4"), {
        name: "invalid-target.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("0");
    await page.locator("#minimizeBtn").click();

    await expect(page.locator("#status")).toContainText("Max size must be a number greater than 0.");
    await expect(page.locator("#downloadBtn")).toBeDisabled();
    const debug = await readDebugState(page);
    expect(debug.metrics).toBeNull();
});

test("successful download uses expected filename and non-empty output", async ({ page }, testInfo) => {
    test.setTimeout(90000);
    await openApp(page);
    await uploadFile(page, fixturePath("generated/near-target-remux.mp4"), {
        name: "download-check.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("1");
    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 60000 });

    const download = await downloadOutput(page, testInfo, "download-check");
    expect(download.suggested).toBe("download-check-min.mov");
    assertNonEmptyFile(expect, download.path);
});

test("running twice clears stale output and produces a fresh result", async ({ page }, testInfo) => {
    test.setTimeout(120000);
    await openApp(page);
    await uploadFile(page, fixturePath("generated/near-target-remux.mp4"), {
        name: "first-run.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("1");
    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 60000 });
    const first = await downloadOutput(page, testInfo, "first-run");

    await uploadFile(page, fixturePath("generated/under-target.mov"), {
        name: "second-run.mov",
        mimeType: "video/quicktime",
    });
    await expect(page.locator("#outputName")).toHaveText("-");
    await expect(page.locator("#downloadBtn")).toBeDisabled();
    await page.locator("#maxSizeInput").fill("1");
    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 60000 });
    const second = await downloadOutput(page, testInfo, "second-run");

    expect(first.path).not.toBe(second.path);
    expect(second.suggested).toBe("second-run-min.mov");
    assertNonEmptyFile(expect, second.path);
});

test("double-clicking minimize does not start duplicate runs and locks inputs while processing", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&ffmpegMock=no-progress-complete");
    await uploadFile(page, fixturePath("sample.mp4"), {
        name: "double-click.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("1");

    await page.locator("#minimizeBtn").evaluate((button) => {
        button.click();
        button.click();
    });
    await expect(page.locator("#fileInput")).toBeDisabled();
    await expect(page.locator("#maxSizeInput")).toBeDisabled();
    await expect(page.locator("#dropTitle")).toContainText("Minimizing in progress");
    await waitForTerminalRun(page, { timeout: 45000 });

    const events = (await readDebugState(page)).summary.appLifecycleTail.filter((entry) => entry.event === "minimize-start");
    expect(events).toHaveLength(1);
});

test("image flow enables minimize/download and sends no new requests on minimize", async ({ page }) => {
    await openApp(page);
    const requests = createNonBlobRequestCapture(page);

    await uploadFile(page, fixturePath("sample.png"), { mimeType: "image/png" });
    await expect(page.locator("#minimizeBtn")).toBeEnabled();
    await expect(page.locator("#downloadBtn")).toBeDisabled();

    requests.start();
    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });
    requests.stop();

    await expect(page.locator("#engineBadge")).toContainText("Engine: Ready");
    await expect(page.locator("#downloadBtn")).toBeEnabled();
    await expect(page.locator("#outputName")).toContainText("-min");
    expect(requests.count).toBe(0);

    const metrics = (await readDebugState(page)).metrics;
    expect(metrics?.kind).toBe("image");
    expect(metrics?.stages?.["image-read"]?.ms).toBeGreaterThanOrEqual(0);
    expect(metrics?.stages?.["image-encode"]?.ms).toBeGreaterThanOrEqual(0);
});

test("opaque image can produce an optimized non-empty download", async ({ page }, testInfo) => {
    await openApp(page);
    await uploadFile(page, fixturePath("sample.png"), {
        name: "opaque.png",
        mimeType: "image/png",
    });
    await page.locator("#maxSizeInput").fill("1");
    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });

    const download = await downloadOutput(page, testInfo, "opaque-image");
    expect(download.suggested).toMatch(/opaque-min\.(webp|jpg|png)$/);
    assertNonEmptyFile(expect, download.path);
});

test("alpha image keeps an alpha-capable output path", async ({ page }, testInfo) => {
    await openApp(page);
    await uploadFile(page, fixturePath("generated/alpha.png"), {
        name: "alpha.png",
        mimeType: "image/png",
    });
    await page.locator("#maxSizeInput").fill("1");
    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 15000 });

    const download = await downloadOutput(page, testInfo, "alpha-image");
    expect(download.suggested).toMatch(/^alpha-min\.(png|webp)$/);
    assertNonEmptyFile(expect, download.path);
});

test("tiny image target returns best effort output", async ({ page }) => {
    await openApp(page);
    await uploadFile(page, fixturePath("sample.png"), {
        name: "tiny-target.png",
        mimeType: "image/png",
    });
    await page.locator("#maxSizeInput").fill("0.0001");
    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Could not reach target size", { timeout: 15000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();
});

test("corrupt image fails explicitly and leaves download disabled", async ({ page }) => {
    await openApp(page);
    await uploadFile(page, fixturePath("generated/corrupt-image.png"), {
        name: "corrupt-image.png",
        mimeType: "image/png",
    });
    await page.locator("#minimizeBtn").click();
    await waitForTerminalRun(page, { timeout: 20000 });
    await expect(page.locator("#status")).not.toContainText("Done.");
    await expect(page.locator("#downloadBtn")).toBeDisabled();
    const debug = await readDebugState(page);
    expect(debug.metrics?.kind).toBe("image");
    expect(debug.metrics?.status).toBe("failed");
});

test("advanced defaults stay on auto and preserve current encode defaults", async ({ page }) => {
    test.setTimeout(120000);
    await openApp(page);
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 70000 });

    const debug = await readDebugState(page);

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
    await openApp(page);
    await setAdvancedVideoOptions(page, {
        speed: "balanced",
        resolution: "480",
        fps: "30",
        audio: "balanced-96",
        threads: "4",
    });

    await expect(page.locator("#advancedResetBtn")).toBeEnabled();
    await page.locator("#advancedResetBtn").click();

    const settings = (await readDebugState(page)).settings;
    expect(settings).toEqual({
        speed: "auto",
        maxHeight: "auto",
        maxFps: "auto",
        audio: "auto",
        threads: "auto",
    });
    await expect(page.locator("#advancedResetBtn")).toBeDisabled();
});

test("advanced auto labels explain current default behavior", async ({ page }) => {
    await openApp(page);

    const autoLabels = await page.evaluate(() => {
        const readLabel = (id) => {
            const select = document.querySelector(id);
            if (!select) {
                return "";
            }
            const option = Array.from(select.options).find((entry) => entry.value === "auto");
            return option ? option.textContent || "" : "";
        };
        return {
            speed: readLabel("#advancedSpeedSelect"),
            resolution: readLabel("#advancedResolutionSelect"),
            fps: readLabel("#advancedFpsSelect"),
            audio: readLabel("#advancedAudioSelect"),
            threads: readLabel("#advancedThreadsSelect"),
        };
    });

    expect(autoLabels.speed.toLowerCase()).toContain("auto");
    expect(autoLabels.resolution.toLowerCase()).toContain("auto");
    expect(autoLabels.fps.toLowerCase()).toContain("auto");
    expect(autoLabels.audio.toLowerCase()).toContain("auto");
    expect(autoLabels.threads.toLowerCase()).toContain("auto");
});

test("advanced overrides map to encode profile and args", async ({ page }) => {
    test.setTimeout(120000);
    await openApp(page);
    await setAdvancedVideoOptions(page, {
        speed: "quality",
        resolution: "240",
        fps: "24",
        audio: "high-128",
        threads: "2",
    });
    await uploadFile(page, fixturePath("web/sample_640x360.mp4"), {
        name: "advanced-mapping-640x360.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("0.001");

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 70000 });

    const plan = (await readDebugState(page)).plan;
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

test("video run keeps status high-level while progress panel carries details and eta", async ({ page }) => {
    test.setTimeout(120000);
    await openApp(page);
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#progressWrap")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#progressMeta")).toContainText("ETA", { timeout: 15000 });

    const interim = await page.evaluate(() => ({
        status: document.querySelector("#status")?.textContent || "",
        progressMeta: document.querySelector("#progressMeta")?.textContent || "",
    }));

    if (!interim.status.startsWith("Done.")) {
        expect(interim.status).toContain("Video processing in progress");
        expect(interim.status).not.toContain("attempt");
        expect(interim.status).not.toMatch(/\d+%/);
    }
    expect(interim.progressMeta).toContain("ETA");
    expect(interim.progressMeta).toContain("Elapsed");

    await expect(page.locator("#status")).toContainText("Done.", { timeout: 70000 });
});

test.describe("video fixture matrix", () => {
    test.describe.configure({ mode: "serial" });

    for (const fixture of VIDEO_FIXTURE_CASES) {
        test(`video fixture covers ${fixture.expect?.branch || "encode"} [${fixture.id}]`, async ({ page }, testInfo) => {
            test.setTimeout(fixture.expect?.maxDurationMs || 180000);
            const requests = createNonBlobRequestCapture(page);
            const pageErrors = collectPageErrors(page);

            await openApp(page);
            requests.start();
            const debug = await minimizeFixture(page, fixture);
            requests.stop();

            if (fixture.expect?.branch === "failure") {
                await assertFailedVideoRun(page, fixture, debug, requests);
                return;
            }
            await assertSuccessfulVideoRun(page, testInfo, fixture, debug, pageErrors, requests);
        });
    }
});

test("mock video no-progress logs still completes without hang", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&ffmpegMock=no-progress-complete&stallMs=3000");
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 45000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();

    const debug = await readDebugState(page);
    expect(debug.trace.some((entry) => entry.event === "encode-log")).toBe(true);
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "success")).toBe(true);
    expect(debug.logs.length).toBeGreaterThan(0);
    expect(debug.live.processing).toBe(false);
});

test("mock filter-graph failure retries filterless and succeeds", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&ffmpegMock=filter-graph-retry&stallMs=3000");
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 45000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();

    const debug = await readDebugState(page);
    expect(debug.trace.some((entry) => entry.event === "encode-retry" && entry.retryType === "filterless")).toBe(true);
    expect(debug.metrics?.notes || []).toContain("filterless-retry");
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "success")).toBe(true);
});

test("mock audio-copy failure retries with encoded audio and succeeds", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&ffmpegMock=audio-copy-retry");
    await uploadFile(page, fixturePath("generated/tiny-h264-aac.mp4"), {
        name: "audio-copy-retry.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("10");

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 45000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();

    const debug = await readDebugState(page);
    expect(debug.plan?.attemptLabel).toContain("audio retry");
    expect(debug.plan?.profile?.audioMode).toBe("encode");
    expect(debug.metrics?.stages?.encode?.attempts).toBe(2);
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "success")).toBe(true);
});

test("mock generic encode failure fails explicitly", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&ffmpegMock=generic-exec-fail");
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await waitForTerminalRun(page, { timeout: 45000 });
    await expect(page.locator("#status")).toContainText("Video conversion failed");
    await expect(page.locator("#downloadBtn")).toBeDisabled();

    const debug = await readDebugState(page);
    expect(debug.metrics?.status).toBe("failed");
    expect(debug.metrics?.failureCode).toBe("ENCODE_EXEC_FAILED");
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "failed")).toBe(true);
});

test("metadata browser failure falls back to ffprobe", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&metadataMock=browser-fails&ffmpegMock=no-progress-complete");
    await uploadFile(page, fixturePath("sample.mp4"), {
        name: "metadata-fallback.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("0.001");

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 60000 });

    const debug = await readDebugState(page);
    expect(debug.metrics?.stages?.metadata?.durationSource).toBe("ffprobe");
    expect(debug.trace.some((entry) => entry.event === "metadata-ready" && entry.durationSource === "ffprobe")).toBe(true);
});

test("WORKERFS mount failure falls back to writeFile input", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&inputMock=workerfs-fails");
    await uploadFile(page, fixturePath("generated/tiny-h264-no-audio.mp4"), {
        name: "workerfs-fallback.mp4",
        mimeType: "video/mp4",
    });
    await page.locator("#maxSizeInput").fill("0.04");

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 60000 });

    const debug = await readDebugState(page);
    expect(debug.metrics?.stages?.input?.strategy).toBe("writeFile");
    expect(debug.trace.some((entry) => entry.event === "input-ready" && entry.strategy === "writeFile")).toBe(true);
});

test("mock stall triggers fallback once then succeeds", async ({ page }) => {
    test.setTimeout(120000);
    await openApp(page, "/?debug=1&ffmpegMock=mt-stall-fallback&stallMs=2500");
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Done.", { timeout: 70000 });
    await expect(page.locator("#downloadBtn")).toBeEnabled();

    const debug = await readDebugState(page);
    expect(
        debug.trace.some(
            (entry) =>
                entry.event === "error" &&
                /(encode-stalled|ENCODE_STALLED)/.test(String(entry.eventCode || ""))
        )
    ).toBe(true);
    expect(debug.metrics?.notes || []).toContain("mt-runtime-fallback");
    expect(debug.metrics?.attemptedModes).toContain("mt-fast");
    expect(debug.metrics?.attemptedModes).toContain("st-large");
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "success")).toBe(true);
});

test("cancel stops an active video minimize without creating output", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&ffmpegMock=stall&stallMs=2500");
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#cancelBtn")).toBeVisible();
    await expect(page.locator("#cancelBtn")).toBeEnabled();

    await page.locator("#cancelBtn").click();
    await waitForTerminalRun(page, { timeout: 45000 });

    await expect(page.locator("#status")).toContainText("Cancelled.");
    await expect(page.locator("#cancelBtn")).toBeHidden();
    await expect(page.locator("#downloadBtn")).toBeDisabled();
    await expect(page.locator("#outputName")).toHaveText("-");

    const debug = await readDebugState(page);
    expect(debug.metrics?.status).toBe("cancelled");
    expect(debug.metrics?.failureCode).toBe("RUN_CANCELLED");
    expect(debug.live.processing).toBe(false);
    expect(debug.trace.some((entry) => entry.event === "cancel-requested")).toBe(true);
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "cancelled")).toBe(true);
});

test("mock stall without recovery fails explicitly", async ({ page }) => {
    test.setTimeout(90000);
    await openApp(page, "/?debug=1&ffmpegMock=stall&stallMs=2500");
    await uploadForcedEncodeVideo(page, FIXTURES_DIR);

    await page.locator("#minimizeBtn").click();
    await expect(page.locator("#status")).toContainText("Encode stalled", { timeout: 45000 });
    await expect(page.locator("#downloadBtn")).toBeDisabled();

    const debug = await readDebugState(page);
    expect(
        debug.trace.some(
            (entry) =>
                entry.event === "error" &&
                /(encode-stalled|ENCODE_STALLED)/.test(String(entry.eventCode || ""))
        )
    ).toBe(true);
    expect(debug.trace.some((entry) => entry.event === "run-end" && entry.status === "failed")).toBe(true);
});
