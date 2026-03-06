const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_REAL_VIDEO = "~/Downloads/Screen Recording 2025-12-11 at 3.04.37\u202fPM.mov";

function expandHome(filePath) {
    if (!filePath) {
        return filePath;
    }
    if (filePath.startsWith("~/")) {
        return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
}

async function run() {
    const baseURL = process.env.BASE_URL || "http://127.0.0.1:4173";
    const configuredPath = process.env.REAL_VIDEO_PATH || DEFAULT_REAL_VIDEO;
    const realVideoPath = expandHome(configuredPath);

    if (!fs.existsSync(realVideoPath)) {
        console.log(`[real-video-smoke] Skipped. File not found: ${realVideoPath}`);
        process.exit(0);
    }

    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto(`${baseURL}/?debug=1`);
    await page.waitForSelector("#engineBadge");
    await page.waitForFunction(() => {
        const badge = document.querySelector("#engineBadge");
        return badge && /Engine: Ready/.test(badge.textContent || "");
    }, null, { timeout: 120000 });

    await page.locator("#fileInput").setInputFiles(realVideoPath);
    await page.locator("#maxSizeInput").fill("10");
    await page.locator("#minimizeBtn").click();

    await page.waitForFunction(() => {
        const status = (document.querySelector("#status")?.textContent || "").trim();
        if (!status) {
            return false;
        }
        const debug = window.__mediaMinimizerDebug;
        const live = debug?.getLiveState?.();
        const isProcessing = Boolean(live?.processing);
        const terminalSuccess = /^Done\./i.test(status);
        const terminalFailure = /failed|error|conversion failed|stalled after|timeout/i.test(status);
        const transientRecovery = /retrying with st engine|stalled\.\s*retrying/i.test(status.toLowerCase());
        return !isProcessing && (terminalSuccess || (terminalFailure && !transientRecovery));
    }, null, { timeout: 1_200_000 });

    const report = await page.evaluate(() => {
        const debug = window.__mediaMinimizerDebug;
        const trace = debug?.getLastTrace?.() || [];
        const logs = debug?.getLastFfmpegLogs?.() || [];
        const metrics = debug?.getLastRunMetrics?.() || null;
        const runtime = debug?.getRuntimeState?.() || null;
        const finalStatus = document.querySelector("#status")?.textContent?.trim() || "";
        const outputSize = document.querySelector("#outputSize")?.textContent?.trim() || "";
        const outputName = document.querySelector("#outputName")?.textContent?.trim() || "";
        const downloadEnabled = !(document.querySelector("#downloadBtn")?.disabled ?? true);
        return {
            finalStatus,
            outputName,
            outputSize,
            downloadEnabled,
            runtime,
            metrics,
            traceTail: trace.slice(-20),
            ffmpegLogTail: logs.slice(-30),
        };
    });

    report.videoPath = realVideoPath;
    console.log(JSON.stringify(report, null, 2));
    await browser.close();

    if (!/^Done\./i.test(report.finalStatus) || !report.downloadEnabled) {
        process.exit(1);
    }
}

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
