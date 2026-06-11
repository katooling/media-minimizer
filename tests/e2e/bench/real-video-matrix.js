const fs = require("fs");
const { chromium } = require("playwright");
const { loadRealVideoFixtures } = require("../helpers/fixtures");

async function waitForEngineReady(page) {
    await page.waitForSelector("#engineBadge");
    await page.waitForFunction(() => {
        const badge = document.querySelector("#engineBadge");
        return badge && /Engine: Ready/.test(badge.textContent || "");
    }, null, { timeout: 120000 });
}

async function runFixture(browser, baseURL, fixture) {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/?debug=1`);
    await waitForEngineReady(page);

    await page.locator("#fileInput").setInputFiles({
        name: fixture.uploadName,
        mimeType: fixture.mimeType || "video/quicktime",
        buffer: fs.readFileSync(fixture.fixturePath),
    });
    await page.locator("#maxSizeInput").fill(String(fixture.maxSizeMb || 10));
    await page.locator("#minimizeBtn").click();

    await page.waitForFunction(() => {
        const status = (document.querySelector("#status")?.textContent || "").trim();
        const debug = window.__mediaMinimizerDebug;
        const live = debug?.getLiveState?.();
        const isProcessing = Boolean(live?.processing);
        const terminalSuccess = /^Done\./i.test(status);
        const terminalFailure = /failed|error|conversion failed|stalled after|timeout/i.test(status);
        const transientRecovery = /retrying with st engine|stalled\.\s*retrying/i.test(status.toLowerCase());
        return !isProcessing && (terminalSuccess || (terminalFailure && !transientRecovery));
    }, null, { timeout: fixture.timeoutMs || 1_200_000 });

    const report = await page.evaluate(() => {
        const debug = window.__mediaMinimizerDebug;
        const trace = debug?.getLastTrace?.() || [];
        const logs = debug?.getLastFfmpegLogs?.() || [];
        return {
            finalStatus: document.querySelector("#status")?.textContent?.trim() || "",
            outputName: document.querySelector("#outputName")?.textContent?.trim() || "",
            outputSize: document.querySelector("#outputSize")?.textContent?.trim() || "",
            downloadEnabled: !(document.querySelector("#downloadBtn")?.disabled ?? true),
            runtime: debug?.getRuntimeState?.() || null,
            metrics: debug?.getLastRunMetrics?.() || null,
            summary: debug?.getLastRunSummary?.() || null,
            traceTail: trace.slice(-20),
            ffmpegLogTail: logs.slice(-30),
        };
    });
    await page.close();
    return {
        ...report,
        id: fixture.id,
        videoPath: fixture.fixturePath,
    };
}

async function run() {
    const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
    const fixtures = loadRealVideoFixtures();
    if (fixtures.length === 0) {
        console.log("[real-video-matrix] Skipped. No real video fixtures found.");
        return;
    }

    const browser = await chromium.launch();
    const reports = [];
    try {
        for (const fixture of fixtures) {
            if (!fs.existsSync(fixture.fixturePath)) {
                console.log(`[real-video-matrix] Skipped missing fixture ${fixture.id}: ${fixture.fixturePath}`);
                continue;
            }
            console.log(`[real-video-matrix] Running ${fixture.id}: ${fixture.fixturePath}`);
            const report = await runFixture(browser, baseURL, fixture);
            reports.push(report);
            console.log(JSON.stringify(report, null, 2));
        }
    } finally {
        await browser.close();
    }

    const failures = reports.filter((report) => !/^Done\./i.test(report.finalStatus) || !report.downloadEnabled);
    if (failures.length > 0) {
        console.error(`[real-video-matrix] ${failures.length} fixture(s) failed.`);
        process.exit(1);
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
