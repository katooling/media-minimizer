const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

async function waitForEngineReady(page) {
    await expect(page.locator("#engineBadge")).toContainText("Engine: Ready", { timeout: 120000 });
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

    const fixturePath = path.resolve(__dirname, "..", "fixtures", "sample.png");
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

test("video flow converts to mov and enables download", async ({ page }) => {
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

    const fixturePath = path.resolve(__dirname, "..", "fixtures", "sample.mp4");
    await page.locator("#fileInput").setInputFiles({
        name: "sample-force-encode.mov",
        mimeType: "video/quicktime",
        buffer: fs.readFileSync(fixturePath),
    });
    await page.locator("#maxSizeInput").fill("0.001");

    const minimizeBtn = page.locator("#minimizeBtn");
    const downloadBtn = page.locator("#downloadBtn");

    await expect(minimizeBtn).toBeEnabled();
    await expect(downloadBtn).toBeDisabled();

    captureRequests = true;
    await minimizeBtn.click();

    await expect(page.locator("#status")).toContainText("Done.", { timeout: 120000 });
    await expect(page.locator("#engineBadge")).toContainText("Engine: Ready");
    await expect(downloadBtn).toBeEnabled();
    await expect(page.locator("#outputName")).toContainText(".mov");
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
});
